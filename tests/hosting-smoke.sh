#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

for file in Dockerfile .dockerignore .gitignore compose.yaml README.md deploy/apache-ncx.conf.example deploy/update.sh deploy/package-release.sh; do
    test -f "$file" || {
        echo "missing hosting file: $file" >&2
        exit 1
    }
done
test ! -e .env.example || {
    echo 'obsolete deployment template is still present' >&2
    exit 1
}

# The hosted service has no deployment-time secret or configurable Compose
# value. Keep these checks on the files operators copy or edit, not this test.
for file in compose.yaml README.md deploy/apache-ncx.conf.example; do
    if grep -nE '\.env|env_file|NCX_SSH_PASSWORD|\$\{' "$file"; then
        echo "forbidden deployment configuration in $file" >&2
        exit 1
    fi
done
if grep -nE '(^|/)\.env([[:space:]]|$)' .dockerignore .gitignore; then
    echo 'obsolete environment-file ignore entry remains' >&2
    exit 1
fi

sh tests/update-smoke.sh
if grep -nE 'FROM rust|cargo |COPY \. \.|npm |build-essential' Dockerfile; then
    echo 'Build tools or source copy found in the runtime image.' >&2
    exit 1
fi
grep -Fq 'RUN update.sh' Dockerfile
grep -Fq 'deploy/update.sh /usr/local/bin/update.sh' Dockerfile
grep -Fq 'x86_64-unknown-linux-musl' deploy/update.sh
grep -Fq 'ncx-binary:/opt/ncx' compose.yaml
grep -Fq 'platform: linux/amd64' compose.yaml
grep -Fq '/usr/local/bin/ncx' Dockerfile
grep -Fq 'ENV HOME=/home/ncx' Dockerfile
grep -Fq '127.0.0.1:8765:8765' compose.yaml
grep -Fq -- '--listen' compose.yaml
grep -Fq '0.0.0.0:8765' compose.yaml
grep -Fq -- '--base-path' compose.yaml
grep -Fq -- '- /ncx' compose.yaml
grep -Fq -- '--local-root' compose.yaml
grep -Fq -- '- /data' compose.yaml
grep -Fq -- '--session-limit' compose.yaml
grep -Fq -- '- "10"' compose.yaml
grep -Fq -- '--session-ttl-seconds' compose.yaml
grep -Fq -- '- "90"' compose.yaml
grep -Fq -- '--remote-ncx' compose.yaml
grep -Fq -- '- /usr/local/bin/ncx' compose.yaml
grep -Fq '/srv/netcdf:/data:ro' compose.yaml
grep -Fq './deploy/known_hosts:/home/ncx/.ssh/known_hosts:ro' compose.yaml
grep -Fq 'read_only: true' compose.yaml
grep -Fq 'size=64m' compose.yaml
grep -Fq 'cap_drop:' compose.yaml
grep -Fq -- '- ALL' compose.yaml
grep -Fq 'no-new-privileges:true' compose.yaml
grep -Fq 'pids_limit: 128' compose.yaml
grep -Fq 'mem_limit: 2g' compose.yaml
grep -Fq 'restart: unless-stopped' compose.yaml
grep -Fq 'http://127.0.0.1:8765/ncx/healthz' compose.yaml
grep -Fq 'http://127.0.0.1:8765/ncx/' deploy/apache-ncx.conf.example

grep -Fq 'Apache HTTPS is required' README.md
grep -Fq 'https://hostname/ncx/user@host:/absolute/path.nc' README.md
grep -Fq 'masked' README.md
grep -Fq '90-second heartbeat expiry' README.md
grep -Fq 'ControlMaster' README.md
grep -Fq 'no database and no file watcher' README.md

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
compose() {
    docker compose -f compose.yaml -f "$work/override.yaml" -p "$project" "$@"
}
cleanup() {
    compose down --timeout 10 --remove-orphans --volumes >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
: > "$work/known_hosts"
cat > "$work/override.yaml" <<EOF
services:
  ncx:
    ports: !override
      - "127.0.0.1:$port:8765"
    volumes: !override
      - ncx-binary:/opt/ncx
      - type: bind
        source: "$root/tests/data"
        target: /data
        read_only: true
      - type: bind
        source: "$work/known_hosts"
        target: /home/ncx/.ssh/known_hosts
        read_only: true
EOF

compose config --quiet
compose build
compose up --detach --wait
compose exec -T ncx sh -ec '
    test "$(id -u)" = 10001
    for tool in cargo rustc node npm cc; do
        ! command -v "$tool"
    done
    test -x /usr/local/bin/update.sh
    test -w /opt/ncx
    test ! -w /usr/local/bin
'
compose exec -T ncx update.sh
compose restart ncx

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

container=$(compose ps --quiet ncx)
compose stop --timeout 10
if [ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" != 0 ]; then
    echo 'hosting container did not stop cleanly' >&2
    exit 1
fi
compose down --timeout 10 --remove-orphans --volumes
if [ -n "$(compose ps --quiet ncx)" ]; then
    echo 'hosting container was not removed' >&2
    exit 1
fi
trap - EXIT HUP INT TERM
rm -rf "$work"
echo 'PASS: Docker hub health, local session relay, close, and clean shutdown.'
