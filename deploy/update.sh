#!/bin/sh
set -eu

# Keep the executable on a writable volume; the rest of the image is read-only.
install_dir=${NCX_INSTALL_DIR:-/opt/ncx}
base=https://github.com/cchomelon/ncx/releases/latest/download
asset=ncx-x86_64-unknown-linux-musl
lock="$install_dir/.update-lock"
mkdir "$lock" 2>/dev/null || {
    echo "Cannot lock $install_dir. Check write access or another update." >&2
    exit 1
}
work=
cleanup() {
    [ -z "$work" ] || rm -rf "$work"
    rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
work=$(mktemp -d "$install_dir/.update.XXXXXX")
cd "$work"
for file in "$asset" "$asset.sha256"; do
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
        --connect-timeout 15 --max-time 300 --output "$file" "$base/$file"
done
# Read only the digest, not a filename supplied by the checksum file.
digest=$(awk 'NR == 1 {print $1}' "$asset.sha256")
[ "${#digest}" -eq 64 ] || { echo 'Invalid SHA-256 digest.' >&2; exit 1; }
case "$digest" in *[!0-9a-fA-F]*) echo 'Invalid SHA-256 digest.' >&2; exit 1;; esac
printf '%s  %s\n' "$digest" "$asset" | sha256sum -c -
chmod 0755 "$asset"
"./$asset" --help >/dev/null
# Rename on the same filesystem so a failed download cannot replace ncx.
mv -f "$asset" "$install_dir/ncx"
echo 'Installed the latest release. Restart the container to activate it.'
