#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

default_tag="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)"
image_tag="${1:-$default_tag}"
[[ "$image_tag" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || { echo "Invalid image tag: $image_tag" >&2; exit 1; }

aws_profile=$(terraform -chdir=infra output -raw aws_profile)
aws_region=$(terraform -chdir=infra output -raw aws_region)
instance_id=$(terraform -chdir=infra output -raw instance_id)
secret_arn=$(terraform -chdir=infra output -raw environment_secret_arn)
repository_url=$(terraform -chdir=infra output -raw ecr_repository_url)
image_uri="$repository_url:$image_tag"

wait_for_command() {
  local command_id=$1
  local max_polls=${2:-180}
  local status
  for _ in $(seq 1 "$max_polls"); do
    status=$(aws ssm get-command-invocation \
      --profile "$aws_profile" --region "$aws_region" \
      --command-id "$command_id" --instance-id "$instance_id" \
      --query Status --output text 2>/dev/null || true)
    case "$status" in
      Success) return 0 ;;
      Failed|Cancelled|TimedOut|Cancelling) return 1 ;;
    esac
    sleep 5
  done
  return 1
}

npm test
npm run typecheck
./infra/push-to-ecr.sh "$image_tag"

node scripts/generate-deployment.mjs --app-image "$image_uri"
./scripts/compose.sh --env-file .env -f docker-compose.generated.json config --quiet

bundle=$(mktemp)
trap 'rm -f "$bundle"' EXIT
tar -czf "$bundle" \
  scripts/compose.sh \
  deployment/traefik.yml \
  deployment/generated/dynamic.yml \
  docker-compose.generated.json \
  infra/redeploy-on-ec2.sh
bundle_base64=$(base64 < "$bundle" | tr -d '\n')

ready_command="test -f /var/lib/greenhouse-bootstrap-complete && mountpoint -q /opt/greenhouse && systemctl is-active --quiet docker"
ready_parameters=$(jq -cn --arg command "$ready_command" '{commands:[$command]}')
ready_id=$(aws ssm send-command \
  --profile "$aws_profile" --region "$aws_region" \
  --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript \
  --parameters "$ready_parameters" \
  --timeout-seconds 900 \
  --query Command.CommandId --output text)
if ! wait_for_command "$ready_id" 180; then
  aws ssm get-command-invocation \
    --profile "$aws_profile" --region "$aws_region" \
    --command-id "$ready_id" --instance-id "$instance_id" \
    --query StandardErrorContent --output text >&2 || true
  echo "EC2 bootstrap did not complete successfully." >&2
  exit 1
fi

copy_command="install -d -m 0755 /opt/greenhouse && echo '$bundle_base64' | base64 -d | tar -xzf - -C /opt/greenhouse && chmod 0755 /opt/greenhouse/scripts/compose.sh /opt/greenhouse/infra/redeploy-on-ec2.sh"
copy_parameters=$(jq -cn --arg command "$copy_command" '{commands:[$command]}')
copy_id=$(aws ssm send-command \
  --profile "$aws_profile" --region "$aws_region" \
  --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript \
  --parameters "$copy_parameters" \
  --query Command.CommandId --output text)
wait_for_command "$copy_id" 60

deploy_command="/opt/greenhouse/infra/redeploy-on-ec2.sh '$image_uri' '$secret_arn' '$aws_region'"
deploy_parameters=$(jq -cn --arg command "$deploy_command" '{commands:[$command]}')
deploy_id=$(aws ssm send-command \
  --profile "$aws_profile" --region "$aws_region" \
  --instance-ids "$instance_id" \
  --document-name AWS-RunShellScript \
  --parameters "$deploy_parameters" \
  --timeout-seconds 1800 \
  --query Command.CommandId --output text)

if wait_for_command "$deploy_id" 360; then
  wait_status=0
else
  wait_status=1
fi

aws ssm get-command-invocation \
  --profile "$aws_profile" --region "$aws_region" \
  --command-id "$deploy_id" --instance-id "$instance_id" \
  --query StandardOutputContent --output text

if (( wait_status != 0 )); then
  aws ssm get-command-invocation \
    --profile "$aws_profile" --region "$aws_region" \
    --command-id "$deploy_id" --instance-id "$instance_id" \
    --query StandardErrorContent --output text >&2
  exit "$wait_status"
fi

echo "Deployed $image_uri"
