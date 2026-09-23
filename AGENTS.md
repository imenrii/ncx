# AGENTS.md

These instructions apply to the entire `ncx` repository.

## Start here

Read `README.md` before changing code. It is the user-facing contract and the
authoritative list of supported workflows and checks.

`ncx` is deliberately a thin, read-only NetCDF viewer. Preserve these
boundaries:

- Open datasets read-only. Ordinary viewer routes accept dataset IDs, not
  browser-supplied filesystem paths. Only `hub` session creation can accept a
  path, and it must validate the path against configured local roots or the
  configured SSH rules before it starts a viewer.
- Keep `open`, `serve`, child viewers, and SSH forwards on IPv4 loopback. `hub`
  can bind a configured IPv4 container interface so a host web server can route
  `/ncx/` to it.
- Keep viewer HTTP NetCDF-only: no provider-specific data, server-side
  comparison, or regridding. Hub lifecycle routes can create, retarget, keep,
  and close bounded viewer sessions. An SSH web session is bound to one SSH
  identity and can replace its viewer path through one authenticated OpenSSH
  control connection. In the browser, the tab stores only `{id, destination,
  address}` in `sessionStorage`; refresh resumes the same address, a path-only
  change retargets the viewer without a password, and a user/host change keeps
  the old viewer until the authenticated replacement works. Passwords are
  accepted only during session creation and must not enter URLs, storage, logs,
  command arguments,
  or long-lived process environments. The browser does not close sessions on
  `pagehide`; explicit close and the 90-second heartbeat expiry are cleanup
  paths, so a closed tab can hold a bounded slot until expiry.
- Treat CF/UGRID detection as conservative display hints. Broken or unknown
  conventions should warn and fall back to a plain view, not rewrite metadata
  or make the file unusable.
- Validate selections, integer arithmetic, connectivity, and response limits
  before allocation or NetCDF access. Preserve fill/missing-value handling,
  scale/offset order, and little-endian transport.
- Do not add a service layer, worker pool, protocol, or dependency without a
  demonstrated need. Reuse the standard library and current dependencies.

## Code map

- `src/cli.rs`: argument parsing, local collections, browser launch, SSH
  forwarding, process lifetime, and loopback listener.
- `src/dataset.rs`: the NetCDF handle, metadata discovery, validated slicing,
  decoding, and binary serialization.
- `src/cf.rs`: metadata-only CF/UGRID view-hint detection.
- `src/server.rs`: Axum viewer routes, API responses, limits, and embedded web
  assets.
- `src/hub.rs`: validated local and SSH hub targets, versioned remote binary
  installation, bounded session lifecycle, and the streaming relay to loopback
  viewer processes.
- `web/src/app/`: dataset selection, viewer state, browser, and controls.
- `web/src/data/`: API contract, metadata, slice selection, comparison, and time.
- `web/src/plots/`: plot views, shared interactions, geometry, rendering, and export.
- `web/src/hub/`: session UI and lifecycle.
- `web/src/generated/`: generated colour tables.
- `tests/data`: small inspectable NetCDF fixtures paired with CDL sources.
- `tests/ui-smoke.mjs`: Firefox end-to-end scenarios.

Keep blocking NetCDF reads in `spawn_blocking` and serialized through the
dataset's mutex. If an API shape changes, update the Rust serializer, the
TypeScript model/decoder, and focused tests together.

## Frontend rules

- Use the existing React/TypeScript/CSS stack; do not introduce a UI, state, or
  charting library for work the current stack covers.
- Preserve keyboard access, visible focus, non-colour-only state, reduced-motion
  behavior, and touch target sizing. Plot labels must retain quantities and
  units, and plot geometry must preserve coordinate aspect.
- The UI is intentionally light-only. Use `rem` for type and the existing CSS
  tokens and component patterns.
- `web/dist/index.html`, `web/dist/assets/app.js`, and `app.css` are tracked and
  embedded into the Rust binary at compile time. After any frontend change, run
  `npm run build` under `web/` and include the resulting `web/dist` changes.
