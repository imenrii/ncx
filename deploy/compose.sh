#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
settings=${NCX_ENV_FILE:-"$root/.env"}
if [ ! -f "$settings" ]; then
    echo 'Missing settings. Copy .env.example to .env and edit it.' >&2
    exit 1
fi
exec docker compose --project-directory "$root" --env-file "$settings" -f "$root/compose.yaml" "$@"
