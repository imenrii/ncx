# Phases 0–6 implementation

Initial ncx checkpoint: `512f529`. Working branch:
`feat/bounded-viewer-contracts`. cuSURGE branch: `feat/ncx-viewer-contracts`.

The user deferred Steering and optional Metadata features, froze UI/text, and
restricted phase 4 to necessary spacing/position changes. Current module
contracts live in [docs/](../README.md); prior plans stay in this folder.

| Phase | Delivered | Contract |
| --- | --- | --- |
| 0 | Coarse-pointer targets, edge-mean overflow, calendar matching, coastline CSP, repaired captures, PR workflow | [Checks](../checks.md) |
| 1 | Canonical CF references/capabilities/time, generated DTOs and fixtures, strict runtime decoder, typed selections | [Data](../data-contract.md) |
| 2 | Bounded admission, typed read plans, response-owned permits, metadata limits, byte caches, sequential averaging | [Reads](../reading.md) |
| 3 | Named state events, shared latest-slice lifecycle/status, pure structured raster preparation | [Viewer](../viewer.md) |
| 4 | One common coarse-pointer target fix; existing layout and text retained | [Style](../plot-style.md) |
| 5 | Two-pass mesh arrays, bounded hit index, geometry worker, upload reuse, curve envelope, PNG sampling metadata | [Rendering](../viewer.md#work-and-ownership) |
| 6 | local/HTTP/HTTPS modes, strict SSH defaults, key/password policy, trusted proxy checks, replacement lifetime | [Hub](../hub.md) |

No CSS framework, state library, worker framework, server regridding, new
comparison controls, or Steering runtime was added. Geometry-specific plot
behavior remains with its view; files were not split to meet a size target.

## Verification

- Rust: 65 tests passed; the separate real OpenSSH test passed. Formatting and
  clippy with denied warnings passed.
- Frontend: 31 test files passed; TypeScript and Vite build passed.
- Browser: rectilinear, curvilinear, UGRID, projected UGRID, helper filtering,
  grouped UGRID, comparison, collection, station, wind, and hub passed. Added
  wind unit-assignment and pressure/grid/mesh checks passed. Grouped references
  cross metadata, HTTP requests, and mesh rendering without a browser resolver.
- Visual: 35 fixed-font captures passed on two runs. Compared with checkpoint
  `512f529`, only Settings coarse-pointer capture differed beyond tolerance,
  due to the reproduced 44 px target fix. Narrow cuSURGE capture inspected.
- Deployment: actual TLS/auth proxy, forged peer/headers, origin, password
  rejection, ten sessions, and eleventh-session refusal passed. Real OpenSSH
  rejected unknown and changed keys; explicit accept-new accepted first contact
  but rejected changed keys. Static hosting/update/config checks passed.
- cuSURGE: 66 web tests and 47 subtests passed; console checks reported 104
  assertions without errors; real embedding and export passed with rebuilt ncx.
- Documentation links, YAML syntax, script syntax, and whitespace checks passed.
- Final web assets and the optimized release binary built successfully.

Measured fixture results on this machine: 203,522 triangles fell from about
350 ms / 210 MiB RSS to 117 ms; final combined renderer fixture RSS was 104 MiB.
One million curve samples fell from a 13.7 MB path to 48 KB, prepared in 125 ms.
Ten child viewers plus the hub used a sum of process peak RSS of 137,768 KiB
for the classic fixture, below the 512 MiB test ceiling. These measurements do
not claim to bound arbitrary NetCDF/HDF5 native allocations.

CI includes contract, smoke, visual diff, performance, proxy, SSH, and release
build checks. It has not run remotely. Required-check branch protection is a
repository setting. Docker Compose is unavailable here, so container execution
was skipped after static checks. Cross-repository embedding is checked locally;
CI does not assume credentials for the separate cuSURGE checkout. cuSURGE's
solver-wide `scripts/verify.sh` was not run for this web-only fix.

The two pre-existing cuSURGE preset edits remain untouched. Implementation
changes remain available for review after the initial checkpoint.
