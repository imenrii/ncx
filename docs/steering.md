# Steering

Steering runs Python, NumPy, and Dask in a browser worker. It reads admitted
NetCDF sources through the viewer's bounded slice interface. It does not run
Python on the server or write source files.

## Variables and expressions

One `Variable` type represents source, resident, and calculated data:

```python
t = sources.s1["/CLK"]
t += 1.45
plots.curve.show(t)
```

Lookup and arithmetic do not load the values. They create an immutable
expression with dimensions, dtype, coordinates, units, and source identity.
`+=` rebinds the Python name to a new expression. Other names and existing plot
bindings retain their previous versions:

```python
original = t
t += 1
# original and the curve still refer to the version supplied to show().
plots.curve.show(t)
```

Pointwise arithmetic keeps native coordinates. A scalar offset uses the
variable's native units. Source-unit conversion is explicit through `to_unit`.
Variables are immutable; use another expression instead of writing into their
buffers. `Array` remains a constructor alias for `Variable`.

```python
surface = sources.s1["/temperature"].isel({"/time": 0})
anomaly = surface - np.nanmean(surface)
plots.field.show(anomaly)
```

The runtime applies a display selection through pointwise operations before
reading. A reduction still uses its full logical domain: the mean above is
not computed from preview pixels. Dask supplies chunk operations and NumPy
compatibility; ncx does not maintain a function whitelist. Not every NumPy
function has a Dask implementation. Unknown result shapes fail admission rather
than cause an unbounded allocation.

Named dimensions of array operands must agree. Direct arithmetic is positional;
use `await view.match(a, b)` when coordinate equality needs to be checked. There
is no implicit interpolation or station/provider matching. General NumPy
functions can change axes or physical meaning, so their results may have
unnamed index dimensions and unspecified units. Declare new metadata explicitly
when needed; `with_unit` labels values, while `to_unit` converts values.

## Explicit materialization

The ordinary plot workflow needs no `read()` or `.values`. For code that needs
an actual NumPy array, computation remains explicit:

```python
values = await t.compute()             # detached NumPy array
loaded = await t.read()                # resident Variable
loaded.values                         # read-only resident values
```

`isel` accepts canonical dimension paths or unique short names, integer indices,
and positive-stride slices. `await t.coordinate(dim)` resolves the selected
native coordinate. Supplied external curves appear as `/series`, with a `/time`
coordinate, under their admitted source alias. Aliases remain stable when source
order changes.

`view.s1` captures the current logical source extraction at submission. It
includes fixed indices and excludes viewport sampling. An explicit source
reference remains available when a cross-dataset extraction has no valid mapping.

```python
c = Variable(np.array([1., 3., 2.]), dims=("x",),
             coords={"x": {"values": [0., 1., 2.], "unit": "s"}},
             unit="m", name="Example")
plots.curve.show(c)
```

Constructing a resident variable copies its input. Later changes to the input
array cannot change the variable. `with_values` provides compatibility for a
same-shape replacement with explicit units and a name.

For explicit streaming algorithms:

```python
total = np.float64(0)
count = 0
async for block in t.blocks():
    valid = np.isfinite(block.values)
    total += np.sum(block.values, where=valid, dtype=np.float64)
    count += np.count_nonzero(valid)
mean = total / count if count else np.nan
```

Blocks cover the selection once. Retaining them all still retains the whole
selection. Chunking does not make every FFT, sort, or factorization fit in memory.

## Panels and probe selections

A panel binds one immutable Variable. Its Field and Curve views derive from that
binding. Both pages use the same ordered collection, `panels` (`frame.panels`).
Indices start at zero. `plots` refers to `panels[0]`.

```python
u = sources.s1["/u10"]
v = sources.s1["/v10"]
speed = np.hypot(u, v).rename("Wind speed")
p = frame.append(speed)
```

Field shows the selected source and `speed` in separate cells. Each panel owns
its probe. Curve omits a spatial panel until that panel has a valid probe.
A 1D series appears directly in Curve and has no Field view. A scalar appears
as a value and has no Curve view.

Click a field or place its probe in the terminal:

```python
p.probe.position                              # None until placed
await p.probe.move(longitude=115.75, latitude=28.5)
series = p.probe.data                          # Immutable lazy Variable
await p.probe.move(x=1200, y=4800)              # Native grid coordinates
p.probe.clear()                               # Keep the field; remove its curve
```

