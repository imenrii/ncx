import { FieldView } from "./FieldView";
import { MeshFieldView } from "./MeshFieldView";
import type { ColormapChoice, ColorRange } from "./color";
import type { ColorScale, Metadata, Probe, Variable } from "../data/model";
import type { DisplayDimensions } from "../data/selection";
import type { ViewBounds } from "./view";

export interface FieldProps {
  metadata: Metadata;
  variable: Variable;
  display: DisplayDimensions;
  indices: Record<string, number>;
  settled: boolean;
  colormap: ColormapChoice;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  sharedRange?: boolean;
  mapSource: "none" | "osm";
  probe: Probe | undefined;
  initialView?: ViewBounds;
  onViewChange: (view: ViewBounds) => void;
  onProbe: (probe: Probe) => void;
  onRange: (range: ColorRange) => void;
  onFrameLoaded: () => void;
  onStatus: (status: string) => void;
}

/** Remembered bounds are renderer-local; comparison bounds are world coordinates. */
export function SpatialField({
  mesh, synchronizedView, onSynchronizedViewChange, ...props
}: FieldProps & {
  mesh: boolean;
  synchronizedView?: ViewBounds;
  onSynchronizedViewChange?: (view: ViewBounds) => void;
}) {
  return mesh
    ? <MeshFieldView {...props}
        controlledView={synchronizedView}
        onViewChange={onSynchronizedViewChange ?? props.onViewChange}
      />
    : <FieldView {...props}
        controlledWorldView={synchronizedView}
        onWorldViewChange={onSynchronizedViewChange}
      />;
}
