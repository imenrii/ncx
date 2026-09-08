#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

for file in Dockerfile .dockerignore .gitignore .env.example compose.yaml README.md \
    deploy/README.md deploy/compose.sh deploy/update.sh deploy/package-release.sh; do
    test -f "$file" || { echo "Missing hosting file: $file" >&2; exit 1; }
done
sh tests/update-smoke.sh
sh tests/config-smoke.sh
grep -Fxq '.env' .gitignore
grep -Fxq '.env.*' .dockerignore
grep -Fxq '*.key' .gitignore
grep -Fxq '**/*.key' .dockerignore
grep -Fq 'RUN update.sh' Dockerfile
if grep -nE 'FROM rust|cargo |COPY \. \.|npm |build-essential' Dockerfile; then
    echo 'Build tools or source copy found in the runtime image.' >&2; exit 1
fi
services=$(awk '/^volumes:/ {exit} /^  [a-zA-Z0-9_-]+:/ {print $1}' compose.yaml)
[ "$services" = 'ncx:' ] || { echo 'Hosting must use one ncx service.' >&2; exit 1; }
grep -Fq 'source: "${NCX_DATA_ROOT:?' compose.yaml
grep -Fq '${NCX_BIND_ADDRESS:?' compose.yaml
grep -Fq '${NCX_PORT:?' compose.yaml
grep -Fq '"ndots:${NCX_DNS_NDOTS:-1}"' compose.yaml
grep -Fq 'http://127.0.0.1:8765/ncx/healthz' compose.yaml
if grep -nE 'NCX_SSH_PASSWORD|seccomp=unconfined' compose.yaml; then
    echo 'Unexpected deployment setting.' >&2; exit 1
fi
grep -Fq 'deploy/README.md' README.md

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
export NCX_ENV_FILE="$work/settings.env"
export NCX_BIND_ADDRESS=127.0.0.1 NCX_PORT="$port" NCX_DATA_ROOT="$work/data" NCX_DNS_NDOTS=1
printf 'NCX_BIND_ADDRESS=127.0.0.1\nNCX_PORT=%s\nNCX_DATA_ROOT="%s/data"\n' "$port" "$work" > "$NCX_ENV_FILE"
compose() {
    docker compose --env-file "$NCX_ENV_FILE" -f compose.yaml -f "$work/override.yaml" -p "$project" "$@"
}
cleanup() {
    compose down --timeout 10 --remove-orphans --volumes >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM
mkdir "$work/data"
cp tests/data/rectilinear.nc "$work/data/"
cat > "$work/override.yaml" <<EOF
services:
  ncx:
    dns_search:
      - search.test
    networks:
      default:
        aliases:
          - lookup.search.test
    volumes: !override
      - ncx-binary:/opt/ncx
      - "$work/data:/data:ro,Z"
EOF
compose config --quiet
compose build
compose up --detach --wait
# curl uses the same musl resolver as SSH. Only the suffixed alias exists.
compose exec -T ncx curl --noproxy '*' --fail --silent --show-error \
    --connect-timeout 3 --max-time 5 http://lookup:8765/ncx/healthz
compose exec -T ncx sh -ec '
    test "$(id -u)" = 10001
    for tool in cargo rustc node npm cc; do ! command -v "$tool"; done
    test -x /usr/local/bin/update.sh
    test -w /opt/ncx
    test ! -w /usr/local/bin
'
compose exec -T ncx update.sh
compose restart ncx

python3 - "$port" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request

base = f"http://127.0.0.1:{sys.argv[1]}/ncx"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(60):
    try:
        with opener.open(base + "/healthz", timeout=1) as response:
            if response.read() == b"ok\n":
                break
    except (OSError, urllib.error.URLError):
        pass
    time.sleep(1)
else:
    raise SystemExit("Hub health check did not become ready")

request = urllib.request.Request(
    base + "/api/session", data=json.dumps({"address": "/data/rectilinear.nc"}).encode(),
    headers={"Content-Type": "application/json"}, method="POST",
)
with opener.open(request, timeout=10) as response:
    assert response.status == 201
    session = json.load(response)["session"]
headers = {"X-Ncx-Session": session}
with opener.open(urllib.request.Request(base + "/api/datasets", headers=headers), timeout=10) as response:
    assert json.load(response)["datasets"]
with opener.open(urllib.request.Request(base + "/api/session", headers=headers, method="DELETE"), timeout=10) as response:
    assert response.status == 204
PY
container=$(compose ps --quiet ncx)
docker inspect --format '{{json .HostConfig.PortBindings}}' "$container" | \
    python3 -c 'import json, sys; bindings=json.load(sys.stdin); assert list(bindings) == ["8765/tcp"]; assert bindings["8765/tcp"][0]["HostIp"] == "127.0.0.1"'
compose stop --timeout 10
if [ "$(docker inspect --format '{{.State.ExitCode}}' "$container")" != 0 ]; then
    echo 'Hosting container did not stop cleanly.' >&2; exit 1
fi
compose down --timeout 10 --remove-orphans --volumes
trap - EXIT HUP INT TERM
rm -rf "$work"
echo 'PASS: DNS search, single container, local relay, update, port mapping, close, and shutdown.'
