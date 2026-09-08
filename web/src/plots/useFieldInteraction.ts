import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  aspectRectangle, boxZoomBounds, panBounds,
  type ViewBounds, type ViewRectangle,
} from "./view";

type CanvasPointer = PointerEvent<HTMLCanvasElement>;
interface Drag {
  mode: "zoom" | "pan";
  start: { x: number; y: number };
  view: ViewBounds;
}

function position(event: CanvasPointer) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { bounds, point: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } };
}

/** Bounds stay in the caller's coordinate space; only pointer distances use pixels. */
export function useFieldInteraction({
  view, home, canFinish = true, onViewChange, onHover, onProbe,
}: {
  view: ViewBounds;
  home: ViewBounds | undefined;
  canFinish?: boolean;
  onViewChange: (view: ViewBounds) => void;
  onHover: (event?: CanvasPointer) => void;
  onProbe: (event: CanvasPointer) => void;
}) {
  const drag = useRef<Drag | undefined>(undefined);
  const [dragBox, setDragBox] = useState<ViewRectangle>();
  return {
    dragBox,
    handlers: {
      onDoubleClick: () => { if (home) onViewChange(home); },
      onAuxClick: (event: MouseEvent<HTMLCanvasElement>) => event.preventDefault(),
      onPointerDown: (event: CanvasPointer) => {
        if (event.button !== 0 && event.button !== 1) return;
        if (event.button === 1) event.preventDefault();
        drag.current = { mode: event.button === 1 ? "pan" : "zoom", start: position(event).point, view };
        if (event.pointerId) event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: CanvasPointer) => {
        if (!drag.current) { onHover(event); return; }
        const { bounds, point } = position(event);
        if (drag.current.mode === "pan" && home) {
          onViewChange(panBounds(drag.current.view, home,
            (point.x - drag.current.start.x) / bounds.width,
            (point.y - drag.current.start.y) / bounds.height));
          onHover();
        } else {
          setDragBox(aspectRectangle(drag.current.start, point, bounds.width, bounds.height));
        }
      },
      onPointerLeave: () => { if (!drag.current) onHover(); },
      onPointerUp: (event: CanvasPointer) => {
        const active = drag.current;
        if (!active || !canFinish) return;
        const { bounds, point } = position(event);
        drag.current = undefined;
        setDragBox(undefined);
        if (active.mode === "pan") return;
        if (Math.abs(point.x - active.start.x) >= 8 || Math.abs(point.y - active.start.y) >= 8) {
          const box = aspectRectangle(active.start, point, bounds.width, bounds.height);
          onViewChange(boxZoomBounds(active.view, box, bounds.width, bounds.height));
        } else {
          onProbe(event);
        }
      },
      onPointerCancel: () => { drag.current = undefined; setDragBox(undefined); },
    },
  };
}
