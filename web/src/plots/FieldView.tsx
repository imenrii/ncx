import { loadRectilinearAxis } from "./fieldGeometry";
import { paintFieldSource, drawFieldRaster, fieldSliceBounds } from "./structured";
import { useSlice } from "../data/useSlice";
import { PlotStatus } from "./PlotStatus";
import { displayValue, convertedLabel, unitChoice } from "../data/units";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { fetchSlice } from "../data/api";
import {
  finiteRange,
  formatNumber,
  type ColorRange,
  type ColormapChoice,
} from "./color";
import type {
  ColorScale,
  DataSlice,
  Metadata,
  Probe,
  Variable,
} from "../data/model";
import { attributeText, displayUnit, quantityLabel } from "../data/model";
import { formatPosition, probeAtPosition } from "./projection";
import { canvasPng, registerPlotCapture, validateCanvasSize } from "./capture";
import { fieldRequest, type DisplayDimensions } from "../data/selection";
import type { FieldProps } from "./SpatialField";
import { useFieldInteraction } from "./useFieldInteraction";
import { useElementSize } from "./useElementSize";
import { fieldMargin, plotType } from "./plotgeom";
import { PERFORMANCE_MEASURE, measurePerformance } from "../data/performance";
import { type RectilinearAxis } from "./rectilinear";
import { CoastlineOverlay } from "./CoastlineOverlay";
import { FieldOverlays } from "./FieldOverlays";
import { FieldControls } from "./OverlayLegend";
import type { ContourBox } from "./pressureContours";
import { Colorbar, PlotAxes, FieldMarks } from "./plot";
import {
  fitPlotToBounds,
  projectRectangle,
  zoomBounds,
  type ViewBounds,
  type ViewRectangle,
} from "./view";
import { usePublishDisplayValues } from "../app/controls/displayValues";

interface FieldViewProps extends FieldProps {
  controlledWorldView?: ViewBounds;
  onWorldViewChange?: (view: ViewBounds) => void;
}

interface Coordinates {
  x?: Float64Array;
  y?: Float64Array;
  xAxis?: RectilinearAxis;
  yAxis?: RectilinearAxis;
}

interface HoverValue {
  left: number;
  top: number;
  x: number;
  y: number;
  value: number;
  sourceX: number;
  sourceY: number;
}

const FULL_FIELD: ViewBounds = { minimumX: 0, maximumX: 1, minimumY: 0, maximumY: 1 };

