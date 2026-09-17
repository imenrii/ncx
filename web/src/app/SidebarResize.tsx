import { useLayoutEffect, useRef, useState } from "react";

export function SidebarResize() {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [limits, setLimits] = useState({ min: 0, max: 0 });
  useLayoutEffect(() => {
    const shell = handle.current!.parentElement!;
    const resize = () => {
      const css = getComputedStyle(shell);
      const min = parseFloat(css.getPropertyValue("--sidebar-min"));
      const max = Math.max(min, Math.min(parseFloat(css.getPropertyValue("--sidebar-max")),
        shell.clientWidth - parseFloat(css.getPropertyValue("--plot-min"))));
      setLimits({ min, max });
      setWidth(current => Math.max(min, Math.min(max, current || parseFloat(css.getPropertyValue("--sidebar-width")))));
    };
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    resize();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (width) handle.current!.parentElement!.style.setProperty("--sidebar-width", `${width}px`);
  }, [width]);
  const change = (next: number) => setWidth(Math.max(limits.min, Math.min(limits.max, next)));
  return <div ref={handle} className="sidebar-resize" role="separator" tabIndex={0}
    aria-label="Sidebar width" aria-orientation="vertical" aria-valuemin={limits.min}
    aria-valuemax={limits.max} aria-valuenow={Math.round(width)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width };
    }}
    onPointerMove={event => { if (drag.current) change(drag.current.width + event.clientX - drag.current.x); }}
    onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); drag.current = undefined; }}
    onLostPointerCapture={() => { drag.current = undefined; }}
    onKeyDown={event => {
      const step = event.shiftKey ? 32 : 8;
      const next = event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step
        : event.key === "Home" ? limits.min : event.key === "End" ? limits.max : undefined;
      if (next !== undefined) { event.preventDefault(); change(next); }
    }} />;
}
