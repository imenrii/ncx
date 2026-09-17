# Executable gates

Run checks from the ncx root unless noted. Node 24 runs the TypeScript tests
without an extra test runner. Rust tests require the NetCDF C library. Browser
checks require Firefox and local loopback sockets.

```bash
cargo fmt --check
cargo test --locked
cargo clippy --locked --all-targets -- -D warnings
(cd web && npm ci && npm test && npm run build)
cargo build --locked
```

The Rust tests check generated DTOs and serialized fixture metadata. Pair each
NetCDF fixture with its CDL source. Rebuild changed fixtures with `ncgen`; use
`-4` for grouped files. The generated protocol update command is in the
[data contract](data-contract.md).

## Browser and deployment

```bash
for scenario in rectilinear curvilinear ugrid ugrid_projected ugrid_helpers grouped_ugrid comparison collection station wind hub; do
  node tests/ui-smoke.mjs "$scenario"
done
python3 tests/policy-smoke.py
cargo test real_ssh_rejects_unknown_and_changed_host_keys -- --ignored
```

The ignored SSH test needs `/usr/sbin/sshd`, `ssh`, `ssh-keygen`, and `/run/sshd`.
It uses generated temporary keys and no user credentials. The HTTPS test uses
OpenSSL and a temporary certificate, authentication proxy, and child viewer.
The proxy test also opens all ten allowed child viewers and rejects an eleventh.
On Linux it limits the sum of hub/child peak RSS to 512 MiB for the classic
fixture; this is a fixture budget, not a bound for arbitrary files.
Neither needs an external service. `tests/hosting-smoke.sh` additionally checks
the Docker Compose deployment when Docker is available.

## Visual and performance gates

```bash
NCX_VISUAL_PROFILE=open node tests/ui-visual.mjs /tmp/ncx-visual
python3 tests/visual-diff.py tests/visual-baseline /tmp/ncx-visual
node --expose-gc tests/performance.mjs
```

The visual profile uses bundled open fonts, hides the live clock, and fixes
viewport size and device scale. CI pins Firefox 151.0.4 on Ubuntu 24.04. The
comparison allows a 24-level channel difference in at most 0.5% of pixels.
PNG dimensions and capture names must match exactly. Pillow is a test-only
Python dependency. A failed comparison saves `.diff.png` files for inspection.
Review visible differences before replacing committed baselines. Normal visual
capture without `NCX_VISUAL_PROFILE` checks the installed production fonts.

Performance fixtures cover a 320 × 320 grid and a million-point curve. Each
median preparation time must stay below 750 ms; mesh/index buffers below
16 MiB; curve path below 80,000 characters; and Node peak RSS below 256 MiB.
These generous regression ceilings are not a universal interactive-latency
promise. Browser smoke separately checks worker output and scalar-upload reuse.

`.github/workflows/check.yml` runs these gates on each PR and main/master push.
Repository administrators must make `checks` a required branch check. Adding a
workflow file does not itself configure branch protection.

## cuSURGE boundary

From a sibling cuSURGE checkout, after rebuilding ncx:

```bash
python3 -m pytest tests/web -q
node tests/web/console-checks.js
NCX_BINARY=/absolute/path/to/ncx/target/debug/ncx node tests/web/embedding-smoke.mjs
```

Use `PYTHON=/path/to/python` for the embedding test if its Python dependencies
are in a virtual environment. This gate starts the actual console and viewer;
it covers source replacement, locked offsets, supplied samples, the secondary
panel, responsive sizing, and PNG export. It requires access to the separate
cuSURGE checkout and is a local integration gate; the ncx workflow does not
assume private repository credentials. ncx's source-feed contract tests still
run on every PR. cuSURGE's full pre-merge gate remains `scripts/verify.sh`.

Build the delivery binary after checks:

```bash
cargo build --release --locked
```
