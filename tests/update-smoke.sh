#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin" "$work/install" "$work/release"
export NCX_INSTALL_DIR="$work/install" RELEASE_FIXTURE="$work/release"
export PATH="$work/bin:$PATH"
cat > "$work/bin/curl" <<'SH'
#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output) output=$2; shift 2;;
        https://github.com/cchomelon/ncx/releases/latest/download/*) url=$1; shift;;
        *) shift;;
    esac
done
cp "$RELEASE_FIXTURE/${url##*/}" "$output"
SH
chmod +x "$work/bin/curl"
asset=ncx-x86_64-unknown-linux-musl
printf '#!/bin/sh\nexit 0\n' > "$work/release/$asset"
checksum() {
    (cd "$work/release" && sha256sum "$asset" > "$asset.sha256")
}
checksum
printf 'old binary\n' > "$work/install/ncx"
sh "$root/deploy/update.sh"
cmp "$work/release/$asset" "$work/install/ncx"
test -x "$work/install/ncx"
cp "$work/install/ncx" "$work/expected"
expect_failure() {
    if sh "$root/deploy/update.sh"; then
        echo 'Update unexpectedly succeeded.' >&2
        exit 1
    fi
    cmp "$work/expected" "$work/install/ncx"
    test ! -e "$work/install/.update-lock"
    test "$(find "$work/install" -name '.update.*' | wc -l)" -eq 0
}
printf 'corrupt download\n' >> "$work/release/$asset"
expect_failure
printf '#!/bin/sh\nexit 1\n' > "$work/release/$asset"
checksum
expect_failure
printf 'invalid checksum\n' > "$work/release/$asset.sha256"
expect_failure
rm "$work/release/$asset"
expect_failure
mkdir "$work/install/.update-lock"
if sh "$root/deploy/update.sh"; then exit 1; fi
cmp "$work/expected" "$work/install/ncx"
test -d "$work/install/.update-lock"
rmdir "$work/install/.update-lock"
echo 'PASS: update install, checksum, executable, download failure, and lock checks.'
