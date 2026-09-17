import { PROTOCOL_VERSION, type DatasetsResponse, type MetadataResponse, type ViewHint } from "../generated/protocol.ts";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ncx metadata");
  return value as ObjectValue;
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("Invalid ncx text");
}
function size(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid ncx dimension");
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid ncx list");
  return value;
}
function flag(value: unknown) {
  if (typeof value !== "boolean") throw new Error("Invalid ncx flag");
}
function version(value: ObjectValue) {
  if (value.protocol_version !== PROTOCOL_VERSION) throw new Error(`Unsupported ncx protocol ${String(value.protocol_version)}`);
}
function attributes(value: unknown) {
  for (const entry of array(value)) {
    const attribute = object(entry);
    text(attribute.name); text(attribute.dtype);
    const values = Array.isArray(attribute.value) ? attribute.value : [attribute.value];
    if (values.some(item => typeof item !== "string" && typeof item !== "number" && item !== null)) throw new Error("Invalid ncx attribute");
    if (attribute.truncated !== undefined) flag(attribute.truncated);
  }
}
function dimensions(value: unknown) {
  for (const entry of array(value)) {
    const dimension = object(entry);
    text(dimension.path); text(dimension.name); size(dimension.length);
  }
}
const hintFields: Record<ViewHint["kind"], string[]> = {
  plain: [], rectilinear: ["x", "y"], curvilinear: ["x", "y"],
  ugrid2d: ["mesh", "x", "y", "face_node_connectivity", "location"],
};

export function decodeMetadata(value: unknown): MetadataResponse {
  const metadata = object(value);
  version(metadata);
  text(object(metadata.dataset).name);
  for (const key of ["dataset_id", "dataset_label", "default_variable"]) {
    if (metadata[key] !== null && metadata[key] !== undefined) text(metadata[key]);
  }
  const limits = object(metadata.limits);
  size(limits.max_response_bytes); size(limits.ugrid_warn_faces);
  dimensions(metadata.dimensions);
  for (const entry of array(metadata.dimensions)) flag(object(entry).unlimited);
  for (const entry of array(metadata.groups)) {
    const group = object(entry);
    text(group.path); text(group.name); attributes(group.attributes);
  }
  array(metadata.warnings).forEach(text);
  for (const entry of array(metadata.variables)) {
    const variable = object(entry);
    text(variable.path); text(variable.name); text(variable.dtype);
    dimensions(variable.dimensions); attributes(variable.attributes);
    const hint = object(variable.view_hint);
    if (typeof hint.kind !== "string" || !Object.hasOwn(hintFields, hint.kind)) throw new Error("Unsupported ncx view kind");
    hintFields[hint.kind as ViewHint["kind"]].forEach(key => text(hint[key]));
    if (hint.kind === "ugrid2d" && !["node", "edge", "face"].includes(String(hint.location))) throw new Error("Unsupported ncx mesh location");
    const caps = object(variable.capabilities);
    for (const key of ["numeric", "coordinate", "mesh_geometry", "time_axis", "geographic"]) flag(caps[key]);
    text(caps.calendar);
    if (caps.geographic_axis !== null && !["longitude", "latitude"].includes(String(caps.geographic_axis))) throw new Error("Unsupported ncx coordinate axis");
    for (const key of ["display_x", "display_y"]) {
      if (caps[key] !== null) {
        size(caps[key]);
        if ((caps[key] as number) >= array(variable.dimensions).length) throw new Error("Invalid ncx display dimension");
      }
    }
    if (caps.edge_dimension !== null) text(caps.edge_dimension);
    for (const references of Object.values(object(caps.references))) array(references).forEach(text);
    for (const entry of array(caps.geographic_coordinates)) {
      const geo = object(entry);
      array(geo.dimensions).forEach(text);
      text(geo.longitude); text(geo.latitude);
    }
    if (caps.time !== null) {
      const time = object(caps.time);
      for (const key of ["multiplier_ms", "origin_ms", "offset_minutes"]) {
        if (typeof time[key] !== "number" || !Number.isFinite(time[key])) throw new Error("Invalid ncx time axis");
      }
      if ((time.multiplier_ms as number) <= 0) throw new Error("Invalid ncx time scale");
    }
  }
  return metadata as MetadataResponse;
}

export function decodeDatasets(value: unknown): DatasetsResponse {
  const response = object(value);
  version(response); flag(response.collection);
  const datasets = array(response.datasets);
  if (!datasets.length) throw new Error("ncx returned no datasets");
  for (const entry of datasets) {
    const dataset = object(entry);
    text(dataset.id); text(dataset.label);
    if (dataset.state === "ready") {
      text(dataset.name);
      for (const key of ["variables", "dimensions", "warnings"]) size(dataset[key]);
    } else if (dataset.state === "unavailable") text(dataset.error);
    else if (dataset.state !== "uninspected") throw new Error("Unsupported ncx dataset state");
  }
  return response as DatasetsResponse;
}
