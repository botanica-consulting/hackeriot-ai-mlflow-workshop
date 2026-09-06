#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

participant="${1:-}"
confirmation="${2:-}"
if [[ ! "$participant" =~ ^[0-9]{1,2}$ ]] || (( 10#$participant < 1 || 10#$participant > 99 )); then
  echo "Usage: $0 PARTICIPANT_NUMBER --confirm" >&2
  exit 1
fi
if [[ "$confirmation" != "--confirm" ]]; then
  echo "Refusing to erase participant data without --confirm." >&2
  exit 1
fi

id=$(printf '%02d' "$((10#$participant))")
./scripts/compose.sh --env-file .env -f docker-compose.generated.json stop "app-$id" "mlflow-$id"
./scripts/compose.sh --env-file .env -f docker-compose.generated.json rm -f "app-$id" "mlflow-$id"
docker volume rm "greenhouse-mlflow-data-$id"
./scripts/compose.sh --env-file .env -f docker-compose.generated.json up -d "app-$id"