export function FieldView(props: FieldViewProps) {
  const [frame, frameSize] = useElementSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const sourceCanvas = useRef<HTMLCanvasElement | null>(null);
  const rasterImage = useRef<ImageData | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates>({});
  const [error, setError] = useState<string>();
  const [hover, setHover] = useState<HoverValue>();
  const [reserve, setReserve] = useState<ContourBox>();
  const [view, setView] = useState<ViewBounds>(props.initialView ?? FULL_FIELD);
  const changeView = (nextView: ViewBounds) => {
    setView(nextView);
    props.onViewChange(nextView);
    if (layout && props.onWorldViewChange) {
      props.onWorldViewChange(worldView(layout, nextView));
    }
  };
  const type = plotType(frame.current);
  const exportingFrame = Boolean(frame.current?.closest(".steering-frame[data-export]"));
  const margin = fieldMargin(type, exportingFrame ? 0 : reserve?.bottom, exportingFrame || props.compact);
  const availablePlot = {
    left: margin.left,
    top: margin.top,
    width: Math.max(1, frameSize.width - margin.left - margin.right),
    height: Math.max(1, frameSize.height - margin.top - margin.bottom),
  };
  const request = useMemo(
    () => {
      const ratio = props.settled ? Math.min(2, window.devicePixelRatio || 1) : 1;
      return fieldRequest(
        props.variable,
        props.display,
        props.indices,
        { width: availablePlot.width * ratio, height: availablePlot.height * ratio },
        props.settled,
        sourceRegion(view, coordinates),
      );
    },
    [
      props.variable,
      props.display,
      props.indices,
      props.settled,
      availablePlot.width,
      availablePlot.height,
      view,
      coordinates,
    ],
  );

  const { slice, loading, error: readError } = useSlice(request, true, {
    ready: next => {
      setError(undefined);
      props.onFrameLoaded();
      props.onStatus(`${next.shape.join(" × ") || "scalar"} · stride ${request.selection.map(axis => typeof axis === "number" ? 1 : axis.stride).join(",")} · ${next.dtype}`);
    },
    failed: error => { props.onFrameError?.(); props.onStatus(error.message); },
  });
  useEffect(() => { setHover(undefined); }, [frameSize.width, frameSize.height, view, slice]);

  useEffect(() => {
    let active = true;
    const hint = props.variable.view_hint;
    if (hint.kind !== "rectilinear") {
      setCoordinates({});
      return;
    }
    const x = props.metadata.variables.find((variable) => variable.path === hint.x);
    const y = props.metadata.variables.find((variable) => variable.path === hint.y);
    if (!x || !y) {
      setCoordinates({});
      props.onStatus("rectilinear coordinate metadata is incomplete; using index geometry");
      return;
    }
    setCoordinates({});
    Promise.all([
      loadRectilinearAxis(props.metadata, x),
      loadRectilinearAxis(props.metadata, y),
    ])
      .then(([xResult, yResult]) => {
        if (!active) return;
        const usable = xResult.axis && yResult.axis;
        setCoordinates(usable ? {
          x: xResult.values,
          y: yResult.values,
          xAxis: xResult.axis,
          yAxis: yResult.axis,
        } : {});
        const warnings = [xResult.warning, yResult.warning].filter(Boolean);
        if (warnings.length) props.onStatus(warnings.join("; "));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setCoordinates({});
        const message = cause instanceof Error ? cause.message : String(cause);
        props.onStatus(`cannot read rectilinear coordinates: ${message}; using index geometry`);
      });
    return () => {
      active = false;
    };
  }, [props.metadata, props.variable, props.onStatus]);

  const layout = useMemo(
    () => fieldLayout(props.variable, props.display, slice, coordinates),
    [props.variable, props.display, slice, coordinates],
  );
  useEffect(() => {
    if (layout && props.controlledWorldView) {
      setView(normalizedView(layout, props.controlledWorldView));
    }
  }, [
    layout,
    props.controlledWorldView?.minimumX,
    props.controlledWorldView?.maximumX,
    props.controlledWorldView?.minimumY,
    props.controlledWorldView?.maximumY,
  ]);
  const plot = layout
    ? fitPlotToBounds(availablePlot, {
        minimumX: layout.xDomain[0],
        maximumX: layout.xDomain[1],
        minimumY: layout.yDomain[0],
        maximumY: layout.yDomain[1],
      })
    : availablePlot;
  const automaticRange = useMemo(
    () => slice?.values instanceof Float32Array
      ? finiteRange(slice.values, props.colormap)
      : undefined,
    [slice, props.colormap],
  );
  const renderRange = props.rangeLocked || props.sharedRange ? props.range : automaticRange;
  usePublishDisplayValues(slice?.values instanceof Float32Array ? slice.values : undefined);

  useEffect(() => {
    if (
      automaticRange &&
      !props.rangeLocked &&
      (automaticRange.minimum !== props.range.minimum || automaticRange.maximum !== props.range.maximum)
    ) {
      props.onRange(automaticRange);
    }
  }, [automaticRange, props.range.minimum, props.range.maximum, props.rangeLocked, props.onRange]);

  // Keep colour conversion off the pan path. View-only changes composite this cached raster.
  useEffect(() => {
    if (!slice || !layout || !renderRange || !(slice.values instanceof Float32Array)) return;
    const painted = paintFieldSource(
      layout,
      renderRange,
      props.scale,
      props.colormap,
      sourceCanvas.current,
      rasterImage.current,
    );
    if (!painted) return;
    sourceCanvas.current = painted.canvas;
    rasterImage.current = painted.image;
  }, [
    slice,
    layout,
    props.colormap,
    props.scale,
    renderRange?.minimum,
    renderRange?.maximum,
  ]);

  useEffect(() => {
    const node = canvas.current;
    const source = sourceCanvas.current;
    if (!node || !source || !slice || !layout || !renderRange) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(plot.width * ratio));
    const height = Math.max(1, Math.round(plot.height * ratio));
    drawFieldRaster(node, source, layout, view, width, height);
    // Announce a painted canvas, as the mesh view does. A fresh canvas is
    // 300x150 with no pixels drawn, so its size cannot say whether the slice
    // has actually reached the screen.
    node.dataset.rendered = "true";
  }, [
    slice,
    layout,
    props.colormap,
    props.scale,
    renderRange?.minimum,
    renderRange?.maximum,
    plot.width,
    plot.height,
    view,
  ]);

  useEffect(() => {
    const node = frame.current;
    if (!node || !layout || !renderRange) return;
    return registerPlotCapture(node, async (width, height) => {
      validateCanvasSize(width, height);
      const exportRequest = fieldRequest(
        props.variable,
        props.display,
        props.indices,
        { width, height },
        true,
        sourceRegion(view, coordinates),
      );
      const exportSlice = await fetchSlice(exportRequest);
      const exportLayout = fieldLayout(props.variable, props.display, exportSlice, coordinates);
      if (!exportLayout || !(exportSlice.values instanceof Float32Array)) {
        throw new Error("The field data is not available for export");
      }
      const painted = paintFieldSource(
        exportLayout,
        renderRange,
        props.scale,
        props.colormap,
      );
      if (!painted) throw new Error("The browser could not create the field export canvas");
      const output = document.createElement("canvas");
      drawFieldRaster(output, painted.canvas, exportLayout, view, width, height);
      return { blob: await canvasPng(output), sampling: `nearest; stride=${exportRequest.selection.map(axis => typeof axis === "number" ? 1 : axis.stride).join(",")}` };
    });
  }, [
    frame,
    layout,
    renderRange?.minimum,
    renderRange?.maximum,
    props.variable,
    props.display,
    props.indices,
    props.scale,
    props.colormap,
    view,
    coordinates,
  ]);

  const inspectPointer = (event: PointerEvent<HTMLCanvasElement>): HoverValue | undefined => {
    if (!layout) return undefined;
    const bounds = event.currentTarget.getBoundingClientRect();
    const screenX = Math.max(0, Math.min(bounds.width - 1, event.clientX - bounds.left));
    const screenY = Math.max(0, Math.min(bounds.height - 1, event.clientY - bounds.top));
    const cell = fieldCell(layout, view, screenX / bounds.width, screenY / bounds.height);
    if (!cell) return undefined;
    const { column, row } = cell;
    const sourceX = Math.min(
      layout.xDimension.length - 1,
      layout.xStart + column * layout.xStride,
    );
    const sourceY = Math.min(
      layout.yDimension.length - 1,
      layout.yStart + row * layout.yStride,
    );
    return {
      left: event.clientX - frame.current!.getBoundingClientRect().left,
      top: event.clientY - frame.current!.getBoundingClientRect().top,
      x: coordinates.x?.[sourceX] ?? sourceX,
      y: coordinates.y?.[sourceY] ?? sourceY,
      value: layout.valueAt(row, column),
      sourceX,
      sourceY,
    };
  };

  const selectProbe = (event: PointerEvent<HTMLCanvasElement>) => {
    const inspected = inspectPointer(event);
    if (!inspected || !layout) return;
    props.onProbe(probeAtPosition(props.metadata, props.variable, {
      indices: {
        ...props.indices,
        [layout.xDimension.path]: inspected.sourceX,
        [layout.yDimension.path]: inspected.sourceY,
      },
      x: inspected.x,
      y: inspected.y,
      value: inspected.value,
    }));
  };

  const xLabel = coordinateLabel(props.metadata, props.variable, "x", layout?.xDimension.name);
  const yLabel = coordinateLabel(props.metadata, props.variable, "y", layout?.yDimension.name);
  const probePosition = layout && props.probe
    ? visibleProbePosition(layout.probePosition(props.probe), view)
    : undefined;
  const xDomain = layout
    ? visibleDomain(layout.xDomain, view.minimumX, view.maximumX)
    : [0, 1] as [number, number];
  const yDomain = layout
    ? visibleDomain(layout.yDomain, view.minimumY, view.maximumY)
    : [0, 1] as [number, number];

  const { dragBox, handlers } = useFieldInteraction({
    view,
    home: FULL_FIELD,
    onViewChange: changeView,
    onHover: (event) => setHover(event ? inspectPointer(event) : undefined),
    onProbe: selectProbe,
  });

  return (
    <div className="plot-frame field-frame" ref={frame}>
      {props.variable.dimensions.length === 0 ? (
        <div className="scalar-value" aria-label={`${props.variable.name} scalar value`}>
          <strong>{slice ? formatNumber(displayValue(Number(slice.values[0]), props.variable, props.targetUnit)) : "—"}</strong>
          <span>{props.targetUnit?.label ?? displayUnit(props.variable)}</span>
          <small>{props.variable.dtype}</small>
        </div>
      ) : (
        <>
          <canvas
            ref={canvas}
            className="field-canvas"
            style={{ left: plot.left, top: plot.top, width: plot.width, height: plot.height }}
            {...handlers}
            aria-label={`${props.variable.name} field`}
          />
          <svg className="plot-svg" width={frameSize.width} height={frameSize.height} aria-hidden="true">
            {(props.wind || props.pressure || props.mapSource === "coastline") && layout && <FieldOverlays
              metadata={props.overlaySource?.metadata ?? props.metadata} variable={props.overlaySource?.variable ?? props.variable} wind={props.wind} pressure={props.pressure}
          settings={props.fieldSettings}
              indices={props.overlaySource?.indices ?? props.indices} bounds={{ minimumX: xDomain[0], maximumX: xDomain[1], minimumY: yDomain[0], maximumY: yDomain[1] }}
              plot={plot} labelSize={type.tick} reserve={reserve}
              onStatus={props.onStatus}>
              {props.mapSource === "coastline" && <CoastlineOverlay
                bounds={{ minimumX: xDomain[0], maximumX: xDomain[1], minimumY: yDomain[0], maximumY: yDomain[1] }}
                plot={plot} onStatus={props.onStatus} />}
            </FieldOverlays>}
            <PlotAxes
              type={type}
              plot={plot}
              xDomain={xDomain}
              yDomain={yDomain}
              xLabel={xLabel}
              yLabel={yLabel}
              boxed
            />
            <Colorbar
              type={type}
              plot={plot}
              range={props.range}
              colormap={props.colormap}
              scale={props.scale}
              label={props.targetUnit ? convertedLabel(props.variable, props.targetUnit.label) : quantityLabel(props.variable)}
              sourceUnit={unitChoice(props.variable).source}
              targetUnit={props.targetUnit}
            />
            <FieldMarks plot={plot} dragBox={dragBox} probe={probePosition && {
              x: plot.left + probePosition.x * plot.width,
              y: plot.top + probePosition.y * plot.height,
            }} />
          </svg>
          <FieldControls overlays={props.overlays} onReserve={setReserve} compact={props.compact}
              onZoomIn={() => changeView(zoomBounds(view, FULL_FIELD, 0.75))}
              onZoomOut={() => changeView(zoomBounds(view, FULL_FIELD, 4 / 3))}
              onReset={() => changeView(FULL_FIELD)}
          />
        </>
      )}
      {hover && (
        <output
          className="plot-tooltip"
          ref={node => {
            if (!node) return;
            node.style.left = `${Math.max(0, Math.min(frameSize.width - node.offsetWidth, hover.left + 14))}px`;
            node.style.top = `${Math.max(0, Math.min(frameSize.height - node.offsetHeight, hover.top + 12))}px`;
          }}
        >
          <strong>{formatNumber(displayValue(hover.value, props.variable, props.targetUnit))} {props.targetUnit?.label ?? displayUnit(props.variable)}</strong>
          <span>{formatPosition(props.metadata, props.variable, hover.x, hover.y)}</span>
        </output>
      )}
      <PlotStatus loading={loading} message="reading newest slice…" error={readError ?? error} />
    </div>
  );
}


