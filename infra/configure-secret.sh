#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and configure the selected AI provider first." >&2
  exit 1
fi

aws_profile=$(terraform -chdir=infra output -raw aws_profile)
aws_region=$(terraform -chdir=infra output -raw aws_region)
secret_arn=$(terraform -chdir=infra output -raw environment_secret_arn)
tunnel_token=$(terraform -chdir=infra output -raw cloudflare_tunnel_token)
participant_count=$(terraform -chdir=infra output -raw participant_count)
domain=$(terraform -chdir=infra output -raw domain)

temp_env=$(mktemp)
trap 'rm -f "$temp_env"' EXIT
chmod 600 "$temp_env"

awk \
  -v tunnel_token="$tunnel_token" \
  -v participant_count="$participant_count" \
  -v domain="$domain" '
    BEGIN { tunnel_seen = 0; count_seen = 0; domain_seen = 0 }
    /^CLOUDFLARE_TUNNEL_TOKEN=/ { print "CLOUDFLARE_TUNNEL_TOKEN=" tunnel_token; tunnel_seen = 1; next }
    /^PARTICIPANT_COUNT=/ { print "PARTICIPANT_COUNT=" participant_count; count_seen = 1; next }
    /^DEPLOY_DOMAIN=/ { print "DEPLOY_DOMAIN=" domain; domain_seen = 1; next }
    { print }
    END {
      if (!tunnel_seen) print "CLOUDFLARE_TUNNEL_TOKEN=" tunnel_token
      if (!count_seen) print "PARTICIPANT_COUNT=" participant_count
      if (!domain_seen) print "DEPLOY_DOMAIN=" domain
    }
  ' .env > "$temp_env"

provider=$(awk -F= '$1 == "AI_PROVIDER" { gsub(/["\047[:space:]]/, "", $2); print tolower($2); exit }' "$temp_env")
case "$provider" in
  openai)
    grep -Eq '^OPENAI_API_KEY=.+$' "$temp_env" || { echo "OPENAI_API_KEY is empty in .env" >&2; exit 1; }
    ;;
  openrouter)
    grep -Eq '^OPENROUTER_API_KEY=.+$' "$temp_env" || { echo "OPENROUTER_API_KEY is empty in .env" >&2; exit 1; }
    ;;
  *)
    echo "AI_PROVIDER must be openai or openrouter in .env" >&2
    exit 1
    ;;
esac

aws secretsmanager put-secret-value \
  --profile "$aws_profile" \
  --region "$aws_region" \
  --secret-id "$secret_arn" \
  --secret-string "file://$temp_env" \
  --query VersionId \
  --output text >/dev/null

echo "Updated the encrypted workshop environment in AWS Secrets Manager."
