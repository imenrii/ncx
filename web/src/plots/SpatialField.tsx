import type { FieldSettings } from "../data/fieldSettings";
import type { Unit } from "../data/units";
import { FieldView } from "./FieldView";
import { MeshFieldView } from "./MeshFieldView";
import type { ColormapChoice, ColorRange } from "./color";
import { hasGeographicCoordinates, type ColorScale, type Metadata, type Probe, type Variable } from "../data/model";
import type { DisplayDimensions } from "../data/selection";
import type { ViewBounds } from "./view";
import type { OverlayToggles } from "./OverlayLegend";

export interface FieldProps {
  metadata: Metadata;
  variable: Variable;
  targetUnit?: Unit;
  display: DisplayDimensions;
  indices: Record<string, number>;
  settled: boolean;
  colormap: ColormapChoice;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  sharedRange?: boolean;
  compact?: boolean;
  mapSource: "none" | "coastline";
  wind?: boolean;
  fieldSettings: FieldSettings;
  pressure?: Variable;
  overlays?: OverlayToggles;
  overlaySource?: { metadata: Metadata; variable: Variable; indices: Record<string, number> };
  probe: Probe | undefined;
  initialView?: ViewBounds;
  onViewChange: (view: ViewBounds) => void;
  onProbe: (probe: Probe) => void;
  onRange: (range: ColorRange) => void;
  onFrameLoaded: () => void;
  onFrameError?: () => void;
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
  const mapSource = hasGeographicCoordinates(props.metadata, props.variable) ? props.mapSource : "none";
  return mesh
    ? <MeshFieldView {...props}
        mapSource={mapSource}
        controlledView={synchronizedView}
        onViewChange={onSynchronizedViewChange ?? props.onViewChange}
      />
    : <FieldView {...props}
        mapSource={mapSource}
        controlledWorldView={synchronizedView}
        onWorldViewChange={onSynchronizedViewChange}
      />;
}