function fieldLayout(
  variable: Variable,
  display: DisplayDimensions,
  slice: DataSlice | undefined,
  coordinates: Coordinates,
) {
  if (
    display.x === undefined ||
    display.y === undefined ||
    display.x === display.y ||
    display.x < 0 ||
    display.y < 0 ||
    display.x >= variable.dimensions.length ||
    display.y >= variable.dimensions.length ||
    !slice ||
    slice.shape.length !== 2
  ) {
    return undefined;
  }
  const remaining = variable.dimensions
    .map((_, index) => index)
    .filter((index) => index === display.x || index === display.y);
  const xPosition = remaining.indexOf(display.x);
  const yPosition = remaining.indexOf(display.y);
  const columns = slice.shape[xPosition];
  const rows = slice.shape[yPosition];
  const xDimension = variable.dimensions[display.x];
  const yDimension = variable.dimensions[display.y];
  const xSelection = slice.request.selection[display.x];
  const ySelection = slice.request.selection[display.y];
  if (typeof xSelection === "number" || typeof ySelection === "number") throw new Error("Field dimensions must be ranges");
  const { start: xStart, stop: xStop, stride: xStride } = xSelection;
  const { start: yStart, stop: yStop, stride: yStride } = ySelection;
  const xAxis = coordinates.xAxis;
  const yAxis = coordinates.yAxis;
  const flipX = xAxis ? xAxis.edges.at(-1)! < xAxis.edges[0] : false;
  const flipY = yAxis ? yAxis.edges.at(-1)! > yAxis.edges[0] : true;
  const valueAt = (row: number, column: number) => {
    const index = yPosition === 0 ? row * columns + column : column * rows + row;
    return Number(slice.values[index]);
  };
  const xDomain: [number, number] = xAxis ? [...xAxis.domain] : [0, xDimension.length - 1];
  const yDomain: [number, number] = yAxis ? [...yAxis.domain] : [0, yDimension.length - 1];
  return {
    columns,
    rows,
    xDimension,
    yDimension,
    xStart,
    xStop,
    yStart,
    yStop,
    xStride,
    yStride,
    flipX,
    flipY,
    xAxis,
    yAxis,
    xDomain,
    yDomain,
    valueAt,
    probePosition: (probe: Probe) => {
      const sourceX = probe.indices[xDimension.path];
      const sourceY = probe.indices[yDimension.path];
      const coordinateFraction = (value: number, domain: [number, number]) =>
        (value - domain[0]) / (domain[1] - domain[0]);
      const fractionX = sourceX === undefined
        ? coordinateFraction(probe.x, xDomain)
        : xAxis
          ? coordinateFraction(xAxis.centers[sourceX], xDomain)
          : (flipX ? 1 - sourceX / Math.max(1, xDimension.length - 1) : sourceX / Math.max(1, xDimension.length - 1));
      const fractionY = sourceY === undefined
        ? coordinateFraction(probe.y, yDomain)
        : yAxis
          ? coordinateFraction(yAxis.centers[sourceY], yDomain)
          : (flipY ? sourceY / Math.max(1, yDimension.length - 1) : 1 - sourceY / Math.max(1, yDimension.length - 1));
      if (!Number.isFinite(fractionX) || !Number.isFinite(fractionY)) return undefined;
      return {
        x: fractionX,
        y: fractionY,
      };
    },
  };
}

