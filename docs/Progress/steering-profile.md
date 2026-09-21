# Steering ownership, anomaly workflow, and performance

Status: measured investigation and proposed changes. Product behavior is unchanged.

## Ownership and units

These commands have different effects:

```python
p = sources.s1["/msl"].to_unit("hPa")  # New lazy variable
plots.field.show(p)                     # Bind it to Field
```

The browser check confirms that assignment leaves the plot at Pa. Showing `p`
changes the plot unit to hPa, but the Metadata tab still shows the source's Pa
attribute. That tab receives the original metadata and variable in `Viewer.tsx`;
the toolbar uses `presentationVariable`, which can be the published binding.

Assignment should not change the file variable or select a plot. `p` and the
source are different objects. The UI gap is that the inspected object is not
clear, and there is no common inspection path for a source, expression, and
display binding.

Use one owner per object, shared by the two interfaces:

| Object | Owner | Interface behavior |
| --- | --- | --- |
| Source descriptor and data | Rust source catalog | Source attributes remain original |
| Derived variable | Immutable expression | Shape, coordinates, unit, and provenance follow the expression |
| Plot binding and presentation | Browser session | Toolbar and Python commands update the same state |

The browser must be able to represent an ordinary source binding without
starting Python. The Python handle reads the command's captured display state
and submits changes to the existing browser owner. Do not introduce two mutable
metadata stores with reciprocal synchronization.

Proposed behavior:

- Inspecting `p` shows hPa and its source provenance. Inspecting its source
  shows Pa. The Metadata view identifies the inspected object explicitly and
  can follow the active plot binding.
- A display-unit change from either interface updates one plot presentation
  field. A proposed `panel1.field.unit = "hPa"` would be equivalent to the Unit
  dropdown. This setter is **not implemented**; the current property is read-only.
- `p.to_unit(...)` continues to create a lazy converted variable. A display-only
  unit choice reuses native samples and changes their presentation.
- On `show()`, resolve the new data unit and any retained display-unit choice
  together. Currently `unitId` can survive a change of binding; an old explicit
  choice can convert the new values back to the previous display unit.

This is compatible with the existing immutable Variable model. The main work is
unifying the binding and inspection paths, not making Python assignment mutate
all views of a source.

## Current anomaly workflow

In Curve view, with Normal and TideOnly admitted as `s1` and `s2`, and the same
station selected in both:

```python
normal, tide = await view.match(view.s1, view.s2)
anomaly = normal - tide
panel2.curve.show(anomaly)
```

This sequence was run against two 50,000-sample station sources. The values were
checked against materialized NumPy subtraction, including a missing sample.
The main curves remain visible; panel 2 shares their X interactions and has an
independent Y range. `panel2.curve.reset()` restores host/default content.

`view.match` checks shapes, coordinate values, coordinate units/calendars, and
data-unit text. It does **not** check station identity, physical quantity, or
vertical datum. Ordinary subtraction is positional. Inspect those scientific
identities before treating two curves as comparable.

The current cuSURGE flow does more before rendering: its Python endpoint finds
the paired output, checks station/quantity/units, timestamps and available datum,
checks run/publication state, and limits sample count. Its browser publishes the
result as a secondary curve with `difference: true`, a name, and matched style.
Observed anomaly is a separate observation-minus-tide calculation. This is not
the same operation as removing a time mean.

The terminal can only read admitted sources. A TideOnly file used privately by
cuSURGE's endpoint does not become a Steering source automatically.

## Improvements driven by this use case

1. Preserve scientific identity through selection and compatible arithmetic.
   Extend explicit matching to quantity, location, and datum when provided;
   reject conflicts and explain what is unknown. Keep pairing and run-completion
   rules with cuSURGE.
2. Carry the existing `unit_kind="delta"` through to curve presentation. The
   Python subtraction already sets it, but `CurveSeries` does not carry it and
   terminal publication does not set the host's `difference` flag. The measured
   terminal anomaly has no zero reference line. Difference conversion, a zero
   line, and a range that includes zero should follow the same data property.
