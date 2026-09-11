import { useLayoutEffect, type ComponentProps } from "react";
import { ViewControls } from "./plot";
import { useElementSize } from "./useElementSize";
import type { ContourBox } from "./pressureContours";

export interface OverlayToggles {
  pressure: boolean;
  wind: boolean;
  pressureReason?: string;
  windReason?: string;
  onPressure: (on: boolean) => void;
  onWind: (on: boolean) => void;
}

/** The mark column keeps one width, so both labels start on the same x. */
function PressureMark() {
  return <svg viewBox="0 0 36 14" width={36} height={14} aria-hidden="true">
    <path d="M0 7H5" strokeWidth={0.9} /><path d="M31 7H36" strokeWidth={0.9} />
    <text x={18} y={7} textAnchor="middle" dominantBaseline="central" fontSize={9}>1013</text>
  </svg>;
}

function WindMark() {
  return <svg viewBox="0 0 36 14" width={36} height={14} aria-hidden="true">
    <path d="M15.4 12.6L20.6 1.4" strokeWidth={1.1} />
    <path className="solid" d="M20.6 1.4L21.2 5.4L17.7 4.2Z" />
  </svg>;
}

/** Reads as a key, not as chrome: the overlay it names is the only other thing
    on this corner of the plot. */
export function OverlayLegend({ pressure, wind, pressureReason, windReason, onPressure, onWind, hidden = false }: OverlayToggles & { hidden?: boolean }) {
  return <div className="overlay-legend" role="group" aria-label="Plot overlays"
    aria-hidden={hidden || undefined} inert={hidden} style={hidden ? { visibility: "hidden" } : undefined}>
    <button type="button" className="overlay-toggle" aria-pressed={pressure && !pressureReason}
      disabled={Boolean(pressureReason)} title={pressureReason}
      onClick={() => onPressure(!pressure)}><PressureMark /><span>Pressure</span></button>
    <button type="button" className="overlay-toggle" aria-pressed={wind && !windReason}
      disabled={Boolean(windReason)} title={windReason}
      onClick={() => onWind(!wind)}><WindMark /><span>Wind vector</span></button>
  </div>;
}

export function FieldControls({ overlays, onReserve, ...view }: ComponentProps<typeof ViewControls> & {
  overlays?: OverlayToggles;
  onReserve: (box: ContourBox) => void;
}) {
  const [element, size] = useElementSize<HTMLDivElement>();
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    // Measure the whole stack: touch targets and reader font sizes change it.
    onReserve({ left: node.offsetLeft - 4, right: node.offsetLeft + size.width + 4,
      top: node.offsetTop - 4, bottom: node.offsetTop + size.height + 4 });
  }, [size.width, size.height, onReserve]);
  return <div className="corner-stack" ref={element}>
    <ViewControls {...view} />
    {/* Equal headroom keeps comparison panes at the same map resolution. */}
    <OverlayLegend hidden={!overlays} {...(overlays ?? {
      pressure: false, wind: false, onPressure: () => {}, onWind: () => {},
    })} />
  </div>;
}
