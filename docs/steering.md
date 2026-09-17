# Steering interface proposal

Status: proposed, not implemented. Names and scheduling rules are for review.
UI and migration scope: [comparison plan](comparison-plan.md).

## Existing approaches

ParaView exposes its source/view model through Python and updates the GUI when
scripts change that model. Its shell initializes the interpreter when needed.
Use the shared application model and lazy initialization idea, without copying
its full proxy/pipeline system. Sources:
[shell implementation](https://github.com/Kitware/ParaView/blob/master/Qt/Python/pqPythonShell.cxx),
[scripting guide](https://docs.paraview.org/en/latest/UsersGuide/introduction.html#scripting-in-paraview).

napari exposes `update_console` to put application variables into its console.
Adopt named access to selected data, but use snapshots rather than writable
references to ncx's buffers. Source:
[napari viewer](https://github.com/napari/napari/blob/main/src/napari/viewer.py).

marimo builds a dependency graph from cell references and definitions. It also
offers lazy execution that marks affected work stale. Its documentation states
that object mutations are not tracked. Adopt invalidation, not hidden history
replay; do not introduce a notebook dependency engine. Sources:
[reactivity](https://github.com/marimo-team/marimo/blob/main/docs/guides/reactivity.md),
[runtime policy](https://github.com/marimo-team/marimo/blob/main/docs/guides/configuration/runtime_configuration.md).

The proposed pattern is a read snapshot plus explicit commands. The viewer
owns application state; Python reads a snapshot and returns a proposed panel
change. A single commit point accepts that change. Renderers and terminal
callbacks do not directly edit another module's state.

## Representation and ownership

| Representation | Owner | Interface and lifetime |
| --- | --- | --- |
| Source registry | ncx source controller | Add/remove/replace admitted inputs; host and standalone controls call this one interface |
| View snapshot | ncx data controller | Immutable selected arrays, axes, units, aliases, extraction, sampling, and data revision |
| Python workspace | Steering runtime | User variables and temporary arrays within one data revision; no writable viewer objects |
| Published curves | ncx panel controller | Accepted result buffers; later Python mutation cannot change them |
| Panel specification | ncx panel controller | Curve references, axes, range, style, and content ownership; renderer only consumes it |
| Host defaults | cuSURGE adapter | Default panel intent through the same controller; source refresh is a different command |

Aliases are stable keys, not list positions. Removing `s1` does not make another
source become `s1`. Replacing its data changes the revision. Labels can change
without changing identity. Aliases refer to the one source registry; they do
not contain another copy of its metadata.

A view variable contains the decoded selection before display offsets,
display-unit conversion, and line decimation. Expose native axes and units.
Record sampling/stride for previews. Do not claim these arrays contain the
entire file. Fields retain dimensions and shape; the second panel accepts only
explicitly constructed curves.

The reserved `view` object provides read-only access. An explicit copy belongs
to Python. Read-only NumPy flags prevent accidental writes but are not a
security boundary. Runtime buffers must be isolated from the browser's source
buffers even if code changes those flags.

## Small proposed Python interface

`view` lists source aliases and exposes their selected variable. `np` is NumPy.
For curves, `x` and `y` are aliases for axes and values, not duplicate storage.
`with_y` creates a derived curve on an existing X axis. Its unit is explicit
because arbitrary NumPy operations do not preserve physical units.

```python
view                         # s1, s2, ... with source and variable names
a, b = view.match("s1", "s2")
d = a.with_y(a.y - b.y, unit=a.yunit, name="A − B")
panel2.show(d)
```

```python
m = a.with_y(np.mean([a.y, b.y], axis=0), unit=a.yunit, name="Mean")
panel2.show(m)
panel2.show(d, m)             # replace panel contents
panel2.clear()               # hide the panel; keep Python variables
panel2.reset()               # release user ownership; restore default intent
```

`view.match` normalizes compatible axis units and requires equal X sample
coordinates for elementwise operations. It does not interpolate, compare
station IDs, or infer scientific meaning. Direct NumPy operations on `.y`
remain normal NumPy; ncx cannot infer their alignment or units. Unequal sample
grids require explicit alignment and curve construction. The result constructor
checks shape and declared axes.

Unit descriptors must distinguish absolute values from deltas where conversion
needs it, such as temperature differences. Supply that distinction explicitly;
do not infer it by parsing the Python expression. A ratio declares a
dimensionless Y unit.

Do not overload every NumPy function or create a custom array language.
Arithmetic, masks, and slicing use NumPy. ncx supplies source/view access,
curve construction, and panel publication. Scalars stay in the terminal unless
the user explicitly constructs a curve from them.

## Axis compatibility

Recommended interpretation of the user's unit/range rule:

- Curves need compatible X units and a common coordinate domain. Calendar
  identity is part of a time axis, not a scientific quality judgment.
- Curves sharing a Y axis need compatible declared Y units. Do not require
  equal observed Y minima and maxima. Use supported presentation conversions.
- Valid X ranges can differ. Show their union for ordinary overlays; do not
  discard samples. Check overlap only when an operation requires it.
- Equal ranges and lengths do not prove sample alignment: `[0, 1, 2]` and
  `[0, 0.5, 2]` have equal endpoints but differ inside.
- Preserve gaps and validate dimensions and transport size. Give a short error
  at the relevant control or terminal, without a certification workflow.

No viewer gate depends on quantity name, station, provider, or datum. These
remain available in Metadata and Python. cuSURGE can still enforce its provider
and case-output contracts before admitting a source.

## Execution and updates

Keep a Python workspace within a data revision. Run is explicit. Assignment
computes a variable; only a panel command changes plotted content. Source or
selection changes must not execute terminal history.

| Change | Python behavior | Panel behavior |
| --- | --- | --- |
| Execute | Run once against a fixed snapshot | Publish requested changes on success |
| Pan/zoom within loaded arrays | No execution | Redraw linked panels |
| Colour, display unit, or offset | No execution | Change presentation, not raw results |
| Source, variable, indices, probe, or sampled data changes | Cancel pending publication; discard old workspace arrays; keep input history | Clear old results; retain panel intent and one short rerun status |
| Error on unchanged data | Normal Python error; earlier assignments may exist | Keep the last accepted panel for this revision |
| Stop or worker restart | Discard pending publication and reset workspace | Keep accepted results only while their revision remains current |

Reset the user namespace when the data revision changes, so an old `a` cannot
quietly mix with a new `b`. Preserve input text, not old array aliases. Report
`View changed` once in Steering; do not add a warning sheet to the plot.

Automatic mode, if adopted, registers a transform with declared sources and
its own context. It receives current arrays and returns curves. Register its
complete code and explicit parameters rather than capture mutable terminal
locals or infer a program from history. Keep one run and the latest pending
input. Old results cannot publish. Removing a source invalidates the transform;
another source does not silently take its place.

This automatic-transform interface is a later design step. First ship manual
Steering. Keep current cuSURGE calculations until a tested generic automatic
interface preserves its existing update behavior.

## Publication and overrides

Store panel content intent as `default`, `user-snapshot`, or `user-hidden`.
Add `user-transform` only with explicit automatic mode. These states have
different ownership and lifetimes; do not approximate them with independent
booleans. All GUI, host, and terminal writes go through the panel controller.

| Action | Rule |
| --- | --- |
| Add/remove | Change registry and data revision; do not overwrite user panel intent |
| Successful `panel2.show(...)` | Replace second-panel curves; user owns its content |
| `panel2.clear()` | Set user-hidden; host refresh cannot reopen it |
| `panel2.reset()` | Restore default intent, using its latest valid data |
| Host source refresh | Update admitted source data only; no panel write |
| Host default update | Update default intent; do not replace an active user override |
| Toolbar style/range edit | Change existing presentation; do not change content ownership or run Python |
| Viewer generation replaced | Discard source, workspace, and panel state together |

Python queues a content change with the data revision and panel-content revision
captured at Run. Commit only if both still match. A newer show, clear, or reset
invalidates an older publication. Presentation is separate: keep current colour,
range, and display-unit settings when accepting new curves. The initial Python
interface does not write those settings, so it needs no per-property override
framework. One global last-writer rule would let a late calculation restore
old UI state.

Publication is atomic for panel updates, not arbitrary Python globals or side
effects. If `panel2.show(d)` is followed by an exception in the same submitted
block, no panel change commits. Python retains normal assignment semantics.
Multiple show calls in a block keep the last replacement.

## Runtime recommendation and limits

Use real Python/NumPy in an optional browser worker, started when Steering is
opened. Ordinary viewing does not load it. Package assets locally for offline
use; measure binary size and startup before fixing distribution. No Python
execution endpoint is added to Rust or cuSURGE. No JavaScript eval or imitation
Python parser is used. See [runtime research](steering-runtime-research.md).

Accept user-authored terminal code. Do not auto-execute code from NetCDF
attributes, URLs, or shared recipes. A worker separates execution from the UI
thread; it is not a network or same-origin security sandbox. An untrusted-code
mode would need additional isolation and is not promised here. The ncx bridge
exposes Add sources and panels, never server files, credentials, or solver
controls. This bridge restriction does not remove Python's other Web APIs.

Bound input/output arrays, queued runs, and retained history. Stop must terminate
the worker if cooperative interruption is unavailable. These limits do not cap
arbitrary NumPy temporary allocations; that remains a runtime feasibility limit.

## Acceptance checks

Test aliases after reorder/remove, late publication, errors after queued panel
updates, GUI changes during execution, unit conversion, unequal internal X
samples, gaps, Stop, and host refresh after show/clear/reset. Ordinary viewing
must work without Python assets. Test the same contract in the cuSURGE iframe
and local, HTTP, and HTTPS deployments.
