# ncx improvement plan

Status: planned; no implementation is included in this document.
Date: 2026-09-17.
Scope: ncx and its integration with `cuSURGE/cuSURGE/web/`.

## Product decisions

ncx reads NetCDF files so users can inspect results quickly. Preserve the
single binary, read-only data access, native grids, and small runtime stack.

| Topic | Decision |
| --- | --- |
| Hub modes | Use the names **local**, **HTTP**, and **HTTPS**. See phase 6 for proposed policy. |
| CF/UGRID | Rust owns file interpretation. The browser consumes canonical facts. |
| Permalinks and recipes | No fingerprint verification, file certification, or verified-permalink workflow. Retain current session selection restore. A new sharing feature is outside this plan. |
| Growing simulations | Out of scope. Preserve explicit reopen and existing cuSURGE output lifecycle. |
| Arithmetic comparison | Use the proposed Steering terminal and existing second panel. Admit sources only through Add. Runtime and ownership design precede implementation. |
| Data QA | Optional information inside Metadata. No separate QA panel, compliance score, or `inspect --check` project. |
| Native UGRID edges | Deferred. Keep the current explicitly derived incident-edge mean. |
| Documentation | Deliver and maintain small `docs/*.md` contracts with their implementation phases. |

Internal checks for safe allocation, valid requests, correct decoding, and
compatible operations remain required. These checks protect the reader; they
do not turn opening a file into a verification task. Unsupported conventions
must retain a usable plain view when the underlying data can be read safely.

## Baseline and constraints

The audit found working Rust and frontend unit tests and a working cuSURGE
embedding smoke test. It also reproduced a broken visual capture runner,
incorrect grouped-reference handling in remaining browser callers, and a
model-calendar compatibility gap. Metadata and static-slice caches have no
success eviction. Read admission limits each response, not aggregate work.

Preserve these existing implementations:

- Rust canonical mesh hints, f64 coordinates, and binary response validation.
- The latest-slice loader's one active request and one latest desired request.
- Pure mesh geometry and WebGL code, shared interaction, and export helpers.
- `plotStyle.ts`, its generated CSS, and the current plot decision record.
- Existing wind, pressure, source-unit, and linked-curve behavior.
- The versioned public browser interface, revision checks, and host generation.

The working tree contains earlier UI changes. Implementation must preserve
them and use the current baseline. Do not reorganize folders merely to reduce
file size. Extract a module when it has a clear owner and a narrow interface.

## Ownership and representation

Design these representations before moving logic. The names below describe
contracts; they do not require a new class or file for every row.

| Owner | Representation and interface | What callers must not do |
| --- | --- | --- |
| Rust metadata inspection | Immutable manifest with canonical variable IDs, resolved references, supported views, dimension roles, calendar, mesh location, and specific unavailable reasons | Resolve CF paths or rediscover topology in TypeScript |
| Browser session metadata | User unit assignments keyed by dataset and canonical variable ID; effective metadata is derived from raw facts plus these assignments | Modify raw file attributes or keep another copy of file classification |
| Slice adapter and read planner | Typed per-dimension index or range, with stride attached to the range; one validated `ReadPlan` | Parse HTTP selection strings in plots |
| Read admission | Bounded jobs and memory reservations owned until their buffers are released | Submit unlimited blocking work or equate response size with process memory |
| Viewer reducer | Named events and explicit selection, playback, probe, and range states | Repair the same invariant at multiple call sites |
| Source feed | One source registry and one owner for revision, participation, style, and offsets | Copy mutable source state into the viewer reducer or host |
| Plot preparation | Typed scene variants containing arrays, coordinates, domains, sampling description, and presentation | Put fetch, React state, or CF interpretation in renderers |
| Hub | Mode policy, session identity, and process lifetime | Infer deployment trust from an arbitrary forwarded header |
| cuSURGE host | Case/output resolution, pair membership, provider acquisition, and viewer generation | Inspect iframe DOM or duplicate ncx scientific selection rules |

Raw file facts, user choices, and derived decisions are different concepts.
For example, pairwise comparison eligibility depends on two sources and an
operation; it is not a permanent `can_compare` flag on one variable.

## Delivery order

Each row is a reviewable phase. Split a phase into small PRs when needed, but
keep its contract and tests together. Optional work does not block core work.

