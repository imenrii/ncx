import { fetchStaticSlice } from "../data/api.ts";
import { attributeNumber, attributeNumbers, type DataSlice, type Metadata, type Probe, type Variable } from "../data/model.ts";
import type { DisplayDimensions } from "../data/selection.ts";
import { PERFORMANCE_MEASURE, measurePerformanceAsync } from "../data/performance.ts";
import { buildRectilinearAxis } from "./rectilinear.ts";
import { prepareMesh } from "./meshBuild.ts";
import type { MeshGeometry, MeshHit } from "./mesh.ts";
import { geographicCoordinateVariables } from "./projection.ts";

type StaticReader = typeof fetchStaticSlice;

async function coordinateValues(variable: Variable, read: StaticReader): Promise<Float64Array> {
  const slice = await read(variable, "f64");
  if (!(slice.values instanceof Float64Array)) throw new Error(`${variable.path} is not an f64 coordinate`);
  return slice.values;
}

export type FieldGeometry = MeshGeometry & { edgeFaces?: Int32Array };

export async function loadRectilinearAxis(metadata: Metadata, variable: Variable, read: StaticReader = fetchStaticSlice) {
  const values = await coordinateValues(variable, read);
  const boundsReference = variable.capabilities.references.bounds?.[0];
  if (!boundsReference) {
    const result = buildRectilinearAxis(values);
    return { values, ...result };
  }

  const boundsPath = boundsReference;
  const boundsVariable = metadata.variables.find((candidate) => candidate.path === boundsPath);
  if (!boundsVariable) {
    const result = buildRectilinearAxis(values);
    return {
      values,
      ...result,
      warning: `${variable.path} bounds variable ${boundsPath} is missing; using midpoint edges`,
    };
  }

  try {
    const bounds = await read(boundsVariable, "f64");
    if (!(bounds.values instanceof Float64Array)) {
      throw new Error(`${boundsPath} is not numeric`);
    }
    const result = buildRectilinearAxis(values, { values: bounds.values, shape: bounds.shape });
    return {
      values,
      ...result,
      warning: result.warning ? `${variable.path}: ${result.warning}` : undefined,
    };
  } catch (cause: unknown) {
    const result = buildRectilinearAxis(values);
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      values,
      ...result,
      warning: `${variable.path} bounds are unavailable (${message}); using midpoint edges`,
    };
  }
}

export async function buildGeometry(
  metadata: Metadata,
  variable: Variable,
  display: DisplayDimensions,
  slice: DataSlice,
  signal?: AbortSignal,
  read: StaticReader = fetchStaticSlice,
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
      coordinateValues(xVariable, read),
      coordinateValues(yVariable, read),
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
    const strides = slice.request.selection.map(axis => typeof axis === "number" ? 1 : axis.stride);
    const geometry = await measurePerformanceAsync(PERFORMANCE_MEASURE.meshGeometry, () =>
      prepareMesh({ kind: "curvilinear", args: [
        xValues,
        yValues,
        coordinateShape[0],
        coordinateShape[1],
        slice.shape[0],
        slice.shape[1],
        strides[displayY],
        strides[displayX],
      ] }, signal));
    return addGeographicCoordinates(
      metadata,
      variable,
      xVariable,
      yVariable,
      xValues,
      yValues,
      geometry,
      read,
    );
  }

  if (hint.kind === "ugrid2d") {
    const xVariable = requiredVariable(metadata, hint.x);
    const yVariable = requiredVariable(metadata, hint.y);
    const connectivityVariable = requiredVariable(metadata, hint.face_node_connectivity);
    const [xValues, yValues, connectivitySlice] = await Promise.all([
      coordinateValues(xVariable, read),
      coordinateValues(yVariable, read),
      read(connectivityVariable),
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
    const geometry = await measurePerformanceAsync(PERFORMANCE_MEASURE.meshGeometry, () =>
      prepareMesh({ kind: "ugrid", args: [
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
      ] }, signal));
    const projected = await addGeographicCoordinates(
      metadata,
      variable,
      xVariable,
      yVariable,
      xValues,
      yValues,
      geometry,
      read,
    );
    if (hint.location !== "edge") return projected;
    const topology = requiredVariable(metadata, hint.mesh);
    const reference = topology.capabilities.references.edge_face_connectivity?.[0];
    if (!reference) throw new Error("UGRID edge data requires edge_face_connectivity");
    const edgeFacesVariable = requiredVariable(
      metadata,
      reference,
    );
    const edgeFaces = await read(edgeFacesVariable);
    const edgeDimension = topology.capabilities.edge_dimension;
    const edgeAxis = edgeDimension
      ? edgeFacesVariable.dimensions.findIndex((dimension) => dimension.name === edgeDimension)
      : 0;
    if (
      !(edgeFaces.values instanceof Int32Array || edgeFaces.values instanceof Uint32Array) ||
      edgeFaces.shape.length !== 2 ||
      edgeAxis < 0 ||
      edgeFaces.shape[edgeAxis] !== slice.shape[0] ||
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
      const source = edgeAxis === 0 ? index : side * slice.shape[0] + edge;
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

export function probeFromHit(
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
    const strides = slice.request.selection.map(axis => typeof axis === "number" ? 1 : axis.stride);
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
  read: StaticReader,
): Promise<MeshGeometry> {
  const coordinates = geographicCoordinateVariables(metadata, variable, xVariable.dimensions);
  if (!coordinates) return geometry;
  const readGeographic = (coordinate: Variable) =>
    coordinate.path === xVariable.path
      ? Promise.resolve(xValues)
      : coordinate.path === yVariable.path
        ? Promise.resolve(yValues)
        : coordinateValues(coordinate, read);
  const [longitude, latitude] = await Promise.all([
    readGeographic(coordinates.longitude),
    readGeographic(coordinates.latitude),
  ]);
  if (longitude.length !== xValues.length || latitude.length !== xValues.length) {
    throw new Error("geographic node coordinates do not match the rendered mesh coordinates");
  }
  return { ...geometry, longitude, latitude };
}


export function requiredVariable(metadata: Metadata, path: string): Variable {
  const variable = metadata.variables.find((candidate) => candidate.path === path);
  if (!variable) throw new Error(`metadata has no variable ${path}`);
  return variable;
}
