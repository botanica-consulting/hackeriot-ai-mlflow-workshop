#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill in the provider key and CLOUDFLARE_TUNNEL_TOKEN." >&2
  exit 1
fi

node scripts/generate-deployment.mjs --require-secrets
./scripts/compose.sh --env-file .env -f docker-compose.generated.json config --quiet
./scripts/compose.sh --env-file .env -f docker-compose.generated.json build app-01
./scripts/compose.sh --env-file .env -f docker-compose.generated.json up -d --remove-orphans