function fieldCell(
  layout: NonNullable<ReturnType<typeof fieldLayout>>,
  view: ViewBounds,
  screenX: number,
  screenY: number,
): { column: number; row: number } | undefined {
  if (layout.xAxis && layout.yAxis) {
    const physicalX = view.minimumX + screenX * (view.maximumX - view.minimumX);
    const physicalY = view.maximumY - screenY * (view.maximumY - view.minimumY);
    const sourceX = layout.xAxis.cellAtNormalized(physicalX);
    const sourceY = layout.yAxis.cellAtNormalized(physicalY);
    if (
      sourceX === undefined ||
      sourceY === undefined ||
      sourceX < layout.xStart ||
      sourceX >= layout.xStop ||
      sourceY < layout.yStart ||
      sourceY >= layout.yStop
    ) {
      return undefined;
    }
    return {
      column: Math.min(layout.columns - 1, Math.floor((sourceX - layout.xStart) / layout.xStride)),
      row: Math.min(layout.rows - 1, Math.floor((sourceY - layout.yStart) / layout.yStride)),
    };
  }

  const bounds = fieldSliceBounds(layout);
  const x = view.minimumX + screenX * (view.maximumX - view.minimumX);
  const y = 1 - view.maximumY + screenY * (view.maximumY - view.minimumY);
  const columnFraction = (x - bounds.left) / bounds.width;
  const rowFraction = (y - bounds.top) / bounds.height;
  if (columnFraction < 0 || columnFraction >= 1 || rowFraction < 0 || rowFraction >= 1) {
    return undefined;
  }
  let column = Math.min(layout.columns - 1, Math.floor(columnFraction * layout.columns));
  let row = Math.min(layout.rows - 1, Math.floor(rowFraction * layout.rows));
  if (layout.flipX) column = layout.columns - 1 - column;
  if (layout.flipY) row = layout.rows - 1 - row;
  return { column, row };
}

