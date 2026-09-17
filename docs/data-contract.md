# Data contract

## Ownership

- `src/dataset.rs` owns the read-only NetCDF handle, raw metadata, typed read
  plans, decoding, and binary serialization.
- `src/cf.rs` owns CF/UGRID references and display capabilities. Raw attributes
  remain unchanged. The browser must not resolve CF paths or discover meshes.
- `src/server.rs` owns HTTP encoding. `web/src/data/api.ts` owns HTTP decoding
  and request serialization. Plot modules do not parse wire selections.

## Canonical manifest

`/api/meta` and `/api/datasets` carry `protocol_version`. Metadata identifies
variables with absolute paths. Each variable has a `capabilities` record:
resolved references, numeric/coordinate/geometry roles, time interpretation,
available geographic coordinate pairs, and initial display dimensions.
`view_hint` describes supported field geometry. `default_variable` is the
backend's initial selection. Dimension positions refer to the variable's own
dimension list; display axes must be distinct.

A relative reference is resolved against its owner's group, including `.` and
`..`. Missing references produce a warning and are omitted from the canonical
reference list. Explicit coordinate references never fall through to unrelated
variables. Cross-group explicit references are valid. Inference requires an
unambiguous coordinate pair in the owner or mesh group. Geographic pairs record
their dimensions so an alternate display plane can select the matching pair.

Unknown or broken CF conventions retain a plain numeric view where possible.
Unsupported model calendars remain numeric; they do not become UTC dates.
The browser formats supported time axes from the backend's multiplier, origin,
and offset. CF detection never rewrites source values or raw attributes.

## Generated types and validation

The Rust serializer types generate `web/src/generated/protocol.ts` with ts-rs.
The `protocol_types_are_current` Rust test checks the committed output and
metadata fixtures generated from `tests/data/*.nc`. Update both with:

```bash
NCX_UPDATE_PROTOCOL=1 cargo test protocol_types_are_current
```

`web/src/data/protocol.ts` validates incoming metadata before use. Unknown
versions, discriminants, and malformed required fields are errors. TypeScript
assertions alone are not an API boundary. Add a version when a wire change
cannot preserve the existing contract.

## Slices

Application code uses `SliceRequest.selection`: an index or a half-open
`{start, stop, stride}` range for each dimension. Only the HTTP adapter converts
this structure to `selection` and `stride` query strings. The Rust adapter
validates rank, bounds, integer arithmetic, wire type, and allocation estimates
before reading. The resulting `ReadPlan` is the executor's input.

Values use little-endian f32; coordinate requests can use f64. Missing values
are detected before applying packing scale and offset. Connectivity is checked
as integer data, with start-index and fill handling before geometry uses it.
Binary response headers describe shape, stride, type, and read timing. Error
responses carry a status, stable code, and short message.

Unit assignments and display-unit conversion remain browser presentation
state. They do not mutate NetCDF metadata or establish new CF geometry.
