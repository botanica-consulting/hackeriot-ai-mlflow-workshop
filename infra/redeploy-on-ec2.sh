#!/usr/bin/env bash
set -euo pipefail

image_uri="${1:-}"
secret_id="${2:-}"
aws_region="${3:-}"

if [[ -z "$image_uri" || -z "$secret_id" || -z "$aws_region" ]]; then
  echo "Usage: $0 ECR_IMAGE_URI SECRET_ID AWS_REGION" >&2
  exit 1
fi

exec 9>/var/lock/greenhouse-deploy.lock
flock -n 9 || { echo "Another greenhouse deployment is already running." >&2; exit 1; }

cd /opt/greenhouse
mountpoint -q /opt/greenhouse || { echo "Persistent greenhouse volume is not mounted." >&2; exit 1; }

umask 077
aws secretsmanager get-secret-value \
  --region "$aws_region" \
  --secret-id "$secret_id" \
  --query SecretString \
  --output text > .env.next
[[ -s .env.next ]] || { echo "Secrets Manager returned an empty environment." >&2; exit 1; }
mv .env.next .env
chmod 600 .env

registry=${image_uri%%/*}
aws ecr get-login-password --region "$aws_region" \
  | docker login --username AWS --password-stdin "$registry"
docker pull "$image_uri"

jq --arg image "$image_uri" '
  (.services[] | select(has("build")) | .image) = $image
  | del(.services[]?.build)
' docker-compose.generated.json > docker-compose.next.json
mv docker-compose.next.json docker-compose.generated.json

compose=(./scripts/compose.sh --env-file .env -f docker-compose.generated.json)
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" up -d --remove-orphans

participant_count=$(awk -F= '$1 == "PARTICIPANT_COUNT" { gsub(/[^0-9]/, "", $2); print $2; exit }' .env)
[[ "$participant_count" =~ ^[0-9]+$ ]] || { echo "Invalid PARTICIPANT_COUNT in .env" >&2; exit 1; }
expected=$((participant_count * 2 + 2))

healthy=false
for _ in $(seq 1 120); do
  running=$(docker ps --filter label=com.docker.compose.project=greenhouse -q | wc -l | tr -d ' ')
  starting=$(docker ps --filter label=com.docker.compose.project=greenhouse --filter health=starting -q | wc -l | tr -d ' ')
  unhealthy=$(docker ps --filter label=com.docker.compose.project=greenhouse --filter health=unhealthy -q | wc -l | tr -d ' ')
  exited=$(docker ps -a --filter label=com.docker.compose.project=greenhouse --filter status=exited -q | wc -l | tr -d ' ')

  if (( unhealthy > 0 || exited > 0 )); then
    break
  fi
  if (( running == expected && starting == 0 )); then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  "${compose[@]}" ps
  echo "Deployment failed its health check: expected $expected running services." >&2
  exit 1
fi

deploy_domain=$(awk -F= '$1 == "DEPLOY_DOMAIN" { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit }' .env)
[[ "$deploy_domain" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "Invalid DEPLOY_DOMAIN in .env" >&2; exit 1; }

verify_gateway_route() {
  local participant_id=$1
  local expected_host="greenhouse-${participant_id}.${deploy_domain}"
  docker exec "greenhouse-app-${participant_id}-1" node -e '
    const http = require("node:http");
    const expectedHost = process.argv[1];
    const request = http.get(
      { hostname: "traefik", port: 80, path: "/", headers: { Host: expectedHost } },
      (response) => {
        const valid = response.statusCode === 302
          && response.headers.location?.startsWith("/gateway?");
        if (!valid) {
          console.error(`Gateway route check failed for ${expectedHost}: ${response.statusCode} ${response.headers.location ?? ""}`);
          process.exitCode = 1;
        }
        response.resume();
      },
    );
    request.on("error", (error) => {
      console.error(`Gateway route check failed for ${expectedHost}: ${error.message}`);
      process.exitCode = 1;
    });
    request.setTimeout(5000, () => request.destroy(new Error("timed out")));
  ' "$expected_host"
}

verify_gateway_route "01"
verify_gateway_route "$(printf '%02d' "$participant_count")"

printf '%s\n' "$image_uri" > .last-successful-image
docker image prune -f >/dev/null
echo "Deployment healthy: $expected services are running."
