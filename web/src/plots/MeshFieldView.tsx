import { buildGeometry, probeFromHit, requiredVariable, type FieldGeometry } from "./fieldGeometry";
import { useSlice } from "../data/useSlice";
import { PlotStatus } from "./PlotStatus";
import { displayValue, convertedLabel, unitChoice } from "../data/units";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { fetchSlice } from "../data/api";
import { finiteRange, formatNumber } from "./color";
import { registerPlotCapture } from "./capture";
import type { FieldProps } from "./SpatialField";
import { useFieldInteraction } from "./useFieldInteraction";
import { fieldMargin, plotType } from "./plotgeom";
import { PERFORMANCE_MEASURE, measurePerformance } from "../data/performance";
import { Colorbar, PlotAxes, FieldMarks, type PlotBounds } from "./plot";
import { CoastlineOverlay } from "./CoastlineOverlay";
import { FieldOverlays } from "./FieldOverlays";
import { FieldControls } from "./OverlayLegend";
import type { ContourBox } from "./pressureContours";
import {
  edgesToFaces,
  findMeshHit,
  type Bounds,
  type MeshHit,
} from "./mesh";
import type {
  Metadata,
  Variable,
} from "../data/model";
import { attributeText, displayUnit, quantityLabel } from "../data/model";
import {
  formatPosition,
  probeAtPosition,
} from "./projection";
import { fieldRequest, ugridFieldRequest } from "../data/selection";
import { useElementSize } from "./useElementSize";
import {
  fitPlotToBounds,
  zoomBounds,
  type ViewBounds,
} from "./view";
import { createMeshRenderer, type MeshSurface } from "./webgl";

interface MeshFieldViewProps extends FieldProps {
  controlledView?: ViewBounds;
}

interface PointerValue {
  left: number;
  top: number;
  hit: MeshHit;
  value: number;
}


