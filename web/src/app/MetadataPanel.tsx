import { attributeText, type Attribute, type Metadata, type Variable } from "../data/model";
import { UNIT_FAMILIES, unitRule } from "../data/units";
import { unitAssignments } from "../data/unitAssignments";

const familyLabels: Record<keyof typeof UNIT_FAMILIES, string> = {
  pressure: "Pressure", velocity: "Velocity", temperature: "Temperature",
  length: "Length", water: "Water-equivalent depth", fraction: "Fraction",
  period: "Period", angle: "Angle", energy: "Energy per area",
  flux: "Flux", specificEnergy: "Specific energy",
};

export function MetadataPanel({ metadata, variable }: { metadata: Metadata; variable: Variable }) {
  const raw = unitAssignments.original(metadata).variables.find(item => item.path === variable.path)!;
  const fileUnit = attributeText(raw, "units");
  const family = unitRule(raw).rule?.family;
  const bound = variable.value_kind !== undefined;
  return (
    <div className="metadata-panel">
      <section>
        <h2>{bound ? variable.name : variable.path}</h2>
        <dl className="metadata-summary">
          <div><dt>{bound ? "data type" : "stored type"}</dt><dd>{variable.dtype}</dd></div>
          <div>
            <dt>shape</dt>
            <dd>{variable.dimensions.map((dimension) => `${dimension.name}=${dimension.length}`).join(" × ") || "scalar"}</dd>
          </div>
          <div><dt>view hint</dt><dd>{variable.view_hint.kind}</dd></div>
          <div className="metadata-unit">
            <dt>{fileUnit?.trim() || bound ? "Units" : <label htmlFor="metadata-unit">Units</label>}</dt>
            <dd>{fileUnit?.trim() ? fileUnit : bound ? "Unspecified" : <select
              id="metadata-unit"
              value={attributeText(variable, "units")?.trim() ?? ""}
              onChange={event => unitAssignments.assign(metadata, variable.path, event.currentTarget.value)}
            >
              <option value="">Not specified</option>
              {Object.entries(UNIT_FAMILIES).filter(([name]) => !family || name === family).map(([name, units]) => (
                <optgroup key={name} label={familyLabels[name as keyof typeof UNIT_FAMILIES]}>
                  {units.map(unit => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
                </optgroup>
              ))}
            </select>}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Dimensions</h3>
        <table>
          <thead><tr><th>Name</th><th>Length</th><th>Scope</th></tr></thead>
          <tbody>
            {variable.dimensions.map((dimension) => {
              const discovered = metadata.dimensions.find((candidate) => candidate.path === dimension.path);
              return (
                <tr key={dimension.path}>
                  <th>{dimension.name}</th>
                  <td className="dimension-length">{dimension.length.toLocaleString()}</td>
                  <td>{dimension.path}{discovered?.unlimited ? " · unlimited" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Attributes</h3>
        {raw.attributes.length ? (
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead>
            <tbody>{raw.attributes.map((attribute) => <AttributeRow key={attribute.name} attribute={attribute} />)}</tbody>
          </table>
        ) : <p className="empty-note">No variable attributes.</p>}
      </section>
    </div>
  );
}

function AttributeRow({ attribute }: { attribute: Attribute }) {
  const value = Array.isArray(attribute.value)
    ? attribute.value.map(formatAttributeValue).join(", ")
    : formatAttributeValue(attribute.value);
  const typography = typeof attribute.value === "number" ? "number"
    : typeof attribute.value === "string" && ["long_name", "description", "comment", "title", "summary"].includes(attribute.name)
      ? "read" : "literal";
  return (
    <tr>
      <th>{attribute.name}</th>
      <td>{attribute.dtype}</td>
      <td className="attribute-value" data-typography={typography}>{value}{attribute.truncated ? " …" : ""}</td>
    </tr>
  );
}

function formatAttributeValue(value: number | string): string {
  return typeof value === "string" ? value : String(value);
}
