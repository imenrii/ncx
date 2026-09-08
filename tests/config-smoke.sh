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
echo 'PASS: Compose receives the local settings file and rejects a missing file.'
