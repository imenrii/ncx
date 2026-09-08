#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/docker" <<'SH'
#!/bin/sh
printf '%s\n' "$@" > "$DOCKER_ARGUMENTS"
SH
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" DOCKER_ARGUMENTS="$work/arguments"
export NCX_ENV_FILE="$work/settings file.env"
cp "$root/.env.example" "$NCX_ENV_FILE"
sh "$root/deploy/compose.sh" config --quiet
printf '%s\n' compose --project-directory "$root" --env-file "$NCX_ENV_FILE" \
    -f "$root/compose.yaml" config --quiet > "$work/expected"
cmp "$work/expected" "$DOCKER_ARGUMENTS"
rm "$NCX_ENV_FILE" "$DOCKER_ARGUMENTS"
if sh "$root/deploy/compose.sh" config --quiet >"$work/error" 2>&1; then
    echo 'Missing deployment settings were accepted.' >&2; exit 1
fi
test ! -e "$DOCKER_ARGUMENTS"
python3 - "$root/deploy/README.md" "$work" <<'PY'
import os
import pathlib
import subprocess
import sys

text = pathlib.Path(sys.argv[1]).read_text()
command = text.split("sh deploy/compose.sh exec -T ncx sh -eu -c '\n", 1)[1].split("\n' <", 1)[0]
directory = pathlib.Path(sys.argv[2]) / "binary"
directory.mkdir()
command = command.replace("/opt/ncx", str(directory))
valid = b"#!/bin/sh\nexit 0\n"
subprocess.run(["sh", "-eu", "-c", command], input=valid, check=True)
binary = directory / "ncx"
assert binary.read_bytes() == valid
assert binary.stat().st_uid == os.geteuid()
assert binary.stat().st_mode & 0o777 == 0o755
failed = subprocess.run(["sh", "-eu", "-c", command], input=b"#!/bin/sh\nexit 1\n")
assert failed.returncode != 0
assert binary.read_bytes() == valid
assert list(directory.iterdir()) == [binary]
PY
echo 'PASS: Compose settings and service-user local install instructions.'
