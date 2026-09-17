# ncx viewing and Steering

Terms for scientific data, selections, and plots in the proposed Steering
interface. This glossary describes the domain, not implemented commands.

## Language

**Source**: An external input admitted through Add or the host source interface.
A derived calculation is not another external source.

**Source variable**: A named scientific variable over its full declared domain
in one admitted source. A plot can show only part of it.

**Variable reference**: An identity and index selection that describe scientific
data without requiring its values to be resident.

**Logical selection**: The chosen variable, dimensions, indices, and extraction
that define data of interest. It is independent of viewport and pixel density.

**View variable**: A capture of a plot's logical selection, with its native axes
and units. It does not mean the plot's currently loaded display samples.

**Display sample**: Values selected for drawing at a particular viewport and
resolution. Its extent and stride describe that display request.

**Materialized value**: Resident scientific values with dimensions, coordinates,
units, and the selection and sampling that produced them.

**Derived value**: A calculation result whose axes and units are stated by its
author. It can be a scalar, curve, field, or higher-dimensional array.

**Derived curve**: A derived value paired with an explicit X axis and Y unit.
It has the shape required for a curve plot.

**Published value**: A fixed copy of a materialized value accepted as plot data.
Later edits to the calculation variable do not change it.

**Plot binding**: The choice of data and extraction displayed by a plot.
Its presentation is a separate choice.

**Presentation**: The viewport, range, colour, display unit, and other drawing
choices that leave scientific values unchanged.

**Panel**: A display of bound data with axes and presentation settings. The
second panel shows curves and shares compatible X navigation with the primary.

**Panel intent**: Default content, explicit user data, or an explicitly hidden
panel. Intent can persist while its data is unavailable.

**Steering**: The command interface for inspecting source and workspace
variables, calculating values, and selecting plot bindings.

**Living variables**: The admitted references and user names available in the
current Steering session. Being listed does not mean being fully loaded.

**Source epoch**: The identity of the admitted scientific inputs and their
interpreted metadata. It changes when those inputs change.

**Selection revision**: The identity of the current logical plot selections.
Presentation and display sampling alone do not change it.

**Content revision**: The identity of a panel's latest content choice. It lets
a pending calculation detect that a later choice has replaced its target.
