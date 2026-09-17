import assert from "node:assert/strict";
import test from "node:test";
import { metadataFixture } from "../../tests/fixtures.ts";
import { decodeDatasets, decodeMetadata } from "./protocol.ts";
import { PROTOCOL_VERSION } from "../generated/protocol.ts";

test("Rust manifests cross the runtime decoder with canonical grouped references", () => {
  const metadata = decodeMetadata(metadataFixture("grouped_ugrid"));
  const field = metadata.variables.find(variable => variable.path === "/ocean/state/temp")!;
  assert.deepEqual(field.capabilities.references.coordinates, ["/ocean/lon", "/ocean/lat"]);
  assert.equal(field.capabilities.geographic_coordinates[0]?.longitude, "/ocean/lon");
  assert.equal(decodeMetadata(metadataFixture("rectilinear")).variables[0].capabilities.time?.multiplier_ms, 3600000);
});

test("unknown versions, enum variants and invalid dimensions fail before use", () => {
  const metadata = metadataFixture("rectilinear");
  assert.throws(() => decodeMetadata({ ...metadata, protocol_version: PROTOCOL_VERSION + 1 }), /protocol/);
  assert.throws(() => decodeMetadata({ ...metadata, variables: [{ ...metadata.variables[0], view_hint: { kind: "other" } }] }), /kind/);
  assert.throws(() => decodeMetadata({ ...metadata, dimensions: [{ path: "/x", name: "x", length: -1, unlimited: false }] }), /dimension/);
  assert.throws(() => decodeDatasets({ protocol_version: PROTOCOL_VERSION, collection: false, datasets: [{ id: "a", label: "A", state: "other" }] }), /state/);
});