| Phase | Work | Depends on | Documentation delivered |
| --- | --- | --- | --- |
| 0 | Repair regressions and establish basic gates | Current baseline | `verification.md`, initial `embedding.md` |
| 1 | Canonical metadata and typed selection | 0 | `data-contract.md` |
| 2 | Bounded reads and caches | 1 | `reading.md` |
| 3 | Named viewer events and prepared scenes | 1; 2 before load testing | `viewer.md`, updated `embedding.md` |
| 4 | Local UI editing and real specimens | 0, 3 | `ui.md`, links to `plot-style.md` |
| 5 | Measured rendering and sampling limits | 2, 3 | Updated `reading.md`, `verification.md` |
| 6 | local / HTTP / HTTPS hub policy | 0; can run before 1–5 | `deployment.md`, deployment guide update |
| Steering | Runtime feasibility, explicit commands, and cuSURGE migration | Ownership review; implementation after 1–3 | `steering.md`, `embedding.md`, `viewer.md`, cuSURGE web contract |
| Optional B | Small Metadata improvements | 1, 4 | `data-contract.md`, `ui.md` |

Complete phase 6 before expanding hub network exposure. CI starts in phase 0;
each later phase adds its own gate instead of waiting for a final CI phase.

## Phase 0: repair regressions and make checks executable

Owning files: `tests/ui-visual.mjs`, existing frontend tests, control CSS,
`CurveView.tsx`, `mesh.ts`, and cuSURGE proxy policy and embedding tests.

- Replace removed menu-button actions in visual capture with current UI flows.
- Restore minimum control targets, including Settings on coarse pointers.
- Reject incompatible model calendars in curve comparison. Keep the existing
  refusal to convert unsupported model calendars into UTC.
- Accumulate incident-edge means in f64 before producing f32 output.
- Resolve coastline access in cuSURGE's iframe policy. The initial approach is
  an exact allowance for the existing pinned data origin in `connect-src`,
  with a browser test. Do not add a general network proxy or a wildcard policy.
- Add checked-in CI for Rust checks, frontend tests/build, generated-file
  freshness, and a small browser smoke set. Exercise the real embedding too.

CI must account for the current build's sibling Style and colormap sources.
Check out pinned inputs explicitly. Do not assume an isolated ncx checkout
contains them. Use existing Linux Firefox tooling and a defined font profile.
An unlicensed runner uses the documented font fallback and its own baseline.

Acceptance: the visual runner completes all scenarios; focused regressions
pass; both projects still open and export the existing fixtures. CI invokes
real assertions and fails on errors. Required branch checks must be configured
in the hosting platform as well as declared in workflow files.

## Phase 1: make CF interpretation a single source of truth

Owning files: `src/cf.rs`, metadata DTOs in `src/dataset.rs`, `src/server.rs`,
the browser HTTP adapter, and their direct consumers.

Extend the existing manifest rather than introduce a parallel discovery API.
Resolve every reference that the viewer uses, including mesh, coordinates,
bounds, connectivity, and supporting variables. Record display dimensions,
time/calendar information, coordinate roles, and mesh location in the same
inspection pass. Keep raw attributes available in Metadata.
For time axes, include the resolved calendar and origin/scale for supported
absolute time. The browser formats this description; it does not parse CF time
units again. For wind and pressure discovery, consume canonical coordinate and
quantity facts while preserving explicit user component selections.

Generate TypeScript transport types from Rust DTOs at build time. Select one
small generator after checking the current serde enum shapes; do not maintain
a separate hand-written schema. Add a protocol version and a runtime decoder
at the HTTP seam. Generated static types alone are not runtime validation.
Test the decoder against Rust-produced responses and malformed variants.
Keep this protocol separate from the existing `window.ncx` interface version.

Reject incompatible protocol versions clearly. An unknown file convention
still produces a supported plain capability and a reason; it is not a protocol
error. Validate each consumer's required fields before using its capability.

Replace string selections inside the application with typed dimension
selections. Serialize only in the HTTP adapter and parse only at the Rust HTTP
seam. Rust validates bounds and builds the read plan once. Scene preparation
uses the typed request directly, including for coordinate sampling and export.

Delete browser CF resolution and discovery after migrating every caller.
UI preferences can choose among manifest-supported views and variables; they
must not independently infer scientific eligibility. Keep existing unit
conversion arithmetic and explicit user assignments under their current
single owners; do not copy these rules into Rust as part of this phase.

Acceptance:

- Grouped fixtures cover `..`, `.`, absolute paths, bounds, edge connectivity,
  and ambiguous auxiliary coordinates through API and rendered results.
- No frontend CF path resolver or topology rediscovery remains.
- No renderer parses selection or stride strings.
- A malformed manifest fails at the adapter with a useful message.
- Ordinary node/face UGRID, plain data, supplied sources, and embedded viewing
  retain their existing behavior.

## Phase 2: bound reads, queued work, and retained data

