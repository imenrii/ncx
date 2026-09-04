#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

for file in Dockerfile .dockerignore compose.yaml .env.example deploy/apache-ncx.conf.example; do
    test -f "$file" || {
        echo "missing hosting file: $file" >&2
        exit 1
    }
done

grep -Fq -- '--features netcdf/static' Dockerfile
grep -Fq '127.0.0.1:${NCX_HOST_PORT:-8765}:8765' compose.yaml
grep -Fq 'http://127.0.0.1:8765/ncx/' deploy/apache-ncx.conf.example
grep -Fq 'NCX_SSH_PASSWORD=' .env.example
if grep -Eq '^NCX_SSH_PASSWORD=.+$' .env.example; then
    echo '.env.example must not contain an SSH password' >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    echo 'SKIP: Docker Compose is unavailable; static hosting checks passed.'
    exit 0
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/ncx-hosting.XXXXXX")
project="ncx-hosting-$$"
port=$(python3 - <<'PY'
import socket
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    print(listener.getsockname()[1])
PY
)
password=$(python3 - <<'PY'
import secrets
print(secrets.token_hex(16))
PY
)
cleanup() {
    NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" down --timeout 10 --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
: > "$work/known_hosts"
cat > "$work/env" <<EOF
NCX_DATA_ROOT=$root/tests/data
NCX_KNOWN_HOSTS=$work/known_hosts
NCX_HOST_PORT=$port
NCX_SESSION_LIMIT=10
NCX_SESSION_TTL_SECONDS=90
NCX_SSH_PASSWORD=$password
EOF

NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" config --quiet
NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" build
NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" up --detach --wait

base="http://127.0.0.1:$port/ncx"
python3 - "$base" <<'PY'
import json
import sys
import time
import urllib.request

base = sys.argv[1]
for _ in range(60):
    try:
        with urllib.request.urlopen(base + "/healthz", timeout=1) as response:
            if response.read() == b"ok\n":
                break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit("hub health check did not become ready")

request = urllib.request.Request(
    base + "/api/session",
    data=json.dumps({"address": "/data/rectilinear.nc"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=10) as response:
    session = json.load(response)["session"]
headers = {"X-Ncx-Session": session}
with urllib.request.urlopen(urllib.request.Request(base + "/api/datasets", headers=headers), timeout=10) as response:
    datasets = json.load(response)["datasets"]
if not datasets:
    raise SystemExit("hub relay returned no datasets")
close = urllib.request.Request(base + "/api/session", headers=headers, method="DELETE")
with urllib.request.urlopen(close, timeout=10) as response:
    if response.status != 204:
        raise SystemExit(f"hub close returned {response.status}")
PY

container=$(NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" ps --quiet)
NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" stop --timeout 10
if [ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" != 0 ]; then
    echo 'hosting container did not stop cleanly' >&2
    exit 1
fi
NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" down --timeout 10 --remove-orphans
if [ -n "$(NCX_HOST_PORT="$port" docker compose --env-file "$work/env" -p "$project" ps --quiet)" ]; then
    echo 'hosting container was not removed' >&2
    exit 1
fi
trap - EXIT HUP INT TERM
rm -rf "$work"
echo 'PASS: Docker hub health, local session relay, close, and clean shutdown.'
