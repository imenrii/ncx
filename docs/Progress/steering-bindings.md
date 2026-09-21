# Variables, probes, and dynamic panels

Status: implemented for probes, frames, append/remove, renaming, shared bindings,
and primary metadata inspection, 2026-09-21. Writable display properties below
remain proposed. See [the current contract](../steering.md).
This proposal follows the [measured investigation](steering-profile.md).

## Recommended interface

Build a full-domain expression once and select what each plot needs:

```python
u10 = sources.s1["/u10"]
v10 = sources.s1["/v10"]
s10 = np.hypot(u10, v10).rename("Wind speed")

panel1.field.show(s10)
panel2.curve.show(s10.probe)

p = frame.append()
p.field.show(s10)
```

`np.hypot(u10, v10)` computes the elementwise vector magnitude. In ordinary
NumPy, the second positional argument of `sqrt` is an output buffer, so
`np.sqrt(u10, v10)` must retain its normal meaning and must not be rewritten
as a vector magnitude. References: [hypot](https://numpy.org/doc/stable/reference/generated/numpy.hypot.html),
[sqrt](https://numpy.org/doc/stable/reference/generated/numpy.sqrt.html).

The full expression remains lazy. Field applies its current non-spatial
selectors and display sampling. A point probe selects the fixed native indices
and retains the chosen Curve Along dimension. A plot never changes the meaning
or dimensionality of the input Variable to make it fit.

For a curve-only calculation, the user's shorter form is also valid:

```python
u10 = sources.s1["/u10"].probe
v10 = sources.s1["/v10"].probe
s10 = np.hypot(u10, v10)
panel2.curve.show(s10)
```

Here `s10` is a 1D variable. Showing it as a 2D field must give a clear shape
error. Retain the full expression when both field and curve views are wanted.
Provenance is useful for explanation and coordinate lookup; it is not permission
to undo a user's selection when a different renderer receives the result.

## Probe meaning

`variable.probe` uses the workspace's current GUI probe, fixed dimension
selectors, and Curve Along dimension. This selection has one browser owner.
Capture its revision once per submitted command so all operands in that command
use the same selection. Property access resolves an immutable lazy selection;
it does not load values or require a separate snapshot command.

For the initial implementation, moving the GUI probe does not mutate an already
assigned Variable. Re-evaluating `s10.probe` obtains the new selection. This keeps
the accepted assignment and plot-version behavior intact. Automatic probe
following, if added, should be an explicit plot binding to a selection reference.

Missing probes and incompatible grids fail explicitly. A native cell index is
valid only for the source geometry that defines it. Same-shaped arrays alone
do not prove a common grid. Geometry compatibility and coordinate identity are
separate from rendering and from NumPy function availability.

For area probes, operation order is scientifically significant:

```python
vector_mean_speed = np.hypot(u.probe, v.probe)
mean_speed = np.hypot(u, v).probe
```

The first averages components before computing magnitude; the second averages
magnitudes. The expression preserves this distinction. Push point/index
selections into pointwise source operations, but do not move an area reduction
across a nonlinear operation.

## Frame and panels

`frame` is the parent of the visible panels. Each panel owns one active plot
kind, one data binding, and presentation settings. `panel.field` and
`panel.curve` are typed handles to that same panel state; they own no separate
mutable copies. `panel.field.show(value)` selects Field and replaces that
panel's binding. `panel.curve.show(value)` does the same for Curve.

```python
p = frame.append()             # Allocate one stable panel identity
p.field.show(s10)
p.curve.show(s10.probe)         # Replace this panel's field with a curve

frame.append().field.show(s10)  # Add another field panel
p.remove()                     # Remove this panel
```

Use parentheses for `append()`: creating a panel is an action. Reading
`frame.append` must not create anything during inspection or completion.
Append and show changes in one submission are admitted together, so a failed
show does not leave a new empty panel. `clear()` hides content; `remove()` removes
the panel from layout.

Keep `panel1`, `panel2`, and `plots` (an alias of panel1) as stable handles for
compatibility. Do not introduce a second numbered naming scheme such as
`plots2`. An ordered `frame.panels` collection controls layout. Stable IDs control
identity: removing or moving a panel cannot retarget an existing Python handle.
Once removed, a handle reports that its panel is unavailable.

The main panel keeps the existing Field/Curve controls, with one selected view
of its current binding. A kind change must validate the selection required by
the target view. Source field expressions can supply a curve through a probe;
a curve-only variable cannot supply a field.

## State and metadata

The required records are small:

| Record | Authoritative content |
| --- | --- |
| Source | Admitted identity, revision, file metadata, coordinate/geometry references |
| Variable | Immutable expression, shape, axes, unit, quantity, location/datum when known, name, provenance |
| Selection | Probe geometry and current dimension choices with a revision |
| Panel | Stable ID, plot kind, binding, display settings |
| Binding | Variable identity and logical selection |

The toolbar, Python display handle, inspector, and renderer all resolve the
same panel binding. Derived metadata is computed from that binding. Serialized
descriptors sent across the worker boundary are read-only representations of
one version, not independent mutable authorities.

```python
p = sources.s1["/msl"].to_unit("hPa")
panel1.field.show(p)
panel1.field.unit = "hPa"
```

The first line constructs a derived variable. The second binds it. The third
sets display presentation through the same operation as the Unit dropdown.
The inspector identifies the object being inspected and shows the bound
variable's hPa unit, with the original Pa source available through provenance.
Rebinding a Python name still does not retarget a previously shown expression.

Carry quantity, coordinate identity, unit, and absolute/difference status through
operations where those meanings are known. In particular, compatible U/V
magnitude retains its velocity unit, and subtraction retains difference status
through plotting. Unknown unit transformations require an explicit declaration.
NumPy/Dask continue to determine which numerical operations are available; this
does not introduce an allowed-function list.

## Optimization priorities

1. Reuse the active evaluated binding when expression identity and selection are
   unchanged. The profile measured 1.2 MB of repeated reads for the same anomaly.
2. Let panels reference the same expression and scientific metadata. Keep
   viewport samples and presentation per plot. A second panel does not need
   another full-domain array or another Python runtime.
3. Deduplicate bounded source and coordinate reads across bindings by source
   revision, selection, and transport dtype. Count shared storage once against
   the workspace budget. Release or evict cache data when it is no longer needed.
4. Resolve point probes before reading source values. Keep full-domain reductions
   on their declared domain; never calculate them from a display preview.
5. Preserve the current no-read display-unit path. Metadata inspection, renaming,
   and panel creation must not materialize data.
6. Schedule only visible plots and cancel obsolete requests. Apply the existing
   workspace memory admission to dynamically added panels, rather than multiplying
   an independent allowance by panel count.
7. Keep Python startup lazy and use the recorded baseline to check ordinary
   viewing, repeated show, and multi-panel resource use after implementation.

## Implementation order

Replace the fixed `field | curve | panel2` target table with stable panel
records and one binding/presentation owner. Route the existing UI and terminal
through it, including metadata inspection and difference presentation. Add
evaluated-binding reuse at that owner. Then add probe selection and dynamic
panel allocation to this same structure. Update the collapsible terminal help
with the supported examples after behavior is verified.
