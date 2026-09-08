#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

# Run the repository tests before this script. Build tools stay on the host.
(cd web && npm run build)
env -u CMAKE_PREFIX_PATH -u HDF5_DIR -u NETCDF_DIR -u PKG_CONFIG_PATH \
    -u CPATH -u LD_LIBRARY_PATH -u CC -u CXX \
    NCX_PUBLIC_RELEASE=1 cargo zigbuild --locked --release --target x86_64-unknown-linux-musl \
        --features netcdf/static
python3 tests/release-smoke.py target/x86_64-unknown-linux-musl/release/ncx
out="$root/target/release-assets"
mkdir -p "$out"
cp target/x86_64-unknown-linux-musl/release/ncx "$out/ncx-x86_64-unknown-linux-musl"
(cd "$out" && sha256sum ncx-x86_64-unknown-linux-musl > ncx-x86_64-unknown-linux-musl.sha256)
echo "Release assets: $out"
