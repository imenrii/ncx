import { useLayoutEffect, useRef, useState } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

export function useElementSize<T extends HTMLElement>() {
  const element = useRef<T>(null);
  const [size, setSize] = useState<ElementSize>({ width: 1, height: 1 });

  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // A base-font change can alter plot type while the frame stays fixed.
    const remProbe = document.createElement("span");
    remProbe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:1rem;height:1rem";
    document.body.append(remProbe);
    observer.observe(remProbe);
    // Fonts can change label widths without changing the plot frame.
    document.fonts.addEventListener("loadingdone", measure);
    return () => { observer.disconnect(); remProbe.remove(); document.fonts.removeEventListener("loadingdone", measure); };
  }, []);

  return [element, size] as const;
}