3. Add an immutable `rename()` operation. A proposed
   `(normal - tide).rename("Anomaly")` should change metadata without copying or
   evaluating samples. The current name remains the first operand's name;
   assigning the Python name `anomaly` does not rename the object.
4. Reuse the current evaluated curve when its immutable expression ID and
   selection are unchanged. A repeated `show(anomaly)` currently reads both
   operands and the X coordinate again. Start with reuse of the active binding,
   not an unbounded general cache. Source and coordinate reads can later share
   a bounded cache keyed by source revision, selection, and transport dtype.
5. Keep admitted operands separate from plot participation. A hidden TideOnly
   operand should stay available without forcing another main-panel curve.
   Both source catalog and plots still reference the same source identity.
6. Keep updates explicit initially. Changing a station does not retarget an
   immutable `anomaly`; rerun the three commands. If automatic updates become
   necessary, give a plot one explicit derived binding with dependencies on the
   selected station and source revisions. Do not rerun arbitrary console history
   or make all Python variables reactive.
7. Make the lower panel easier to inspect while the terminal is open. The
   current two-panel layout keeps an 18rem minimum per plot and scrolls. At
   1440 × 900 with the default terminal height, most of panel 2 is below the
   visible plot area. Offer a panel focus action or allow a smaller terminal
   height without changing the plotted data.

## Measured results

Measurements taken on 2026-09-18. Values below are medians of five trials;
parentheses contain the observed minimum–maximum, not confidence intervals.
Individual timings, byte counts, binary hashes, and environment details are in
[steering-profile.json](steering-profile.json).

| Measurement | Before Steering | Current |
| --- | ---: | ---: |
| Field first display, browser cold | 394 ms (345–460) | 425 ms (367–429) |
| Field first display, warm navigation | 221 ms (207–302) | 225 ms (208–238) |
| Field frame change, first repaint | 89 ms (77–107) | 90 ms (61–95) |
| Field display-unit change | 46 ms (34–49) | 46 ms (38–60) |
| Two station curves, browser cold | 420 ms (371–452) | 436 ms (395–498) |
| Two station curves, warm navigation | 363 ms (348–384) | 364 ms (314–432) |
| Curve resize | 74 ms (66–79) | 77 ms (58–83) |
| Prepared host anomaly to display | 155 ms (151–186) | 149 ms (141–192) |
| 320 × 320 mesh preparation, Node | 112.6 ms | 111.8 ms |
| Million-sample curve preparation, Node | 121.6 ms | 123.9 ms |

No Python worker or runtime assets were requested before opening Steering.
Cold source-data response bytes were unchanged: 266,500 bytes for the field and
1,200,000 bytes for two station curves. Unit changes and curve resizing caused
no additional data reads in either version. Unit changes reuse the existing
raster; waiting for a new raster would measure the wrong event.

The initial frontend resource payload increased by 64,844 bytes in both cases.
The main JavaScript bundle grew from 472,192 to 526,929 bytes (+11.6%). The release
binary grew from 5,184,848 to 24,008,968 bytes, mainly from bundled runtime assets.
Field browser-tree RSS with Steering closed was 767 MiB before and 764 MiB now;
station RSS was 780 MiB before and 785 MiB now. These differences are small
relative to process-tree variation.

| First-use or terminal operation | Current |
| --- | ---: |
| Python ready after opening, field | 4,411 ms (4,371–4,476) |
| Python ready after opening, station | 4,381 ms (4,313–4,435) |
| Runtime asset response bodies | 18,712,524 bytes (17.85 MiB) |
| Field browser-tree RSS increase on Python start | 265 MiB median (224–299) |
| Converted field `show(p)` to paint | 157 ms (147–175) |
| Match two 50,000-sample time axes | 99 ms (96–100) |
| Subtract and show anomaly to paint | 257 ms (242–290) |
| Repeat `show(anomaly)`, command completion | 283 ms (266–301) |