Keep the existing NetCDF handle ownership and mutex. Add bounded admission
before `spawn_blocking`; do not introduce a worker framework. An async read
slot per open dataset can prevent blocking threads from waiting on that mutex.
Use a global read limit and a bounded waiting policy across datasets.

The read plan describes source buffers, output buffers, and any known
conversion buffers. Reserve memory before allocation. The reservation follows
the response buffer through delivery or disconnect. Account for metadata,
NetCDF/HDF5 caches, and transport overhead separately; the array estimate is
not a claim about exact RSS. Bound metadata inspection and dataset opening too.

Distinguish static, interactive, and export jobs only where their behavior
differs. Replace a queued interactive job only within the same client/plot
request stream. Never replace another client's request. Retain the browser's
existing latest-request behavior. Drop cancelled work before it starts; an
active NetCDF C call can finish. Return a bounded overload response with a
retry hint instead of accumulating arbitrary waiters.

Browser caches own their retained buffers. Evict completed static slices by
bytes, bound metadata by measured size or a conservative estimate, and remove
obsolete hub scopes. Bound pending loads too. Do not evict a live promise in a
way that starts duplicate reads. Active plot buffers remain separately counted.

Acceptance: burst requests, multiple panes, export, slow clients, cancellation,
and repeated hub retargets stay within explicit queue/cache limits. Record
peak RSS on fixed fixtures, including the allowed number of hub child viewers.
Choose and document numeric budgets before merging; do not call an unmeasured
memory estimate an enforced process limit.

## Phase 3: make state transitions and plot preparation explicit

Replace partial-object updates with events such as `dataset/opened`,
`variable/selected`, `dimension/indexed`, `playback/started`, and `probe/placed`.
Use distinct states for no selection, ready selection, and active playback.
Validate runtime indices when accepting events. A discriminated union alone
does not prove that an index is in range.

The reducer owns compatible resets of dimensions, probe, range, view, and
playback. URL/session restore, keyboard input, toolbar input, and playback
dispatch the same events. Dataset and slice loading own request identity and
cancellation. The source feed continues to own offsets and source revisions;
the reducer references it instead of copying its state.

Prepare scenes before rendering. Share loading/error presentation, range
controls, interactions, and export registration where their contracts match.
Keep structured and mesh geometry contracts distinct where they differ.
Reuse the current WebGL and geometry implementations. Type-only dependencies
are acceptable; rendering must not interpret CF or issue network requests.

Acceptance: transition tests cover selection changes during reads/playback,
late results, empty dimensions, unit changes, and source replacement. Scene
tests use arrays directly. Field, mesh, curve, linked panels, and PNG output
pass their existing smoke tests without changing scientific behavior.

## Phase 4: reduce UI editing scope and panel crowding

Follow the [web design guide](../../Style/Web/web-design.md) and
[font guide](../../Style/Web/commit-mono.md). Preserve the four materials,
light data canvas, real font roles, rem type, visible keyboard focus, and
non-colour state indicators. Never solve crowding by shrinking targets or text.

Keep native CSS. Separate tokens, shell, controls, plots, and hub rules when
each has a clear owner. Keep `style.css` as the entry point. Preserve the
generated plot profile; do not recreate its values in a new token sheet.
Introduce an explicit layer order in one coordinated migration so unlayered
legacy rules cannot silently override the new layers. Update the documented
stylesheet ownership when this changes the current repository convention.

Share interface token definitions between ncx and cuSURGE through a generated
or build-time synchronized artifact from Style/Web. Keep each application
independently deployable. Do not create a runtime dependency on the sibling
repository or manually maintain another token copy.

Add a development specimen page that renders actual controls, variable rows,
timeline, and dialogs. Cover loading, unavailable, disabled, selected, error,
and long-label states. Retire `components.html` as regression evidence; it can
remain an explicitly historical design artifact.

Resolve one existing layout conflict during this phase: Style/Web specifies a
narrow overlay sidebar, while the current ncx README specifies a persistent,
resizable sidebar. Compare real layouts in the standalone viewer and iframe.
Record one accepted behavior and update its owning guide and contract together.
Do not silently reintroduce the removed hamburger to satisfy an old test.

Acceptance: one control-height token changes ordinary controls; one shell rule
changes sidebar sizing; one control-state rule changes selection styling; a
new control reuses focus/hover/disabled behavior. Check 640/1280 px layouts,
100/125/200% zoom, coarse pointers, reduced motion, forced colours, missing
optional fonts, and high DPI. Verify both ncx and cuSURGE with real screenshots.

