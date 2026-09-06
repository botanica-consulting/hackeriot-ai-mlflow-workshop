#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
./scripts/compose.sh --env-file .env -f docker-compose.generated.json ps
