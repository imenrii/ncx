# Probe and frame performance — 2026-09-21

This records the implemented `.probe`, `frame.append()`, shared bindings, and
multi-panel layout. The [original profile](steering-profile.md) contains the
baseline method and the earlier manual-Steering measurements. Individual trials
and release hashes are in [the JSON record](steering-frame-performance.json).

Five alternating baseline/current release trials per fixture, fresh Firefox
profiles at 1440 × 900, loopback transport, and a second navigation for the warm
measurement. The baseline is `b43a784`, before Steering. Fixtures are the same
32 × 256 × 256 pressure field and two 50,000-sample station curves. Browser-cold
does not mean cold OS disk caches. Times include automation and frame waits.

## Ordinary viewing

Values are medians in milliseconds, with observed minimum–maximum in parentheses.

| Operation | Before Steering | Current |
| --- | ---: | ---: |
| Field first display | 441 (358–519) | 379 (371–416) |
| Field warm navigation | 223 (206–323) | 239 (223–338) |
| Field frame change | 81 (61–109) | 93 (66–99) |
| Field display-unit change | 44 (29–48) | 45 (30–46) |
| Two curves, first display | 411 (379–463) | 439 (400–485) |
| Two curves, warm navigation | 304 (289–348) | 394 (356–426) |
| Curve resize | 76 (67–86) | 77 (74–87) |
| Prepared host anomaly display | 151 (146–215) | 154 (141–214) |

Cold-load and interaction ranges vary on this shared workstation. Warm curve
navigation was slower in the final sample: 394 ms versus 304 ms. Earlier runs
of the frame work showed medians of 317/362 and 342/306 ms (current/baseline).
Do not infer a reliable speedup or zero overhead from one set of five trials.
The warm-navigation cost remains a follow-up profiling target.

No Python worker/runtime was fetched with Steering closed. Unit changes and
curve resizing made no additional data reads. The existing geometry gate still
covers mesh construction and million-sample curve preparation; this run does
not establish GPU throughput or performance on large remote/compressed files.

## Terminal and additional panels

| Operation | Current median, ms (range) |
| --- | ---: |
| First Python startup, field | 4436 (4390–4541) |
| First Python startup, curves | 4452 (4322–4552) |
| Converted field to paint | 124 (109–141) |
| Match coordinate axes | 66 (65–82) |
| Calculate and paint anomaly | 277 (268–304) |
| Repeat show of the same anomaly | 85 (81–87) |
| Append the same field to paint | 74 (74–91) |
| Append the same curve, command completion | 119 (116–166) |

Compared with the earlier Steering profile, repeat-show median latency fell
from 283 to 85 ms (about 70%). Repeating or appending an admitted curve made
zero data requests in every trial. Appending the same field also made zero
data requests for this fixture and viewport; other viewports can request a new
bounded display slice.

Initial anomaly evaluation read 800,000 bytes instead of 1,200,000: the two
operands are needed, but the time coordinate now comes from the viewer cache.
Coordinate matching fell from the earlier 99 ms median to 66 ms. The initial
anomaly paint measurement itself was 277 ms, versus the earlier 257 ms; the new
layout is not claimed to make first calculation faster.

All ten edit events per field trial caused zero field-raster rebuilds. Python
first-use latency remains about 4.4 seconds, and its assets remain roughly
18.7 MB. RSS samples in the JSON sum browser-process RSS; shared pages can be
counted repeatedly, so they are not private heap measurements or a memory cap.

## Changes verified

- Panels reference immutable expression identities. New expressions serialize
  once per submission; accepted expressions are sent by identity.
- Active curve arrays and bounded evaluated slices are reused across panels.
- Complete coordinate reads share the existing viewer cache. Worker transfers
  copy cached coordinates, so a transfer cannot detach the viewer buffer.
- Stable field dimensions, curve ranges, and legends avoid work while editing.
- Shared-axis setup runs only when additional curve panels need it.
- Metadata displays the bound unit and source provenance. Anomaly curves retain
  difference status and draw a zero reference line.

Runtime tests and browser checks cover point/area probes, immutable selections,
append/remove and rollback, source/mesh validation, shared buffers, canonical
PNG layout, narrow screens, hub routing, and restrictive CSP. The ordinary
rectilinear, comparison, station, and wind browser regressions passed. Rust
checks passed (65 tests, one ignored), as did the 34 frontend test files.
The final geometry gate reported 108.6 ms for mesh preparation, 120.7 ms for the
million-sample curve, and 104.2 MiB peak Node RSS; all budgets passed.

## Reproduce

```sh
python tests/steering-profile-fixtures.py /tmp/ncx-profile-data
node tests/steering-profile.mjs /path/to/pre-steering/ncx target/release/ncx \
  /tmp/ncx-profile-data /tmp/ncx-profile-results
NCX_FRAME_TEST=1 node tests/steering-smoke.mjs /tmp/ncx-frame
```