function sourceRegion(view: ViewBounds, coordinates: Coordinates): ViewBounds {
  const x = coordinates.xAxis
    ? coordinates.xAxis.viewWindow(...visibleDomain([...coordinates.xAxis.domain], view.minimumX, view.maximumX))
    : undefined;
  const y = coordinates.yAxis
    ? coordinates.yAxis.viewWindow(...visibleDomain([...coordinates.yAxis.domain], view.minimumY, view.maximumY))
    : undefined;
  const xLength = coordinates.xAxis?.centers.length ?? 1;
  const yLength = coordinates.yAxis?.centers.length ?? 1;
  const flipX = coordinates.x ? coordinates.x.at(-1)! < coordinates.x[0] : false;
  const flipY = coordinates.y ? coordinates.y.at(-1)! > coordinates.y[0] : true;
  return {
    minimumX: x ? x.start / xLength : flipX ? 1 - view.maximumX : view.minimumX,
    maximumX: x ? x.stop / xLength : flipX ? 1 - view.minimumX : view.maximumX,
    minimumY: y ? y.start / yLength : flipY ? view.minimumY : 1 - view.maximumY,
    maximumY: y ? y.stop / yLength : flipY ? view.maximumY : 1 - view.minimumY,
  };
}

function visibleProbePosition(
  position: { x: number; y: number } | undefined,
  view: ViewBounds,
): { x: number; y: number } | undefined {
  if (
    !position ||
    position.x < view.minimumX ||
    position.x > view.maximumX ||
    position.y < view.minimumY ||
    position.y > view.maximumY
  ) {
    return undefined;
  }
  return {
    x: (position.x - view.minimumX) / (view.maximumX - view.minimumX),
    y: 1 - (position.y - view.minimumY) / (view.maximumY - view.minimumY),
  };
}

