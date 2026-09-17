import data from "../src/generated/metadata-fixtures.json" with { type: "json" };
import type { VariableCapabilities } from "../src/generated/protocol.ts";
import type { Metadata } from "../src/data/model.ts";

export function metadataFixture(name: keyof typeof data): Metadata {
  return structuredClone(data[name]) as Metadata;
}

export function capabilities(overrides: Partial<VariableCapabilities> = {}): VariableCapabilities {
  return { ...structuredClone(data.classic.variables.find(variable => variable.name === "value")!.capabilities), ...overrides };
}
