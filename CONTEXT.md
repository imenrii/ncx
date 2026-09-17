# ncx viewing and Steering

Terms for reading selected scientific data and operating on it in Steering.
Steering is a proposed extension; this glossary is not an implementation spec.

## Language

**Source**: An external input admitted through Add. A derived calculation is
not another external source.

**View variable**: The selected values and their axes from one admitted source.
Its units and sampling describe those values, not the entire source file.

**Derived curve**: Values calculated from view variables, paired with an X axis
and an explicit Y unit.

**Panel**: A display of selected curves with axes and presentation settings.
The second panel shares X navigation with the primary panel.

**Steering**: The command interface for inspecting view variables, calculating
derived values, and selecting panel contents.

**Data revision**: The identity of a particular set of source data and selected
values. A presentation change alone does not change those values.

**Panel intent**: The choice of default content, user-selected content, or an
explicitly hidden panel. It is distinct from the panel's current curve buffers.
