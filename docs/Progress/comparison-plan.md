# Comparison through Steering

Status: revised proposal. The earlier Compare dialog and Settings editor were
rejected. This document does not change shipped behavior.
Parent: [improvement plan](improvement-plan.md).

## Direction

Keep the current cuSURGE viewing flow: sources enter through Add and appear as
ordinary curves. Keep the existing plot controls. Add one Steering entry that
opens a screen-wide bottom terminal with living variables on the left. Arithmetic
and explicit plot binding belong there; panel 2 remains a curve panel.

No Compare dialog, operation toolbar, validation cards, or permanent explanatory
copy. Reuse the current linked second panel, including its axes, cursor, style,
and export. Do not show an empty result card when no second panel is requested.
Put command errors in the terminal. Keep routine loading in the existing status
surface. Follow [Style/Web](../../../Style/Web/web-design.md).

The [interactive draft](draft.html) now shows the proposed topbar toggle and
bottom terminal with aligned living variables, log, and command input. It uses
sample data and does not execute Python. The rejected dialog design is removed.

## Contracts

The proposed vocabulary is in [Steering context](steering-context.md). The narrow interface,
state ownership, publication, and override rules are in [steering.md](steering.md).
Runtime evidence is in [steering-runtime-research.md](steering-runtime-research.md).

ncx checks axis units, coordinate domains, and safe array shape. It does not
require identical station IDs, quantities, or vertical datums to display curves
that a user explicitly added. The user chooses the meaning of an operation.
Equal endpoint ranges alone do not establish sample-by-sample alignment.

The recommendation is real Python/NumPy, with explicit execution by default.
Automatic transforms are a later, explicit mode; terminal history is never
automatically replayed. These are recommendations for review, not implemented
interfaces.

## cuSURGE ownership

cuSURGE owns file/path permission, case lifecycle, completed-output eligibility,
and provider acquisition. ncx owns the admitted source registry, viewed arrays,
panel state, and rendering. The host and standalone Add controls use the same
source-admission interface. Steering has no source-opening interface.

TideOnly files must be added before an operation can use them. Selecting a
normal run must not silently open its counterpart. A future Add-pair action can
admit both members in one transaction, but the source list must expose both
members and their stable aliases. Test the UI and capacity effect of six pairs;
do not hide it in an unlimited operand catalog.

Derived arrays belong to the Steering workspace. Plotting them does not add an
external data source or bypass Add. Supplied Tide and Observation enter through
the same source list as other external inputs.

The current host combines source replacement and secondary-panel replacement
in `setSources`. Separate these intentions in the new interface. A source-feed
refresh cannot replace a user-selected second panel. The explicit ownership
rules in `steering.md` replace competing effects and timing-based precedence.

## Delivery

1. Review the ownership and override contract. Resolve the exact axis-range
   rule; the recommended interpretation is in `steering.md`.
2. Review the updated HTML draft: topbar Steering toggle, completely hidden
   closed panel, aligned sidebar, and Enter-to-submit input. Continue with real
   execution and result-panel examples after the runtime spike. No fixture
   control bar or comparison settings sheet.
3. Run a small real-Python browser spike. Measure initialization, asset size,
   array transfer, six-source work, Stop, and offline behavior. Exercise local,
   HTTP, HTTPS, and the actual cuSURGE iframe policy. Do not install a notebook
   application or add a server Python execution route.
4. Implement source-backed variable references, exact bounded reads, and plot
   bindings first, as specified in the revised `steering.md`. A view capture is
   a logical selection, not its display buffer. Route GUI, host, and terminal
   plot edits through one owner. Retain canonical CF facts and existing limits.
5. Add explicit execution, Python workspace variables, result publication, and
   the existing second-panel renderer. Test selection changes during execution.
6. Add explicitly registered automatic transforms only if needed to preserve
   the accepted cuSURGE interaction. Do not rerun arbitrary command history.
   Keep host calculations until parity includes admission, updates, and capacity.
7. Migrate model and observed arithmetic into Steering. Remove the old Python
   station subtraction and browser observed-subtraction callers after migration.
   Keep host pair membership and provider normalization. Update the cuSURGE
   web contract before changing its implementation.

Acceptance: ordinary Add produces a plot without Steering; scripts cannot add
sources through the ncx interface; source refreshes cannot overwrite user panel
intent; old computations cannot publish into a new view; GUI styling does not
execute Python; secondary curves reuse the renderer and export; the host no
longer duplicates migrated math.

This replaces the earlier no-expression-language proposal. It does not add
notebook cells, user accounts, arbitrary server execution, growing-file support,
or a file-verification workflow.