- `web/src/generated/scm.ts` and `web/src/generated/ncview_legacy.ts` are generated. Do not hand-edit
  them; use `node web/scripts/sync-colormaps.mjs` when their upstream tables
  change.
- UI design, typography always comply with `/home/snd2/prog/jackcho/Style/Web` instructions
- UI components come from `Style/Web/components/components.css`, the SSOT. `web/src/components.css` is a vendored copy: do not edit it; change the Style copy, then run `npm run style:sync` in `web/` (`style:check` fails on drift). Use the library classes (`key-btn`, `btn`, `seg`, `chip-toggle`, `tick-label`, `field`, `row-item`, `tabs`, `pop`/`sheet`) and keep only layout overrides in `style.css`.
- Sync to `/home/snd2/prog/jackcho/Style/Web/*` generically whenever a new design is agreed and dropped.
- Always check with visuals to make sure nothing is broken

Fonts live in `res/` and are embedded at compile time; see `res/README.md` for
the licence split and why `res/gorton-perfected-1.02/` and `res/gen/` are
gitignored. `build.rs` subsets the interface face and degrades to the platform
sans when no licensed copy is present, so `cargo build` works either way.

The build intentionally reads colour tables from the sibling `../Style` tree,
and legacy colour tables from `../lib/ushow`. Do not duplicate those sources
inside this repository.

## Plot style SSOT

Before changing plot appearance, layout, legends, or export, read
[docs/plot-style.md](docs/plot-style.md) for ownership and recorded decisions.

- Define browser plot style values in
  [web/src/plots/plotStyle.ts](web/src/plots/plotStyle.ts). Reuse these values
  in CSS, geometry, legends, and export instead of adding independent copies.
- Keep the style file human-maintainable: one setting per line, clear groups,
  and units or ratio meanings beside values that need explanation.
- Keep selectors and application layout in `style.css`, and geometry formulas
  and pressure algorithms in their owning modules. Derive text clearance,
  masks, and collision bounds from the same resolved sizes used for drawing.
- Preserve documented browser/print differences. Check the decision record
  and code history before treating a difference as a malfunction. If intent
  remains unclear, ask the user before changing that choice; continue work
  that does not depend on the answer. Record resolved choices in the decision
  record rather than repeating their values here.
- After style edits, run `npm run style:sync` in `web/`. Include the generated
  `web/src/generated/plot-style.css`; do not edit it by hand. Run the existing
  tests and build, which check freshness, and verify affected plots and exports.

## Code Style

Code should be readable, maintainable. Linebreak nicely, do not cluster.

## Comments

A comment states the non-obvious reason at the owning boundary. Include a constraint or invalidation condition when a maintainer needs it to know when the rationale or the code stops being valid. Let the code speak for the operation itself. Keep intermediate attempts and speculative future work in a progress file, or in a comment the user explicitly asks for.

## Tech Writing Rules

Follow ASD-STE100 (Simplified Technical English). Mandatory.

## Verification

Run the smallest check that covers the change, then the relevant broader gate:

```bash
# Rust
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings

# Frontend
cd web
npm test
npm run build
cd ..
```

For browser behavior, rebuild both layers first because the smoke runner starts
`target/debug/ncx`, whose UI was embedded when Rust compiled:

```bash
cd web && npm run build && cd ..
cargo build
node tests/ui-smoke.mjs rectilinear
```

Replace `rectilinear` with the affected scenario: `curvilinear`, `ugrid`,
`ugrid_projected`, `comparison`, `collection`, or `station`. Run all affected
scenarios for cross-cutting UI/API changes. These checks require Firefox and
permission to bind temporary loopback ports.

Keep fixture `.cdl` and `.nc` files synchronized. Do not commit `target/`,
`web/node_modules/`, scratch files, or unrelated workspace changes.

## Build

Build after tests passed.

```bash
cd web && npm run build && cd ..
cargo build --release
```