Add golden diffs on a pinned browser/font profile. Set a measured pixel
tolerance, retain mismatch images, and require intentional baseline updates.
Keep semantic browser assertions alongside image comparison.

## Phase 5: bound rendering work with measured changes

First skip scalar expansion/upload when source data and geometry are unchanged.
Then build mesh arrays in two passes to avoid large growable JS intermediates.
Measure build latency, peak bytes, pan/zoom latency, and frame upload bytes.

Move geometry preparation to a worker if the measured main-thread budget is
still exceeded. Transfer buffers with clear ownership and revision checks.
Use indexed geometry or a scalar texture only if measured per-frame cost still
requires it. Preserve node/face semantics and the current fallback renderer.

Bound long-curve drawing with a per-pixel min/max envelope that preserves gaps,
sample order, and narrow extrema. Structured-field requests retain explicit
sampling information. Label strided previews and exported sampling; do not
call regular sampling peak-preserving. Add an aggregation mode only with a
defined result contract and spike/gap fixtures. Keep current full-mesh load
limits; server spatial subsets, mesh LOD, and native edge rendering are deferred.

Acceptance: record numeric budgets on fixed representative fixtures and fail
CI on regressions beyond the declared tolerance. Keep small correctness gates
on every PR and large performance runs on a controlled runner. No performance
change may silently change probe values, geometry, missing data, or export labels.

## Phase 6: use local, HTTP, and HTTPS hub modes

The following is the proposed behavior for the agreed mode names. The modes
describe browser-to-hub deployment, not the SSH connection's security.
Use an explicit mode in CLI/config; local is the default. `open` and `serve`
retain their loopback behavior, including the existing CLI SSH workflow.

| Mode | Listener and browser access | SSH and password policy |
| --- | --- | --- |
| local | Loopback only; configured local roots | Local hub files only; no password UI |
| HTTP | Explicit operator choice; configured interface; persistent HTTP status | Remote sessions allowed; password entry allowed with a clear plaintext-transport notice; key/agent authentication also supported |
| HTTPS | External TLS/auth proxy; backend reachable only by the configured proxy path | Strict host-key policy; key/agent/certificate authentication by default; browser password entry disabled by default |

HTTPS mode does not add a TLS server or user accounts to ncx. Define the trusted
proxy peers and external origin, authentication responsibility, header handling,
and backend network isolation. Fail startup for missing required configuration.
Reject untrusted forwarded headers; do not claim to prove external TLS from a
mode name or one header. Test the complete proxy deployment.

Restore known-host checking by default for remote hub sessions. Support an
operator-provided known-hosts file. `accept-new` must be an explicit choice and
must still reject changed keys. An insecure host-key override, if retained for
HTTP deployments, must be explicit and visible; HTTPS rejects it. Keep secrets
out of URLs, storage, command arguments, and persistent environments.

Extract policy from process mechanics where useful. Keep session management,
local file capability handling, SSH lifetime, and streaming relay under clear
owners. Do not split the binary or workspace. Existing HTTP deployments need
documented mode/auth configuration changes; never silently restore insecure
defaults for compatibility.

Acceptance: mode/listener tests, wrong or changed host-key tests, missing proxy
configuration, forwarded-header spoofing, password rejection, session limits,
retarget failure, heartbeat expiry, and streaming relay checks. cuSURGE still
uses its loopback child/proxy workflow and does not become a hub deployment.

## Steering and optional Metadata work

The revised [comparison plan](comparison-plan.md) replaces the rejected dialog
and Settings editor with Steering. Its [interface proposal](steering.md) owns
the data, workspace, execution, and panel override rules. Display compatibility
uses axis units and domains, not station/quantity/datum policy. Complete runtime
feasibility and ownership review before implementation. Existing host comparison
remains available until the replacement has update and capacity parity.

Metadata may gain a small expandable Read details section. Prefer facts already
available: units/calendar, fill/packing behavior, storage details if cheap to
read, and reasons a view is unavailable. Optional min/max and missing counts
must describe the loaded slice or sampled region, not claim whole-file results.
Do not scan the file merely because Metadata opens. No pass/fail quality badge,
new toolbar button, extra QA dashboard, or blocking scientific validation.

## Completion rule

Each phase supplies its owning contract document, focused tests, affected smoke
checks, and updated build artifacts when the UI changes. Use the existing Rust
and frontend checks; rebuild the web assets before Rust embeds them. Shared
browser-interface changes also run cuSURGE Python, console, and real embedding
checks against that rebuilt binary.

Keep the [documentation map](README.md) current. New contract documents replace
the corresponding plan details as work ships. Deferred features must remain
outside the required completion checklist.