export function MeshFieldView(props: MeshFieldViewProps) {
  const [frame, size] = useElementSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MeshSurface | undefined>(undefined);
  const [prepared, setPrepared] = useState<{ key: string; geometry: FieldGeometry }>();
  const geometry = prepared?.geometry;
  const [view, setView] = useState<Bounds | undefined>(props.initialView);
  const [hover, setHover] = useState<PointerValue>();
  const [reserve, setReserve] = useState<ContourBox>();
  const [acceptedLargeMesh, setAcceptedLargeMesh] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [error, setError] = useState<string>();
  const changeView = (nextView: ViewBounds) => {
    setView(nextView);
    props.onViewChange(nextView);
  };
  useEffect(() => {
    if (props.controlledView) {
      setView(geometry ? zoomBounds(props.controlledView, geometry.bounds, 1) : props.controlledView);
    }
  }, [
    geometry,
    props.controlledView?.minimumX,
    props.controlledView?.maximumX,
    props.controlledView?.minimumY,
    props.controlledView?.maximumY,
  ]);
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    if (canvas.current === node) return;
    renderer.current?.destroy();
    renderer.current = undefined;
    canvas.current = node;
    if (!node) return;
    try {
      renderer.current = createMeshRenderer(node);
      setRendererReady(true);
      setError(undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      props.onStatus(message);
    }
  }, [props.onStatus]);
  const type = plotType(frame.current);
  const exportingFrame = Boolean(frame.current?.closest(".steering-frame[data-export]"));
  const margin = fieldMargin(type, exportingFrame ? 0 : reserve?.bottom, exportingFrame || props.compact);
  const availablePlot: PlotBounds = {
    left: margin.left,
    top: margin.top,
    width: Math.max(1, size.width - margin.left - margin.right),
    height: Math.max(1, size.height - margin.top - margin.bottom),
  };

  const hint = props.variable.view_hint;
  if (hint.kind !== "curvilinear" && hint.kind !== "ugrid2d") {
    throw new Error("MeshFieldView requires a curvilinear or UGRID variable");
  }
  const connectivityVariable = hint.kind === "ugrid2d"
    ? props.metadata.variables.find((variable) => variable.path === hint.face_node_connectivity)
    : undefined;
  const faceCount = connectivityVariable?.dimensions[0]?.length ?? 0;
  const needsConfirmation =
    hint.kind === "ugrid2d" &&
    faceCount > props.metadata.limits.ugrid_warn_faces &&
    !acceptedLargeMesh;
  const spatialDimension = props.display.x ?? props.variable.dimensions.length - 1;
  const request = useMemo(
    () => {
      if (hint.kind === "ugrid2d") {
        return ugridFieldRequest(props.variable, spatialDimension, props.indices);
      }
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const zoomX = geometry && view
        ? Math.max(1, (geometry.bounds.maximumX - geometry.bounds.minimumX) / (view.maximumX - view.minimumX)) : 1;
      const zoomY = geometry && view
        ? Math.max(1, (geometry.bounds.maximumY - geometry.bounds.minimumY) / (view.maximumY - view.minimumY)) : 1;
      return fieldRequest(
        props.variable,
        props.display,
        props.indices,
        { width: availablePlot.width * ratio * zoomX, height: availablePlot.height * ratio * zoomY },
        true,
        undefined,
        "display",
      );
    },
    [
      hint.kind,
      props.variable,
      spatialDimension,
      props.display,
      props.indices,
      geometry?.bounds,
      view,
      availablePlot.width,
      availablePlot.height,
    ],
  );

  const { slice, loading, error: readError } = useSlice(
    request,
    !needsConfirmation && availablePlot.width > 1 && availablePlot.height > 1,
    {
      ready: next => {
        setError(undefined);
        props.onFrameLoaded();
        props.onStatus(`${next.shape.join(" × ")} · ${hint.kind}${hint.kind === "ugrid2d" ? ` ${hint.location}` : ""} · ${next.dtype}`);
      },
      failed: error => { props.onFrameError?.(); props.onStatus(error.message); },
    },
  );
  useEffect(() => { if (loading) canvas.current?.removeAttribute("data-rendered"); }, [loading]);
  useEffect(() => { setHover(undefined); }, [size.width, size.height, view, slice]);

  const geometryKey = JSON.stringify(slice && [slice.shape,
    slice.request.selection.map(axis => typeof axis === "number" ? null : axis)]);
  useEffect(() => {
    const controller = new AbortController();
    if (needsConfirmation || !slice) return;
    buildGeometry(props.metadata, props.variable, props.display, slice, controller.signal)
      .then((nextGeometry) => {
        if (controller.signal.aborted) return;
        setPrepared({ key: geometryKey, geometry: nextGeometry });
        setView((current) => current ?? props.initialView ?? nextGeometry.bounds);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        props.onFrameError?.();
        props.onStatus(message);
      });
    return () => {
      controller.abort();
    };
  }, [
    needsConfirmation,
    props.metadata,
    props.variable,
    props.display,
    geometryKey,
    props.onFrameError,
    props.onStatus,
  ]);

  const plot: PlotBounds = geometry
    ? fitPlotToBounds(availablePlot, geometry.bounds)
    : availablePlot;

  const values = useMemo(
    () => !(slice?.values instanceof Float32Array) ? undefined : geometry?.edgeFaces
      ? edgesToFaces(slice.values, geometry.edgeFaces, faceCount)
      : slice.values,
    [slice, geometry, faceCount],
  );

  const automaticRange = useMemo(
    () => values
      ? finiteRange(values, props.colormap)
      : { minimum: 0, maximum: 1 },
    [values, props.colormap],
  );
  const activeRange = props.rangeLocked || props.sharedRange ? props.range : automaticRange;
  useEffect(() => {
    if (
      !props.rangeLocked &&
      (props.range.minimum !== automaticRange.minimum || props.range.maximum !== automaticRange.maximum)
    ) {
      props.onRange(automaticRange);
    }
  }, [automaticRange, props.range, props.rangeLocked, props.onRange]);

  useEffect(() => {
    if (!rendererReady || !renderer.current || !geometry || prepared?.key !== geometryKey || !view || !values) return;
    renderer.current.draw(geometry, values, {
      colormap: props.colormap,
      scale: props.scale,
      range: activeRange,
      view,
      width: plot.width,
      height: plot.height,
    });
    canvas.current?.setAttribute("data-rendered", "true");
  }, [rendererReady, geometry, prepared?.key, geometryKey, values, view, props.colormap, props.scale, activeRange, plot.width, plot.height]);

  useEffect(() => {
    const node = frame.current;
    const surface = renderer.current;
    if (!node || !rendererReady || !surface || !geometry || !view || !values) return;
    return registerPlotCapture(node, async (width, height) => {
      let exportGeometry = geometry;
      let exportValues = values;
      let sampling = hint.kind === "ugrid2d" && hint.location === "edge" ? "native; incident-edge mean" : "native";
      if (hint.kind === "curvilinear") {
        const exportRequest = fieldRequest(
          props.variable,
          props.display,
          props.indices,
          { width, height },
          true,
        );
        const exportSlice = await fetchSlice(exportRequest);
        sampling = `nearest; stride=${exportRequest.selection.map(axis => typeof axis === "number" ? 1 : axis.stride).join(",")}`;
        if (!(exportSlice.values instanceof Float32Array)) {
          throw new Error("The mesh data is not available for export");
        }
        exportGeometry = await buildGeometry(
          props.metadata,
          props.variable,
          props.display,
          exportSlice,
        );
        exportValues = exportSlice.values;
      }
      const blob = await surface.capture(
        exportGeometry,
        exportValues,
        {
          colormap: props.colormap,
          scale: props.scale,
          range: activeRange,
          view,
          width: plot.width,
          height: plot.height,
        },
        width,
        height,
      );
      return { blob, sampling };
    });
  }, [
    frame,
    rendererReady,
    geometry,
    values,
    view,
    hint.kind,
    props.metadata,
    props.variable,
    props.display,
    props.indices,
    props.colormap,
    props.scale,
    activeRange,
    plot.width,
    plot.height,
  ]);

  const axis = meshAxisLabels(props.metadata, props.variable);
  const probePosition = view && props.probe
    ? {
        x: plot.left + ((props.probe.x - view.minimumX) / (view.maximumX - view.minimumX)) * plot.width,
        y: plot.top + (1 - (props.probe.y - view.minimumY) / (view.maximumY - view.minimumY)) * plot.height,
      }
    : undefined;

  const inspect = (event: PointerEvent<HTMLCanvasElement>): PointerValue | undefined => {
    if (!geometry || prepared?.key !== geometryKey || !view || !values) return undefined;
    const bounds = event.currentTarget.getBoundingClientRect();
    const localX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const localY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const dataX = view.minimumX + (localX / bounds.width) * (view.maximumX - view.minimumX);
    const dataY = view.maximumY - (localY / bounds.height) * (view.maximumY - view.minimumY);
    const hit = findMeshHit(geometry, dataX, dataY);
    if (!hit) return undefined;
    return {
      left: event.clientX - frame.current!.getBoundingClientRect().left,
      top: event.clientY - frame.current!.getBoundingClientRect().top,
      hit,
      value: Number(values[hit.scalarIndex]),
    };
  };

  const selectProbe = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!slice) return;
    const inspected = inspect(event);
    if (!inspected || !Number.isFinite(inspected.value)) return;
    const probe = probeFromHit(
      props.variable, props.display, props.indices, slice, inspected.hit, inspected.value,
    );
    if (geometry?.edgeFaces) {
      const edgeIndices: number[] = [];
      // ponytail: one O(edges) scan per click avoids a second mesh-sized adjacency cache.
      for (let edge = 0; edge < geometry.edgeFaces.length / 2; edge += 1) {
        if (geometry.edgeFaces[edge * 2] === inspected.hit.scalarIndex ||
            geometry.edgeFaces[edge * 2 + 1] === inspected.hit.scalarIndex) edgeIndices.push(edge);
      }
      if (edgeIndices.length) probe.average = {
        dimension: props.variable.dimensions[spatialDimension].path,
        indices: edgeIndices,
      };
    }
    props.onProbe(probeAtPosition(
      props.metadata,
      props.variable,
      probe,
    ));
  };

  const { dragBox, handlers } = useFieldInteraction({
    view: view ?? geometry?.bounds ?? { minimumX: 0, maximumX: 1, minimumY: 0, maximumY: 1 },
    home: geometry?.bounds,
    canFinish: Boolean(view && slice),
    onViewChange: changeView,
    onHover: (event) => setHover(event ? inspect(event) : undefined),
    onProbe: selectProbe,
  });

  if (needsConfirmation) {
    const estimatedMegabytes = Math.ceil((faceCount * 3 * 16) / 1024 / 1024);
    return (
      <div className="plot-frame mesh-warning" ref={frame}>
        <strong>{faceCount.toLocaleString()} mesh faces</strong>
        <p>About {estimatedMegabytes.toLocaleString()} MiB of browser geometry may be needed.</p>
        <button onClick={() => setAcceptedLargeMesh(true)}>Load mesh once</button>
      </div>
    );
  }

  return (
    <div className="plot-frame mesh-frame" ref={frame}>
      <canvas
        ref={attachCanvas}
        className="mesh-canvas"
        data-geometry={geometry ? "true" : "false"}
        data-renderer={rendererReady ? "true" : "false"}
        data-slice={slice ? "true" : "false"}
        data-view={view ? "true" : "false"}
        style={{ left: plot.left, top: plot.top, width: plot.width, height: plot.height }}
        aria-label={`${props.variable.name} ${hint.kind} field`}
        {...handlers}
      />
      <svg className="plot-svg" width={size.width} height={size.height} aria-hidden="true">
        {(props.wind || props.pressure || props.mapSource === "coastline") && geometry && view && <FieldOverlays
          metadata={props.overlaySource?.metadata ?? props.metadata} variable={props.overlaySource?.variable ?? props.variable} wind={props.wind} pressure={props.pressure}
          settings={props.fieldSettings}
          indices={props.overlaySource?.indices ?? props.indices} bounds={view} plot={plot} labelSize={type.tick} geometry={geometry}
          spatialDimension={props.variable.dimensions[spatialDimension]?.path}
          reserve={reserve} onStatus={props.onStatus}>
          {props.mapSource === "coastline" && <CoastlineOverlay bounds={view} plot={plot} onStatus={props.onStatus} />}
        </FieldOverlays>}

        <PlotAxes
          type={type}
          plot={plot}
          xDomain={view ? [view.minimumX, view.maximumX] : [0, 1]}
          yDomain={view ? [view.minimumY, view.maximumY] : [0, 1]}
          xLabel={axis.x}
          yLabel={axis.y}
          boxed
        />
        <Colorbar
          type={type}
          plot={plot}
          range={activeRange}
          colormap={props.colormap}
          scale={props.scale}
          label={props.targetUnit ? convertedLabel(props.variable, props.targetUnit.label) : quantityLabel(props.variable)}
          sourceUnit={unitChoice(props.variable).source}
          targetUnit={props.targetUnit}
        />
        <FieldMarks plot={plot} dragBox={dragBox} probe={
          probePosition && Number.isFinite(probePosition.x) && Number.isFinite(probePosition.y)
            ? probePosition : undefined
        } />
      </svg>
      {geometry && (
        <FieldControls overlays={props.overlays} onReserve={setReserve} compact={props.compact}
            onZoomIn={() => changeView(zoomBounds(view ?? geometry.bounds, geometry.bounds, 0.75))}
            onZoomOut={() => changeView(zoomBounds(view ?? geometry.bounds, geometry.bounds, 4 / 3))}
            onReset={() => changeView(geometry.bounds)}
        />
      )}
      {hover && (
        <output
          className="plot-tooltip"
          ref={node => {
            if (!node) return;
            node.style.left = `${Math.max(0, Math.min(size.width - node.offsetWidth, hover.left + 14))}px`;
            node.style.top = `${Math.max(0, Math.min(size.height - node.offsetHeight, hover.top + 12))}px`;
          }}
        >
          <strong>{formatNumber(displayValue(hover.value, props.variable, props.targetUnit))} {props.targetUnit?.label ?? displayUnit(props.variable)}</strong>
          <span>{formatPosition(
            props.metadata,
            props.variable,
            hover.hit.x,
            hover.hit.y,
            hover.hit.latitude === undefined || hover.hit.longitude === undefined
              ? undefined
              : { latitude: hover.hit.latitude, longitude: hover.hit.longitude },
          )}</span>
        </output>
      )}
      <PlotStatus loading={loading} message="reading newest mesh field…" error={readError ?? error} />
    </div>
  );
}


function meshAxisLabels(metadata: Metadata, variable: Variable): { x: string; y: string } {
  const hint = variable.view_hint;
  if (hint.kind !== "curvilinear" && hint.kind !== "ugrid2d") return { x: "x", y: "y" };
  const x = requiredVariable(metadata, hint.x);
  const y = requiredVariable(metadata, hint.y);
  return { x: `${x.name} (${displayUnit(x)})`, y: `${y.name} (${displayUnit(y)})` };
}
