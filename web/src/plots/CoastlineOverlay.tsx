import { useEffect, useMemo, useState } from "react";

import { coastlinePath, coastlineResolution, loadCoastline, type Coastline, type CoastlineResolution } from "./coastline";
import type { Bounds } from "./mesh";
import type { ViewRectangle } from "./view";

export function CoastlineOverlay({ bounds, plot, onStatus }: {
  bounds: Bounds;
  plot: ViewRectangle;
  onStatus: (message: string) => void;
}) {
  const resolution = coastlineResolution(bounds, plot.width, plot.height);
  const [loaded, setLoaded] = useState<{ resolution: CoastlineResolution; data?: Coastline; error?: string }>();
  useEffect(() => {
    if (!resolution) return;
    let live = true;
    void loadCoastline(resolution).then((data) => {
      if (live) setLoaded({ resolution, data });
    }).catch((cause: unknown) => {
      if (!live) return;
      const error = cause instanceof Error ? cause.message : String(cause);
      setLoaded({ resolution, error });
      onStatus(`Coastline unavailable: ${error}. Turn Coastline off and on to retry.`);
    });
    return () => { live = false; };
  }, [resolution, onStatus]);
  const data = loaded && loaded.resolution === resolution ? loaded.data : undefined;
  const error = loaded && loaded.resolution === resolution ? loaded.error : undefined;
  const path = useMemo(() => data ? coastlinePath(data, bounds, plot.width, plot.height) : "", [
    data, bounds.minimumX, bounds.maximumX, bounds.minimumY, bounds.maximumY, plot.width, plot.height,
  ]);
  if (!resolution) return null;
  return (
    <svg
      className="coastline-overlay"
      data-coastline={error ? "error" : data ? "ready" : "loading"}
      data-resolution={resolution}
      x={plot.left} y={plot.top} width={plot.width} height={plot.height}
      viewBox={`0 0 ${plot.width} ${plot.height}`}
      overflow="hidden"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
