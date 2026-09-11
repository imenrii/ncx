import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import { LatestSliceLoader, fetchCoordinate, fetchSlice, fetchStaticSlice } from "../data/api";
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
  buildCurvilinearGeometry,
  buildUgridGeometry,
  edgesToFaces,
  findMeshHit,
  type Bounds,
  type MeshGeometry,
  type MeshHit,
} from "./mesh";
import type {
  DataSlice,
  Metadata,
  Probe,
  Variable,
} from "../data/model";
import { attributeNumber, attributeNumbers, attributeText, displayUnit, quantityLabel, resolveVariableReference } from "../data/model";
import {
  formatPosition,
  geographicCoordinateVariables,
  probeAtPosition,
} from "./projection";
import { fieldRequest, ugridFieldRequest, type DisplayDimensions } from "../data/selection";
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

type FieldGeometry = MeshGeometry & { edgeFaces?: Int32Array };

export function MeshFieldView(props: MeshFieldViewProps) {
  const [frame, size] = useElementSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MeshSurface | undefined>(undefined);
  const loader = useRef(new LatestSliceLoader());
  const [slice, setSlice] = useState<DataSlice>();
  const [geometry, setGeometry] = useState<FieldGeometry>();
  const [view, setView] = useState<Bounds | undefined>(props.initialView);
  const [hover, setHover] = useState<PointerValue>();
  const [reserve, setReserve] = useState<ContourBox>();
  useEffect(() => { setHover(undefined); }, [size.width, size.height, view, slice]);
  const [acceptedLargeMesh, setAcceptedLargeMesh] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const margin = fieldMargin(type, reserve?.bottom);
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
      const ratio = props.settled ? Math.min(2, window.devicePixelRatio || 1) : 1;
      return fieldRequest(
        props.variable,
        props.display,
        props.indices,
        { width: availablePlot.width * ratio, height: availablePlot.height * ratio },
        props.settled,
      );
    },
    [
      hint.kind,
      props.variable,
      spatialDimension,
      props.display,
      props.indices,
      props.settled,
      availablePlot.width,
      availablePlot.height,
    ],
  );

  useEffect(() => () => loader.current.dispose(), []);

  useEffect(() => {
    if (needsConfirmation) {
      setLoading(false);
      return;
    }
    setLoading(true);
    canvas.current?.removeAttribute("data-rendered");
    loader.current.request({
      request,
      accept: (nextSlice) => {
        setSlice(nextSlice);
        setLoading(false);
        setError(undefined);
        props.onFrameLoaded();
        props.onStatus(
          `${nextSlice.shape.join(" × ")} · ${hint.kind}${hint.kind === "ugrid2d" ? ` ${hint.location}` : ""} · ${nextSlice.dtype}`,
        );
      },
      reject: (nextError) => {
        setLoading(false);
        setError(nextError.message);
        props.onFrameError?.();
        props.onStatus(nextError.message);
      },
    });
  }, [
    needsConfirmation,
    request.dataset,
    request.path,
    request.selection,
    request.stride,
    hint.kind,
    hint.kind === "ugrid2d" ? hint.location : "",
    props.onFrameLoaded,
    props.onFrameError,
    props.onStatus,
  ]);

  const sliceShape = slice?.shape.join(",") ?? "";
  useEffect(() => {
    let active = true;
    if (needsConfirmation || !slice) return;
    buildGeometry(props.metadata, props.variable, props.display, slice)
      .then((nextGeometry) => {
        if (!active) return;
        setGeometry(nextGeometry);
        setView((current) => current ?? props.initialView ?? nextGeometry.bounds);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        props.onFrameError?.();
        props.onStatus(message);
      });
    return () => {
      active = false;
    };
  }, [
    needsConfirmation,
    props.metadata,
    props.variable,
    props.display,
    request.stride,
    sliceShape,
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
    if (!rendererReady || !renderer.current || !geometry || !view || !values) return;
    renderer.current.draw(geometry, values, {
      colormap: props.colormap,
      scale: props.scale,
      range: activeRange,
      view,
      width: plot.width,
      height: plot.height,
    });
    canvas.current?.setAttribute("data-rendered", "true");
  }, [rendererReady, geometry, values, view, props.colormap, props.scale, activeRange, plot.width, plot.height]);

  useEffect(() => {
    const node = frame.current;
    const surface = renderer.current;
    if (!node || !rendererReady || !surface || !geometry || !view || !values) return;
    return registerPlotCapture(node, async (width, height) => {
      let exportGeometry = geometry;
      let exportValues = values;
      if (hint.kind === "curvilinear") {
        const exportSlice = await fetchSlice(fieldRequest(
          props.variable,
          props.display,
          props.indices,
          { width, height },
          true,
        ));
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
      return surface.capture(
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
    if (!geometry || !view || !values) return undefined;
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
          metadata={props.metadata} variable={props.variable} wind={props.wind} pressure={props.pressure}
          indices={props.indices} bounds={view} plot={plot} labelSize={type.tick} geometry={geometry}
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
          label={quantityLabel(props.variable)}
        />
        <FieldMarks plot={plot} dragBox={dragBox} probe={
          probePosition && Number.isFinite(probePosition.x) && Number.isFinite(probePosition.y)
            ? probePosition : undefined
        } />
      </svg>
      {geometry && (
        <FieldControls overlays={props.overlays} onReserve={setReserve}
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
          <strong>{formatNumber(hover.value)} {displayUnit(props.variable)}</strong>
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
      {loading && <span className="plot-loading">reading newest mesh field…</span>}
      {error && <div className="plot-error">{error}</div>}
    </div>
  );
}

async function buildGeometry(
  metadata: Metadata,
  variable: Variable,
  display: DisplayDimensions,
  slice: DataSlice,
): Promise<FieldGeometry> {
  const hint = variable.view_hint;
  if (hint.kind === "curvilinear") {
    const xVariable = requiredVariable(metadata, hint.x);
    const yVariable = requiredVariable(metadata, hint.y);
    const { x: displayX, y: displayY } = display;
    if (
      displayY === undefined ||
      displayX === undefined ||
      xVariable.dimensions.length !== 2 ||
      xVariable.dimensions[0].path !== variable.dimensions[displayY]?.path ||
      xVariable.dimensions[1].path !== variable.dimensions[displayX]?.path ||
      yVariable.dimensions.map((dimension) => dimension.path).join("|") !==
        xVariable.dimensions.map((dimension) => dimension.path).join("|")
    ) {
      throw new Error("selected display dimensions do not match the curvilinear coordinates");
    }
    const [xValues, yValues] = await Promise.all([
      fetchCoordinate(xVariable),
      fetchCoordinate(yVariable),
    ]);
    const coordinateShape = xVariable.dimensions.map((dimension) => dimension.length);
    if (
      coordinateShape.length !== 2 ||
      xValues.length !== coordinateShape[0] * coordinateShape[1] ||
      yValues.length !== xValues.length ||
      slice.shape.length !== 2
    ) {
      throw new Error("curvilinear coordinates and field must be two-dimensional");
    }
    const strides = slice.request.stride.split(",").map(Number);
    const geometry = measurePerformance(PERFORMANCE_MEASURE.meshGeometry, () =>
      buildCurvilinearGeometry(
        xValues,
        yValues,
        coordinateShape[0],
        coordinateShape[1],
        slice.shape[0],
        slice.shape[1],
        strides[displayY],
        strides[displayX],
      ));
    return addGeographicCoordinates(
      metadata,
      variable,
      xVariable,
      yVariable,
      xValues,
      yValues,
      geometry,
    );
  }

  if (hint.kind === "ugrid2d") {
    const xVariable = requiredVariable(metadata, hint.x);
    const yVariable = requiredVariable(metadata, hint.y);
    const connectivityVariable = requiredVariable(metadata, hint.face_node_connectivity);
    const [xValues, yValues, connectivitySlice] = await Promise.all([
      fetchCoordinate(xVariable),
      fetchCoordinate(yVariable),
      fetchStaticSlice(connectivityVariable),
    ]);
    if (
      xVariable.dimensions.length !== 1 ||
      yVariable.dimensions.length !== 1 ||
      xValues.length !== xVariable.dimensions[0].length ||
      yValues.length !== xValues.length ||
      !(connectivitySlice.values instanceof Int32Array || connectivitySlice.values instanceof Uint32Array) ||
      connectivitySlice.shape.length !== 2
    ) {
      throw new Error("UGRID requires one-dimensional node coordinates and padded 2-D connectivity");
    }
    const connectivity = connectivitySlice.values;
    const geometry = measurePerformance(PERFORMANCE_MEASURE.meshGeometry, () =>
      buildUgridGeometry(
        xValues,
        yValues,
        connectivity,
        connectivitySlice.shape[0],
        connectivitySlice.shape[1],
        attributeNumber(connectivityVariable, "start_index") ?? 0,
        [
          ...attributeNumbers(connectivityVariable, "_FillValue"),
          ...attributeNumbers(connectivityVariable, "missing_value"),
        ],
        hint.location === "node" ? "node" : "face",
      ));
    const projected = await addGeographicCoordinates(
      metadata,
      variable,
      xVariable,
      yVariable,
      xValues,
      yValues,
      geometry,
    );
    if (hint.location !== "edge") return projected;
    const topology = requiredVariable(metadata, hint.mesh);
    const reference = attributeText(topology, "edge_face_connectivity");
    if (!reference) throw new Error("UGRID edge data requires edge_face_connectivity");
    const edgeFacesVariable = requiredVariable(
      metadata,
      resolveVariableReference(topology.path, reference),
    );
    const edgeFaces = await fetchStaticSlice(edgeFacesVariable);
    const edgeDimension = attributeText(topology, "edge_dimension");
    const edgeAxis = edgeDimension
      ? edgeFacesVariable.dimensions.findIndex((dimension) => dimension.name === edgeDimension)
      : 0;
    if (
      !(edgeFaces.values instanceof Int32Array || edgeFaces.values instanceof Uint32Array) ||
      edgeFaces.shape.length !== 2 ||
      edgeAxis < 0 ||
      edgeFaces.shape[edgeAxis] !== slice.values.length ||
      edgeFaces.shape[1 - edgeAxis] !== 2
    ) {
      throw new Error("UGRID edge-face connectivity must be edge × 2");
    }
    const startIndex = attributeNumber(edgeFacesVariable, "start_index") ?? 0;
    if (startIndex !== 0 && startIndex !== 1) throw new Error("UGRID start_index must be 0 or 1");
    const padding = new Set([
      ...attributeNumbers(edgeFacesVariable, "_FillValue"),
      ...attributeNumbers(edgeFacesVariable, "missing_value"),
    ]);
    const normalized = new Int32Array(edgeFaces.values.length);
    for (let index = 0; index < normalized.length; index += 1) {
      const edge = index >> 1;
      const side = index & 1;
      const source = edgeAxis === 0 ? index : side * slice.values.length + edge;
      const packed = Number(edgeFaces.values[source]);
      const face = packed - startIndex;
      if (padding.has(packed)) normalized[index] = -1;
      else if (!Number.isSafeInteger(face) || face < 0 || face >= connectivitySlice.shape[0]) {
        throw new Error(`UGRID edge refers to invalid face ${packed}`);
      } else normalized[index] = face;
      if (side === 1 && normalized[index] >= 0 && normalized[index] === normalized[index - 1]) {
        throw new Error(`UGRID edge ${edge} refers to the same face twice`);
      }
    }
    return {
      ...projected,
      edgeFaces: normalized,
    };
  }
  throw new Error("variable is not a mesh field");
}

function probeFromHit(
  variable: Variable,
  display: DisplayDimensions,
  indices: Record<string, number>,
  slice: DataSlice,
  hit: MeshHit,
  value: number,
): Probe {
  const nextIndices = { ...indices };
  if (variable.view_hint.kind === "ugrid2d" && variable.view_hint.location !== "edge") {
    const dimension = variable.dimensions[display.x ?? variable.dimensions.length - 1];
    if (dimension) nextIndices[dimension.path] = hit.scalarIndex;
  } else if (display.x !== undefined && display.y !== undefined && slice.shape.length === 2) {
    const columns = slice.shape[1];
    const row = Math.floor(hit.scalarIndex / columns);
    const column = hit.scalarIndex % columns;
    const strides = slice.request.stride.split(",").map(Number);
    nextIndices[variable.dimensions[display.x].path] = column * strides[display.x];
    nextIndices[variable.dimensions[display.y].path] = row * strides[display.y];
  }
  return {
    indices: nextIndices,
    x: hit.x,
    y: hit.y,
    value,
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

async function addGeographicCoordinates(
  metadata: Metadata,
  variable: Variable,
  xVariable: Variable,
  yVariable: Variable,
  xValues: Float64Array,
  yValues: Float64Array,
  geometry: MeshGeometry,
): Promise<MeshGeometry> {
  const coordinates = geographicCoordinateVariables(metadata, variable, xVariable.dimensions);
  if (!coordinates) return geometry;
  const coordinateValues = (coordinate: Variable) =>
    coordinate.path === xVariable.path
      ? Promise.resolve(xValues)
      : coordinate.path === yVariable.path
        ? Promise.resolve(yValues)
        : fetchCoordinate(coordinate);
  const [longitude, latitude] = await Promise.all([
    coordinateValues(coordinates.longitude),
    coordinateValues(coordinates.latitude),
  ]);
  if (longitude.length !== xValues.length || latitude.length !== xValues.length) {
    throw new Error("geographic node coordinates do not match the rendered mesh coordinates");
  }
  return { ...geometry, longitude, latitude };
}

function meshAxisLabels(metadata: Metadata, variable: Variable): { x: string; y: string } {
  const hint = variable.view_hint;
  if (hint.kind !== "curvilinear" && hint.kind !== "ugrid2d") return { x: "x", y: "y" };
  const x = requiredVariable(metadata, hint.x);
  const y = requiredVariable(metadata, hint.y);
  return { x: `${x.name} (${displayUnit(x)})`, y: `${y.name} (${displayUnit(y)})` };
}

function requiredVariable(metadata: Metadata, path: string): Variable {
  const variable = metadata.variables.find((candidate) => candidate.path === path);
  if (!variable) throw new Error(`metadata has no variable ${path}`);
  return variable;
}
