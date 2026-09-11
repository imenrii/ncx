import { attributeText, type Metadata } from "./model.ts";
import { UNIT_FAMILIES, unitRule } from "./units.ts";

/** Unit choices are local to a viewer identity, not the shared raw metadata cache. */
export function createUnitAssignments() {
  const assignments = new Map<string, Map<string, string>>();
  const origins = new WeakMap<Metadata, { raw: Metadata; scope: string }>();
  const cache = new WeakMap<Metadata, { revision: number; scope: string; metadata: Metadata }>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const original = (metadata: Metadata) => origins.get(metadata)?.raw ?? metadata;
  const key = (metadata: Metadata, scope: string) => JSON.stringify([scope, metadata.dataset_id]);

  return {
    original,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => revision,
    apply(metadata: Metadata, scope?: string): Metadata {
      const origin = { raw: original(metadata), scope: scope ?? origins.get(metadata)?.scope ?? "" };
      const { raw } = origin;
      const cached = cache.get(raw);
      if (cached?.revision === revision && cached.scope === origin.scope) return cached.metadata;
      const values = assignments.get(key(raw, origin.scope));
      const effective = { ...raw, variables: raw.variables.map(variable => {
        const unit = values?.get(variable.path);
        if (!unit || attributeText(variable, "units")?.trim()) return variable;
        return { ...variable, attributes: [
          ...variable.attributes.filter(attribute => attribute.name !== "units"),
          { name: "units", dtype: "char", value: unit },
        ] };
      }) };
      origins.set(raw, origin);
      origins.set(effective, origin);
      cache.set(raw, { revision, scope: origin.scope, metadata: effective });
      return effective;
    },
    assign(metadata: Metadata, path: string, unit: string) {
      const raw = original(metadata);
      const variable = raw.variables.find(item => item.path === path);
      if (!variable) throw new Error("Variable not found");
      if (attributeText(variable, "units")?.trim()) throw new Error("The file provides this unit");
      const family = unitRule(variable).rule?.family;
      const choices = family ? UNIT_FAMILIES[family] : Object.values(UNIT_FAMILIES).flat();
      if (unit && !choices.some(choice => choice.id === unit)) throw new Error("Unsupported unit for this quantity");
      const scope = origins.get(metadata)?.scope ?? "";
      const datasetKey = key(raw, scope);
      const values = new Map(assignments.get(datasetKey));
      const group = path.slice(0, path.lastIndexOf("/") + 1);
      const twin = variable.name === "u10" ? `${group}v10` : variable.name === "v10" ? `${group}u10` : undefined;
      for (const item of raw.variables) {
        if (item.path !== path && item.path !== twin || attributeText(item, "units")?.trim()) continue;
        if (unit) values.set(item.path, unit);
        else values.delete(item.path);
      }
      assignments.set(datasetKey, values);
      revision += 1;
      listeners.forEach(listener => listener());
    },
  };
}

export const unitAssignments = createUnitAssignments();