function visibleDomain(
  domain: [number, number],
  minimum: number,
  maximum: number,
): [number, number] {
  const span = domain[1] - domain[0];
  return [domain[0] + minimum * span, domain[0] + maximum * span];
}

function worldView(
  layout: NonNullable<ReturnType<typeof fieldLayout>>,
  view: ViewBounds,
): ViewBounds {
  const x = visibleDomain(layout.xDomain, view.minimumX, view.maximumX);
  const y = visibleDomain(layout.yDomain, view.minimumY, view.maximumY);
  return { minimumX: x[0], maximumX: x[1], minimumY: y[0], maximumY: y[1] };
}

function normalizedView(
  layout: NonNullable<ReturnType<typeof fieldLayout>>,
  view: ViewBounds,
): ViewBounds {
  const axis = (minimum: number, maximum: number, domain: [number, number]) => {
    const span = domain[1] - domain[0];
    if (!Number.isFinite(span) || span <= 0) return [0, 1] as const;
    const fraction = (value: number) => Math.max(0, Math.min(1, (value - domain[0]) / span));
    return [fraction(minimum), fraction(maximum)] as const;
  };
  const x = axis(view.minimumX, view.maximumX, layout.xDomain);
  const y = axis(view.minimumY, view.maximumY, layout.yDomain);
  return {
    minimumX: x[0],
    maximumX: x[1],
    minimumY: y[0],
    maximumY: y[1],
  };
}

export function coordinateLabel(
  metadata: Metadata,
  variable: Variable,
  axis: "x" | "y",
  fallback: string = axis,
): string {
  const hint = variable.view_hint;
  if (hint.kind === "plain") return fallback;
  const coordinate = metadata.variables.find((candidate) => candidate.path === hint[axis]);
  if (!coordinate) return fallback;
  return quantityLabel(coordinate);
}