Copy a probe to another panel with the same source geometry and logical selection:

```python
panels[1].probe = panels[0].probe
panels[1].probe = None             # Clear the destination probe
```

Assignment copies the current selection and updates the destination marker and
curve. Each panel keeps its own handle and data; subsequent probe moves remain
independent. Copying an unplaced probe clears the destination. For different
grids or selections, use `await p.probe.move(...)` with coordinates so the
destination resolves its own native location.

The field marker and automatic curve read the same panel selection. A move
resolves before the next statement. A failed move preserves the previous probe.
The position reports native `x`, `y`, and geographic coordinates when available.
Projected grids accept native coordinates. Saved variables such as `series`
keep the selection captured when assigned; moving the panel probe cannot change
them. Mesh hit testing and edge-area averaging use the GUI geometry helpers.

An anomaly is ordinary subtraction. Place a probe on its field to see its curve:

```python
normal, tide = await view.match(sources.s1["/water_level"],
                              sources.s2["/water_level"])
p = frame.append((normal - tide).rename("Anomaly"))
```

Direct arithmetic is positional. `view.match` checks coordinate equality; it
does not interpolate. Operation order remains significant for area probes:
averaging components before `np.hypot` differs from probing a speed field.

## Frames and live display objects

```python
panels is frame.panels                # True
plots is panels[0]                    # True
p = frame.append(speed)               # First append is panels[1]
p.data                               # Bound immutable Variable
p.curve.data                         # Probe series, or None
p.show(speed.to_unit("kt"))           # Replace the one panel binding
p.clear()                            # Hide this panel
p.remove()                           # Remove this panel
plots.reset()                        # Restore the viewer selection
```

`p.field.show(data)` and `p.curve.show(data)` are compatibility forms of
`p.show(data)`. They bind the same panel and do not change the selected page.
`frame.append().field.show(data)` remains valid. Rebinding clears an old probe;
showing the same immutable expression again preserves it.

The frame starts with one panel. Up to 16 panels are admitted. Removing a panel
shifts later collection indices; a saved handle keeps its identity. Removed
handles reject further commands. Appending and showing in one command are
admitted together. A rejected publication leaves the previous frame intact.

There is one time slider and playback state. Time-dependent fields match its
exact timestamp. A missing sample makes that field unavailable; it does not use
the same sample number or a nearby time. Explicit time slices remain static.
Playback waits for field views to finish. Full time curves reuse their selected
series when the slider moves; only the selected-time marker changes.

Pressure and wind settings are global. Compatible panels use the selected source
components with their own geometry and probe. Unsupported source geometry or
partial spatial axes show a reason; ncx does not regrid overlays. Curves retain
independent ranges and interaction state.

Fields use equal grid cells, with one column on narrow screens. Curves stack
vertically. PNG export includes the current page's eligible views, including
scrolled panels, with the canonical print type and spacing. It restores the web
layout afterward. The Outline lists panel data, probe, Field, and Curve handles.

Terminal properties use the state captured for the command. Expanded display
results show current browser state, marked **current**. The default panel's
`data` refers to the selected source. Metadata shows the primary panel's bound
variable and derived units; source entries continue to describe source data.

`show` stages an immutable expression version. Successful submissions apply all
staged plot and probe changes together after validation. Exceptions, Stop,
changed sources/selections, or a newer plot choice discard the batch. Python
assignments retain Python semantics; they are not rolled back. Rebinding or
deleting a Python name cannot change an accepted plot.

`clear()` prevents host defaults from reopening a panel. `reset()` restores the
latest default/host content. A source change invalidates old expressions and
resets the workspace. Host calculations cannot overwrite a user binding.

Field expressions use bounded display selections. Curves materialize a bounded
full line. Area curves accumulate one sample at a time. Mesh publication requires
complete native spatial geometry and does not remap connectivity. Stop retains
accepted expressions in the browser; Start Python restores them for later reads.
Only expressions from this session are restored.

## Console editing and inspection

Open **Steering** at the right of the topbar. Its pressed button closes the
panel. The Outline shares the main sidebar width. Code uses Commit Mono Web
and local Speed Highlight assets. There is no Run button or permanent hint row.
The **[?]** button beside Terminal options opens a collapsible command and keyboard reference.