Each initial and repeated anomaly publication read 1,200,000 bytes: 400,000
bytes from each operand and 400,000 bytes of time coordinates. Matching is
additional work and is measured separately. The checked numerical results
agree with NumPy subtraction, including missing values. None of the terminal
anomaly plots contained a zero reference line; the prepared host anomaly did.

Interpretation: the measured cold-start medians increased by about 8% for Field
and 4% for Curve, with overlapping trial ranges. The sample does not establish
how much is bundle overhead versus workstation/browser noise. Steady-state
interaction and geometry preparation stayed close to baseline. First-use Python
latency and memory, plus repeated full-curve reads, are the clearest costs.

Prioritize active-binding result reuse and complete difference metadata. Keep
Python lazy. A later split of the editor/highlighter bundle could reduce the
closed-panel frontend cost, but do not preload the runtime to hide startup time.
The 128 MiB computation-buffer allowance is not a cap on total browser memory.

## Benchmark method

Baseline: `b43a784f0c9af4d53e5c78ea19521cd6310f6d7b`, the checkpoint immediately
before Steering implementation. It includes the preceding viewer improvements
and has no Python runtime. Current: the uncommitted implementation including the
help dialog. Both binaries use release builds and matching cached font subsets.

Five trials per version and fixture, alternating baseline/current order. Each
trial starts a new viewer and a fresh Firefox profile at 1440 × 900. A second
navigation in the same profile measures warm HTTP-cache behavior. These are
browser-cold starts, **not** cold operating-system disk caches.

- Field: uncompressed 32 × 256 × 256 float32 pressure variable (8 MiB of samples).
- Station: two uncompressed 50,000-sample float32 curves with float64 time axes.
- First display: navigation start to a rendered canvas/SVG plus two animation
  frames. Action measurements also include polling/automation and frame waits;
  they are user-visible latency proxies, not isolated CPU timings.
  A field can first paint a preview; this profile does not separately time the
  final settled-resolution frame or measure GPU frame throughput.
- Existing-host anomaly: publish a prepared 50,000-sample secondary curve through
  `setSources`. This measures admission/rendering; it excludes cuSURGE requests
  and anomaly computation.
- Terminal anomaly: coordinate matching is measured separately; command-to-paint
  includes evaluation, source reads, publication, and rendering after Python is ready.
- Memory: Linux sum of RSS for the Firefox process tree, and viewer process
  high-water RSS. Shared pages can be counted more than once. These are not
  Python heap, private memory, or whole-application memory limits.
- Geometry: existing 320 × 320 mesh and million-sample curve benchmark, five
  process runs per version; each process reports its own median of three builds.

The machine is a shared Linux workstation with Xeon Gold 6258R CPUs, Firefox
151.0.4, Node 24.18.0, and Rust 1.97.1. Small timing differences are not evidence
of a regression without a larger controlled sample. These fixtures do not
establish performance on multi-gigabyte compressed files, remote SSH links,
moving meshes, or arbitrary Python allocations.

## Reproduce

Generate fixtures with an environment that already has NumPy and netCDF4:

```sh
python tests/steering-profile-fixtures.py /tmp/ncx-profile-data
node tests/steering-profile.mjs /path/to/baseline/ncx target/release/ncx \
  /tmp/ncx-profile-data /tmp/ncx-profile-results
node --expose-gc tests/performance.mjs
```

Build the baseline from an isolated archive of `b43a784`, with the same sibling
Style/lib resources and cached font subsets. Its tracked `web/dist` contains the
pre-Steering frontend. Do not replace the working tree or its binaries to build
the baseline. Build the current frontend and release binary before comparison.

The runner writes raw timings, response sizes, and screenshots. The fixture
generator overwrites only `field.nc`, `normal.nc`, and `tide.nc` in its chosen
output directory. `NCX_PROFILE_RUNS` changes the trial count; the default is five.
