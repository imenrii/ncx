# Steering

Steering runs Python, NumPy, and Dask in a browser worker. It reads admitted
NetCDF sources through the viewer's bounded slice interface. It does not run
Python on the server or write source files.

## Variables and expressions

One `Variable` type represents source, resident, and calculated data:

```python
t = sources.s1["/CLK"]
t += 1.45
panels[0].show(t)
```

Lookup and arithmetic do not load the values. They create an immutable
expression with dimensions, dtype, coordinates, units, and source identity.
`+=` rebinds the Python name to a new expression. Other names and existing plot
bindings retain their previous versions:

```python
original = t
t += 1
# original and the curve still refer to the version supplied to show().
panels[0].show(t)
```

Pointwise arithmetic keeps native coordinates. A scalar offset uses the
variable's native units. Source-unit conversion is explicit through `to_unit`.
Variables are immutable; use another expression instead of writing into their
buffers. `Variable` is the sole constructor name.

```python
surface = sources.s1["/temperature"].isel({"/time": 0})
anomaly = surface - np.nanmean(surface)
panels[0].show(anomaly)
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
panels[0].show(c)
```

Constructing a resident variable copies its input. Later changes to the input
array cannot change the variable. `with_values` creates a same-shape replacement with explicit units and a name.

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
Indices start at zero; `panels[0]` is the main panel.

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
p = frame.append(speed)               # First append is panels[1]
p.data                               # Bound immutable Variable
p.probe.data                         # Probe series, or None
p.show(speed.to_unit("kt"))           # Replace the one panel binding
p.clear()                            # Hide this panel
p.remove()                           # Remove this panel
panels[0].reset()                        # Restore the viewer selection
```

`panel.show(data)` is the sole binding operation. Rebinding clears an old probe;
showing the same content again preserves it. The selected Field/Curve page
chooses the renderer without changing the binding. `frame.append(data)` creates
a new panel, or use `p = frame.append(); p.show(data)`.

The pre-release aliases `Array`, `plots`, `panel1`, `Variable.probe`, and the
`.field`/`.curve` display handles were removed. Use `Variable`, `panels[index]`,
`panel.show(data)`, and `panel.probe.data`.

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
layout afterward. **Insert** lists panel data, probe, and panel handles.

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
accepted expressions in the browser; the next Enter starts Python and restores them for later reads.
Only expressions from this session are restored.

## Console editing and inspection

Open **Steering** at the right of the topbar. Its pressed button closes the
panel. The log takes the full width. Code uses Commit Mono Web and local Speed
Highlight assets. There is no Run button or permanent hint row: the input
placeholder names Shift+Enter, the one key that is not obvious. The head shows a
state word (loading, running, failed, stopped) only while Python is not ready.
**Insert** (Ctrl+I) filters source variables, workspace names, and display
handles and puts one at the cursor. The drawn three-dot menu holds Clear log,
Reset workspace, and Quick reference, a collapsible command and keyboard
reference. An empty log shows three examples; a press puts one in the input and
does not run it.

| Action | Behavior |
| --- | --- |
| Enter | Accept a visible completion, or submit complete Python input |
| Shift+Enter | Insert a line with indentation |
| Tab / Shift+Tab | Accept a completion, or indent / unindent code |
| Ctrl+Space | Request completion explicitly |
| Up / Down | Navigate completions, or recall whole submissions at input line edges |
| Ctrl+R | Search command history; selecting a match restores editable input |
| Ctrl+I | Open Insert with its filter focused |
| Escape | Dismiss completion or history search |

Pasting multiline code never executes it. Incomplete Python input remains in the
editor for continuation. The input stays editable while a computation runs;
another submission is not queued. Closing the panel retains the unfinished input,
log, variables, and plots. While a command runs, the `>>` prompt becomes a
drawn Stop key. Clear log and Reset workspace are separate actions in the
three-dot menu.

Completion covers admitted source paths, variables, display objects, methods,
NumPy names, and known function parameters. Signatures omit arbitrary default
representations. Completion and Insert use the same object descriptions and
do not evaluate user getters or read numeric source data.

Variable results expand to shape, dtype, dimensions, units, expression, and
storage state. Resident arrays and ordinary containers receive bounded summaries.
Expansion does not compute a lazy variable. Errors show the message and user-code
line first, with internal frames under **Traceback**. **Edit command** restores
the failing submission without running it.

## Workspace, identity, and bounds

The browser owns committed panel state. Python has one `Workspace` with a
revisioned snapshot, the user namespace, sources, published variables, and one
map of pending panel commands. A configure message updates that snapshot only
when its revision advances. Source metadata is sent at worker initialization.
Completion reads the workspace; it does not configure, delete, or replace panels.
Display snapshots are cached independently of editor and log notifications.

Each panel snapshot contains one data reference and one native probe selection.
Probe position and curve extraction derive from that selection. Fixed selectors
are separate from spatial probe indices. Pending moves and copies change the
same command record used for publication; there is no global “last probe”.

Within a session, variables carry a SHA-256 numerical token built from the node, operand tokens,
source generation and selection, and captured array bytes. The wire identity
also includes dimensions, coordinates, units, unit kind, and name. Thus two
independently typed `t + 1` expressions reuse an admitted binding, while changing
a label or unit cannot silently reuse old display metadata. Identity describes
the recorded expression, not algebraic equivalence. Opaque callbacks receive unique identities rather than being deduplicated across
expression objects. Callbacks must be deterministic; materialize a bounded result
first when they depend on mutable external state.

Source and resident Dask arrays receive explicit names. The scalar cache accepts
only explicit expression/selection keys, not arbitrary Dask-generated task keys.
A cached full-domain reduction can be reused across bounded display selections.
`compute()` returns detached arrays so later edits cannot corrupt those caches.

A binding owns its reader and metadata. Curve extraction reads that binding
directly, including area averages; it does not create temporary dataset entries.
Only Field/Value renderer bindings enter the synthetic-dataset registry. The
session owns their registration lifetime. Field geometry validation uses the
same reader without changing the binding's budget fields.

Publication checks one cost record: bindings, geometry, curve reservations, and
caches. Existing and replacement bindings count together. Admission occurs before
geometry reads and is checked again after asynchronous validation. A failed or
stale batch cannot replace panels or leave temporary renderer registrations.
A 32 MiB cache retains evaluated slices; a 16 MiB cache retains probe curves.
Log size is measured only when entries change, rather than on every UI update.

Independent source tasks overlap up to four reads. Each pending read reserves
space for its result and transfer conversion before it starts. NumPy tasks run
in dependency order, release consumed buffers, and yield between tasks. The
worker still serializes evaluations and terminal commands: this preserves one
workspace owner and one computation budget. NetCDF reads remain serialized per
open dataset on the server. Read overlap does not make NetCDF itself parallel.

The pinned runtime is packaged locally, including Dask's pure-Python wheels.
`web/python/packages.json` records wheel names and SHA-256 hashes. Builds check
these hashes and the Pyodide NumPy/YAML lock entries. There is no runtime CDN,
and ordinary viewing does not initialize Python. The Dask task adapter is tied
to the pinned task format; its tests must pass when Dask is upgraded.

Accepted expressions retain a cloudpickle payload for worker restart. These
bytes are executable: only the current session's worker can create them. Host
source messages, files, metadata, URLs, and imported data cannot supply a payload
for `restore()`. This is a closed internal transport, not a general pickle import
API. A resident array can exist both in the Python heap and in its retained
serialized payload; serialization is not zero-copy. Browser publication accounts
for retained payloads, coordinates, geometry, curve storage, and caches. Arbitrary
Python objects and temporary NumPy allocations remain outside a hard heap cap.

Limits are defined once in `steering/model.ts`: 32 MiB per materialized result,
4 MiB source blocks, four concurrent reads, 128 MiB of accounted computation
buffers, 100,000 Dask tasks, expression depth 64 and a conservative 10,000-node
estimate, 64 MiB of publication storage, bounded console output/history, and a
two-minute startup/execution limit. Expression complexity is checked before a
new Dask metadata operation, so long arithmetic chains fail admission rather
than overflow the interpreter stack.

Evaluation cancellation aborts source reads and cancels the Python task while
keeping the workspace. A two-minute timeout requests the same cancellation.
If the worker cannot acknowledge it within 1.5 seconds—for example while blocked
inside synchronous NumPy—the worker is terminated as a hard fallback. Stop is
always a hard interrupt. Accepted browser-side expressions survive a restart.

A worker separates execution from the UI thread; it is not an origin or authority
sandbox. Input files must remain stable. Growing files and external writers are
not supported. An embedding host must allow `worker-src 'self'` and
`script-src 'self' 'wasm-unsafe-eval'` on viewer responses. General JavaScript
`unsafe-eval` is unnecessary.

See the [refactor measurements](Progress/steering-refactor-performance.md) for
before/after timings, request counts, and limits of the measurements.

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
exercise actual panel rendering, probes, shared time, overlays, and export. Direct
session tests cover batch rejection, budgets, staleness, snapshots, and cancellation. See [checks.md](checks.md) for the wider viewer gates.