| Action | Behavior |
| --- | --- |
| Enter | Accept a visible completion, or submit complete Python input |
| Shift+Enter | Insert a line with indentation |
| Tab / Shift+Tab | Accept a completion, or indent / unindent code |
| Ctrl+Space | Request completion explicitly |
| Up / Down | Navigate completions, or recall whole submissions at input line edges |
| Ctrl+R | Search command history; selecting a match restores editable input |
| Escape | Dismiss completion or history search |

Pasting multiline code never executes it. Incomplete Python input remains in the
editor for continuation. The input stays editable while a computation runs;
another submission is not queued. Closing the panel retains the unfinished input,
log, variables, and plots. Stop is available while busy. Clear log and Reset
workspace are separate actions in terminal options.

Completion covers admitted source paths, variables, display objects, methods,
NumPy names, and known function parameters. Signatures omit arbitrary default
representations. Completion and Outline use the same object descriptions and
do not evaluate user getters or read numeric source data.

Variable results expand to shape, dtype, dimensions, units, expression, and
storage state. Resident arrays and ordinary containers receive bounded summaries.
Expansion does not compute a lazy variable. Errors show the message and user-code
line first, with internal frames under **Traceback**. **Edit command** restores
the failing submission without running it.

## Runtime and bounds

Identical expressions shown again or in another panel reuse their admitted
binding and curve arrays. A bounded 32 MiB cache deduplicates evaluated display slices; a 16 MiB cache
reuses probe curves by binding and selection. Shared bindings are counted once; publication checks existing
and replacement data together with cached results against the workspace budget.
Changing sources clears the cache. Stop discards worker state and pending work.
New expressions serialize once per submission; already admitted expressions
are referenced by identity when another panel uses them.
Complete coordinate reads reuse the viewer cache with a copy for worker
transfer. Partial coordinate requests remain partial. See the
[paired panel performance record](Progress/steering-panel-performance.md) for measured
latency, transfer sizes, and remaining costs.

The pinned runtime is packaged locally, including Dask's pure-Python wheels.
`web/python/packages.json` records wheel names and SHA-256 hashes. The build
checks these hashes and the Pyodide NumPy/YAML lock entries. No CDN is used at
runtime, and ordinary viewing does not initialize Python.

`steering/evaluation.py` adapts the pinned Dask task format to awaited source
reads. It executes tasks in dependency order, releases consumed intermediates,
and retains a bounded cache of scalar results so panning does not repeat a
completed full-domain reduction. Graph fusion is disabled because a source task
must finish its asynchronous read before NumPy consumes its result. Check this
adapter when upgrading Dask.

Executable limits live in `steering/model.ts`: 32 MiB per materialized result,
4 MiB source blocks, 128 MiB of accounted computation buffers, 100,000 task nodes,
64 MiB of published expression/data admission, bounded console output and history,
and a two-minute execution/startup timeout. Publication counts old content while
preparing its replacement. A rejected replacement keeps the old plot.

These limits cover ncx-owned buffers and work. Arbitrary NumPy temporaries and
user Python objects have no hard heap cap. A worker separates execution from the
UI thread but is not an origin or authority sandbox. Stable input files are
required; growing files and external writers are not supported.

An embedding host must allow `worker-src 'self'` and
`script-src 'self' 'wasm-unsafe-eval'` on viewer responses. General JavaScript
`unsafe-eval` is unnecessary. cuSURGE currently needs that viewer-only CSP change;
its console policy and calculation ownership stay separate.

## Checks

After building the frontend and Rust binary:

```bash
node tests/steering-python.mjs
node tests/steering-smoke.mjs
NCX_STEERING_CSP=1 node tests/steering-smoke.mjs /tmp/ncx-steering-csp
NCX_STEERING_MODE=hub node tests/steering-smoke.mjs /tmp/ncx-steering-hub
```

The runtime test covers immutable arithmetic, query selection, global reductions,
serialization, safe completion and inspection, and concise errors. Firefox tests
exercise the actual editor, rich output, lazy plots, stale publication, and worker
restart. See [checks.md](checks.md) for the wider viewer gates.
