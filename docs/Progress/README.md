# Historical plans and records

This folder preserves earlier proposals. Current module contracts are in
[docs/README.md](../README.md). Implementation notes are in
[implementation.md](implementation.md).

# Documentation map

The [project README](../../README.md) describes shipped behavior and commands.
Plans describe proposed work. A plan does not change a shipped contract.

| Document | Scope | Status |
| --- | --- | --- |
| [Improvement plan](improvement-plan.md) | Required fixes, module ownership, delivery order, and acceptance checks | Planned |
| [Comparison through Steering](comparison-plan.md) | Add-only sources, clean viewer UI, and cuSURGE migration | Revised proposal |
| [Steering interface](steering.md) | Source-backed variables, bounded reads, terminal layout, and plot ownership | Design record; manual implementation in [Steering](../steering.md) |
| [Steering runtime research](steering-runtime-research.md) | First-party GitHub evidence for runtime and execution choices | Research |
| [Steering profile](steering-profile.md) | Pre-Steering performance comparison, metadata ownership, and panel 2 anomalies | Measured investigation and proposals |
| [Paired panel performance](steering-panel-performance.md) | Global time, editable probes, and comparison with pre-Steering | Measured 2026-09-21 |
| [Frame performance](steering-frame-performance.md) | Implemented probes/panels, shared reads, and release measurements | Measured 2026-09-21 |
| [Variables, probes, and dynamic panels](steering-bindings.md) | Shared plot ownership, probe semantics, frame API, and reuse priorities | Implemented core; remaining proposals marked |
| [Paired panel views](steering-panel-views.md) | One data binding with Field/Curve views, global time/overlays, independent probes | Implemented |
| [Domain vocabulary](steering-context.md) | Variables, selections, plot bindings, and revision identities | Proposed vocabulary |
| [Steering UI draft](draft.html) | Topbar toggle, aligned living variables, log, and command input | Interactive layout; sample data, no Python execution |
| [Browser plot style](plot-style.md) | Current plot style ownership and recorded decisions | Current |
| [Hub deployment](../../deploy/README.md) | Current container setup and operating commands | Current |

The UI reference is [Style/Web](../../../Style/Web/README.md). Its
[design guide](../../../Style/Web/web-design.md) and
[font guide](../../../Style/Web/commit-mono.md) define the shared web style.
The plot style document records intentional ncx plot differences.

## Contract documents to deliver with implementation

Create each document when its implementation phase starts. Do not create empty
module documents. Keep these files directly under `docs/`.

| Document | Owning module | Narrow contract |
| --- | --- | --- |
| `data-contract.md` | Rust metadata and browser HTTP adapter | Canonical variable identity, capabilities, protocol compatibility, and typed selections |
| `reading.md` | Read admission and browser data loading | Work limits, buffer lifetime, cancellation, cache ownership, and sampling |
| `viewer.md` | Viewer state and plot preparation | Events, resets, prepared scenes, and renderer inputs |
| `embedding.md` | Public browser interface | Source identity, revision, capability negotiation, and host responsibilities |
| `ui.md` | Application shell and controls | Token ownership, control states, responsive layout, and real specimens |
| `deployment.md` | Hub policy and lifecycle | local, HTTP, HTTPS, SSH policy, and proxy requirements |
| `verification.md` | Repository checks | Fixtures, test commands, visual baselines, and measured budgets |

Keep `plot-style.md` as the owner of plot appearance. Keep deployment commands
in `deploy/README.md`; link to `deployment.md` for policy. Move detailed public
interface text out of the project README as the relevant contract document is
introduced. Replace moved text with links instead of retaining two copies.

## Maintenance rule

Each implementation PR updates the documents for the contracts it changes.
Each module document states:

1. What the module owns and what it does not own.
2. Its caller-visible inputs, outputs, and invariants.
3. Mutable state ownership and resource lifetime, where applicable.
4. Failure behavior and compatibility rules.
5. Links to the implementation and the checks that prove the contract.

Reference generated DTOs and executable limit definitions. Do not copy them
into tables that need separate updates. Keep design history only when it
explains an active constraint. When a phase ships, mark it complete and link
to its current contract; remove superseded proposal details.

Cross-project changes also update the owning
[cuSURGE web contract](../../../cuSURGE/cuSURGE/docs/contracts/web-interface.md).
ncx documents generic viewer behavior. cuSURGE documents case, solver, pair,
and provider behavior. Neither document repeats the other's implementation.
