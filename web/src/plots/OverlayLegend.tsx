import type { WindStyle } from "../data/fieldSettings";
import { barbGeometry, barbPath } from "./windGeometry";
import { PLOT_STYLE } from "./plotStyle";
import { useLayoutEffect, type ComponentProps } from "react";
import { ViewControls } from "./plot";
import { useElementSize } from "./useElementSize";
import type { ContourBox } from "./pressureContours";

export interface OverlayToggles {
  pressure: boolean;
  wind: boolean;
  windStyle?: WindStyle;
  pressureReason?: string;
  windReason?: string;
  onPressure: (on: boolean) => void;
  onWind: (on: boolean) => void;
}

/** The mark column keeps one width, so both labels start on the same x. CSS
    sets that width; the mark stays left-anchored at its drawn size inside it. */
const MARK = { viewBox: `0 0 ${PLOT_STYLE.legend.markWidth} ${PLOT_STYLE.legend.markHeight}`, height: PLOT_STYLE.legend.markHeight, preserveAspectRatio: "xMinYMid meet", "aria-hidden": true } as const;

function PressureMark() {
  return <svg {...MARK}>
    <path d="M0 7H9" strokeWidth={PLOT_STYLE.pressure.width} /><path d="M41 7H50" strokeWidth={PLOT_STYLE.pressure.width} />
    <text x={25} y={7} textAnchor="middle" dominantBaseline="central" fontSize={PLOT_STYLE.legend.sampleFont}>1013</text>
  </svg>;
}

export function WindMark({ style = "barb", compact = false }: { style?: WindStyle; compact?: boolean }) {
  return <svg {...MARK} viewBox={compact ? "0 0 28 28" : MARK.viewBox}>
    <g transform={compact ? undefined : "translate(19 0) scale(.5)"}>
      {style === "barb" ? <path d={barbPath(barbGeometry(0, -10, false)!, 0, 0, 0)}
        transform="translate(13 16) rotate(30) scale(.825)" strokeWidth={PLOT_STYLE.legend.windWidth} vectorEffect="non-scaling-stroke" /> : <path d="M6 23L20 9M12 9H20V17" strokeWidth={PLOT_STYLE.legend.windWidth} vectorEffect="non-scaling-stroke" />}
    </g>
  </svg>;
}

/** Reads as a key, not as chrome: the overlay it names is the only other thing
    on this corner of the plot. */
export function OverlayLegend({ pressure, wind, windStyle, pressureReason, windReason, onPressure, onWind, hidden = false }: OverlayToggles & { hidden?: boolean }) {
  return <div className="overlay-legend" role="group" aria-label="Plot overlays"
    aria-hidden={hidden || undefined} inert={hidden} style={hidden ? { visibility: "hidden" } : undefined}>
    <button type="button" className="overlay-toggle" aria-pressed={pressure && !pressureReason}
      disabled={Boolean(pressureReason)} title={pressureReason}
      onClick={() => onPressure(!pressure)}><PressureMark /><span>Pressure</span></button>
    <button type="button" className="overlay-toggle" aria-pressed={wind && !windReason}
      disabled={Boolean(windReason)} title={windReason}
      onClick={() => onWind(!wind)}><WindMark style={windStyle} /><span>Wind vector</span></button>
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
