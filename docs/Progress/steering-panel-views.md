# Paired panel views

Status: implemented. This replaces the single-kind
panel model in [steering-bindings.md](steering-bindings.md).

Accepted: anomaly is ordinary subtraction on the bound variables; its curve is
the probe view of the resulting field. Global time matches exact timestamps.
Probe access identifies a panel explicitly. The collection and editable probe interface below are accepted.

## Model

A panel owns one scientific data binding and its local selection/presentation.
Field and Curve are views derived from that binding. The frame selects which
page is visible. There are no independent field-panel and curve-panel registries.

```text
Frame
  selected page: Field | Curve | Metadata
  global time: coordinate reference + selected position
  global overlays: pressure and wind configuration
  ordered panels

Panel
  stable identity
  data: immutable Variable/expression reference
  probe: native location/area, or none
  other fixed selectors and Curve Along dimension
  field and curve presentation settings
```

Remove `PanelState.kind`. Do not store an independently mutable curve binding
for a field-backed panel. Its curve is derived from the panel's data and probe.
Renderer buffers remain disposable caches, not scientific data authorities.

## Visible behavior

| Bound data | Field page | Curve page |
| --- | --- | --- |
| Spatial variable, no probe | Field at global time | No corresponding plot |
| Spatial variable, valid probe | Field at global time | Curve from its own probe |
| 1D series | No field view | Direct curve |
| True 0D scalar | Value readout | No invented time series |

The Field page contains only field/value views. The Curve page contains only
curve views. An unavailable probe curve does not allocate an empty plot slot.
The Outline can indicate that the panel needs a probe. Panel identity and order
remain stable even when one page omits its view.

Changing one panel's probe updates only its derived curve. It does not change
another panel's probe, binding, or range. The shared controls are
the selected page, time, and pressure/wind configuration. Sharing immutable
cached data is an implementation detail, not communication between panels.

The global time selection matches an exact timestamp in each time-dependent
binding. A missing sample makes that field unavailable; there is no nearest-time
or equal-index fallback.
Static or explicitly time-sliced variables remain static. No panel owns a
second time input or independent playback state. Playback waits for the visible
time-dependent field views to finish the current frame before advancing.

Pressure/wind toggles and component choices are global. Each eligible view uses
that configuration with its own geometry and probe. Unsupported geometry is
reported explicitly; global settings do not imply automatic regridding.

## Interface

```python
u = sources.s1["/u10"]
v = sources.s1["/v10"]
speed = np.hypot(u, v).rename("Wind speed")
p2 = frame.append(speed)
```

Panel 1 still contains the selected variable. Panel 2 contains `speed` and starts
without a probe. Field shows both. Curve shows panel 2 only after a valid probe
is placed on its field; subsequent probe changes update that curve automatically.

`frame.append(data)` is the shortest form of adding a bound panel. The existing
`frame.append().field.show(data)` can remain a compatibility form for the same
operation. A panel-level `show(data)` replaces its one binding. Typed view handles
can remain convenient interfaces, but must not create a separate binding for
each renderer or change the global selected page as a side effect.

An anomaly needs the same workflow as any other derived variable:

```python
anomaly = normal - tide
p = frame.append(anomaly)
```

When the operands are fields, the result is a field and its panel provides both
views. Its curve is selected by its own probe. There is no anomaly-specific
panel or independent curve override. Ordinary 1D data still has no field
capability; this follows from the data domain, not a separate panel type.

## Collection naming and editable probes

Use `panels` as a short alias for the `frame.panels` collection. Indexing
is zero-based: `panels[0]` is the first panel and `panels[1]` is the second.
Both pages use this same collection. Omitting an unprobed curve does not change
its panel's index. Removing a panel shifts later indices, as with an ordinary
sequence; a saved handle such as `p` continues to identify the same panel.
Start with the default panel; do not reserve an empty secondary panel. With one
existing panel, the first append produces `panels[1]`.

```python
panels[1]  # The second existing panel
p = frame.append((normal - tide).rename("Anomaly"))
```

`p.probe` is an explicit handle to the panel's selection, now that
the position must be readable and editable:

```python
p.probe.position
await p.probe.move(longitude=115.75, latitude=28.5)
series = p.probe.data
p.probe.clear()
```

`position` reports the current probe location, or `None` when unset. `move()`
uses the same geometry resolver and sampling behavior as a GUI click. It is
awaitable because resolving coordinates can require geometry reads. It completes
resolution before a subsequent statement reads `probe.data`. A failed move
leaves the previous selection intact. Native projected coordinates can use
`move(x=..., y=...)`, with units taken from the coordinate metadata.

The probe handle does not own a second mutable position. It reads and changes
the panel's selection. A successful move updates the field marker and automatic
curve. `probe.data` returns an immutable lazy Variable for the selected curve;
previously assigned Python Variables retain their selections. The read-only
Curve projection uses that same selection automatically, so ordinary display
does not require another `show()` call. Clearing the probe removes its automatic
curve but keeps the panel and field.

The probe handle is accepted. Read its selected Variable through `.data`.

## Implementation consequences

- Use the same panel model and view-selection path for the original and appended
  panels. Remove the special appended-field time inputs and default overlay settings.
- Derive eligible views from data geometry and selections. Keep explicit hidden
  state separate from an unavailable/uninitialized curve.
- Build probe curves only when needed on the Curve page or explicitly requested
  by Python. A playback time change must not reread an unchanged full time series;
  it can update its time marker. A spatial profile at a fixed time does depend
  on the global time selection.
- Reuse the existing bounded caches by expression and resolved selection. Never
  use display preview pixels as inputs to calculations.
- Export only the selected page's eligible views. Preserve canonical field-grid
  export and stacked curve layout.

## Verification

The Python runtime and Firefox checks cover binding identity, independent probe
state, terminal moves and clear, exact global time, omitted unprobed curves,
collection indices, and field export. See [steering-panel-performance.md](steering-panel-performance.md)
for the release-binary comparison and its limits.

## Probe assignment

`panels[1].probe = panels[0].probe` copies the current selection into the
destination panel. The destination keeps its probe handle and scientific binding;
its marker and curve update through the normal publication path. Later probe
changes remain independent. Assigning `None` or an unplaced probe clears the
selection. Copying requires the same source geometry and logical selection;
other grids use the awaitable coordinate move to resolve their native indices.

The runtime check covers assignment, unchanged handle identity, destination
values, independent clear, invalid domains, and failed-command rollback. Copying
itself performs no numeric reads. Firefox checks the actual marker and curve on
rectilinear and UGRID fields. This fixes the former writable attribute, which
replaced the Python handle without publishing a selection change.
