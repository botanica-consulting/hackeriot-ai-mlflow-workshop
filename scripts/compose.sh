#!/usr/bin/env bash

if docker compose version >/dev/null 2>&1; then
  docker compose "$@"
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose "$@"
else
  echo "Docker Compose is required." >&2
  exit 1
fi
