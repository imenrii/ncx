import { attributeText, variableLabel, type Variable } from "./model.ts";

export interface Unit {
  id: string;
  label: string;
  scale: number;
  offset: number;
  aliases: string[];
}
const unit = (id: string, scale = 1, offset = 0, aliases: string[] = [], label = id): Unit =>
  ({ id, label, scale, offset, aliases: [id, ...aliases] });

export const UNIT_FAMILIES = {
  pressure: [unit("Pa", 1, 0, ["pascal", "pascals"]), unit("hPa", 100), unit("mb", 100, 0, ["mbar", "millibar"]), unit("kPa", 1000), unit("atm", 101325), unit("psi", 6894.757293168)],
  velocity: [unit("m/s", 1, 0, ["m s-1", "m s^-1", "m s**-1", "ms-1"], "m s⁻¹"), unit("km/h", 1 / 3.6, 0, ["km h-1", "km h^-1", "kmh-1"], "km h⁻¹"), unit("mph", 0.44704), unit("kt", 1852 / 3600, 0, ["knot", "knots"])],
  temperature: [unit("K", 1, 0, ["kelvin"]), unit("°C", 1, 273.15, ["degC", "degree_Celsius", "degrees_Celsius", "Celsius"]), unit("°F", 5 / 9, 255.3722222222222, ["degF", "degree_Fahrenheit", "Fahrenheit"])],
  length: [unit("m", 1, 0, ["metre", "meter", "metres", "meters"]), unit("km", 1000), unit("ft", 0.3048, 0, ["feet", "foot"])],
  water: [unit("m"), unit("mm", 0.001), unit("in", 0.0254)],
  fraction: [unit("1", 1, 0, ["fraction", "(0 - 1)"]), unit("%", 0.01, 0, ["percent"])],
  period: [unit("s", 1, 0, ["second", "seconds"]), unit("min", 60, 0, ["minute", "minutes"])],
  angle: [unit("degrees", Math.PI / 180, 0, ["degree", "deg"]), unit("rad", 1, 0, ["radian", "radians"])],
  energy: [unit("J/m2", 1, 0, ["J m-2", "J m**-2", "J m^-2"], "J m⁻²"), unit("kJ/m2", 1000, 0, ["kJ m-2"], "kJ m⁻²"), unit("MJ/m2", 1e6, 0, ["MJ m-2"], "MJ m⁻²")],
  flux: [unit("W/m2", 1, 0, ["W m-2", "W m**-2", "W m^-2"], "W m⁻²"), unit("kW/m2", 1000, 0, ["kW m-2"], "kW m⁻²")],
  specificEnergy: [unit("J/kg", 1, 0, ["J kg-1", "J kg**-1", "J kg^-1"], "J kg⁻¹"), unit("kJ/kg", 1000, 0, ["kJ kg-1"], "kJ kg⁻¹")],
} satisfies Record<string, Unit[]>;

interface QuantityRule {
  names: string[];
  standardNames: string[];
  family: keyof typeof UNIT_FAMILIES;
  beaufort?: boolean;
}
// ERA5 aliases: https://ecmwf-models.readthedocs.io/en/latest/variables_era5.html
// Append exact aliases here. File units must still agree with the quantity.
export const QUANTITY_RULES: QuantityRule[] = [
  { names: ["msl", "sp"], standardNames: ["air_pressure_at_mean_sea_level", "surface_air_pressure", "air_pressure"], family: "pressure" },
  { names: ["u10", "v10", "u100", "v100", "u10n", "v10n", "u", "v", "w10"], standardNames: ["eastward_wind", "northward_wind", "upward_air_velocity"], family: "velocity" },
  { names: ["si10"], standardNames: ["wind_speed"], family: "velocity", beaufort: true },
  { names: ["fg10", "i10fg"], standardNames: ["wind_speed_of_gust"], family: "velocity" },
  { names: ["t2m", "d2m", "skt", "sst", "mx2t", "mn2t", "stl1", "stl2", "stl3", "stl4", "istl1", "istl2", "istl3", "istl4", "tsn", "t"], standardNames: ["air_temperature", "dew_point_temperature", "surface_temperature", "sea_surface_temperature", "soil_temperature"], family: "temperature" },
  { names: ["tp", "cp", "lsp", "sf", "sd", "ro", "sro", "ssro", "e", "pev"], standardNames: ["lwe_thickness_of_precipitation_amount", "lwe_thickness_of_snowfall_amount", "lwe_thickness_of_surface_snow_amount"], family: "water" },
  { names: ["blh", "cbh", "deg0l", "dl", "licd", "lmld", "swh", "shts", "shww", "hmax"], standardNames: ["atmosphere_boundary_layer_thickness", "cloud_base_altitude", "sea_surface_wave_significant_height"], family: "length" },
  { names: ["tcc", "hcc", "mcc", "lcc", "siconc", "cvh", "cvl", "cl"], standardNames: ["cloud_area_fraction", "sea_ice_area_fraction"], family: "fraction" },
  { names: ["mwp", "mpts", "mpww", "pp1d", "mp1", "mp2"], standardNames: ["sea_surface_wave_mean_period", "sea_surface_wave_period_at_variance_spectral_density_maximum"], family: "period" },
  { names: ["mwd", "mdts", "mdww"], standardNames: ["sea_surface_wave_from_direction"], family: "angle" },
  { names: ["ssrd", "ssr", "strd", "str", "ssrc", "strc", "slhf", "sshf", "tisr", "tsr", "ttr"], standardNames: [], family: "energy" },
  { names: ["msdwswrf", "msdwlwrf", "msnswrf", "msnlwrf", "mslhf", "msshf"], standardNames: ["surface_downwelling_shortwave_flux_in_air", "surface_downwelling_longwave_flux_in_air", "surface_upward_latent_heat_flux", "surface_upward_sensible_heat_flux"], family: "flux" },
  { names: ["cape", "cin"], standardNames: ["atmosphere_convective_available_potential_energy", "atmosphere_convective_inhibition"], family: "specificEnergy" },
];

const normalized = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
export function findUnit(family: keyof typeof UNIT_FAMILIES, text: string): Unit | undefined {
  return UNIT_FAMILIES[family].find(unit => unit.aliases.some(alias => normalized(alias) === normalized(text)));
}
export interface UnitChoice {
  source?: Unit;
  choices: Unit[];
  beaufort: boolean;
  reason?: string;
}
export function unitRule(variable: Variable): { rule?: QuantityRule; reason?: string } {
  const standard = attributeText(variable, "standard_name")?.trim();
  const byName = QUANTITY_RULES.find(rule => rule.names.includes(variable.name));
  const byStandard = QUANTITY_RULES.find(rule => standard && rule.standardNames.includes(standard));
  // A conflicting CF quantity must not be overridden by a familiar short name.
  if (standard && byName && (!byStandard || byStandard.family !== byName.family ||
    byName.beaufort !== byStandard.beaufort && byStandard.family === "velocity")) {
    return { reason: "Variable name and standard name disagree" };
  }
  return { rule: byStandard ?? byName };
}

export function unitChoice(variable: Variable): UnitChoice {
  if (variable.value_kind) {
    const text = attributeText(variable, "units") ?? "";
    const family = (Object.keys(UNIT_FAMILIES) as (keyof typeof UNIT_FAMILIES)[]).find(family => findUnit(family, text));
    return family ? { source: findUnit(family, text), choices: UNIT_FAMILIES[family], beaufort: false }
      : { choices: [], beaufort: false, reason: "No conversion for this unit" };
  }
  const { rule, reason } = unitRule(variable);
  if (reason) return { choices: [], beaufort: false, reason };
  const units = attributeText(variable, "units") ?? "";
  const source = rule && findUnit(rule.family, units);
  if (!rule || !source) return { choices: [], beaufort: false, reason: "No conversion rule for this quantity and unit" };
  // Beaufort describes 10 m wind; an unspecified-height wind_speed is not enough.
  const beaufort = Boolean(rule.beaufort && (variable.name === "si10" || attributeText(variable, "height") === "10 m"));
  return { source, choices: UNIT_FAMILIES[rule.family], beaufort };
}

export function convert(value: number, source: Unit, target: Unit, difference = false): number {
  if (!Number.isFinite(value)) return NaN;
  if (source.id === target.id) return value;
  return (value * source.scale + (difference ? 0 : source.offset - target.offset)) / target.scale;
}

// WMO force categories in m/s, half-open intervals; Bft 12 has no upper bound.
// https://weather.metoffice.gov.uk/guides/coast-and-sea/beaufort-scale
export const BEAUFORT_LIMITS = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export function beaufort(value: number): number {
  if (!Number.isFinite(value) || value < 0) return NaN;
  const force = BEAUFORT_LIMITS.findIndex(limit => value < limit);
  return force < 0 ? 12 : force;
}
export function convertValues(values: Float32Array, source: Unit, target: Unit | "Bft"): Float32Array {
  return Float32Array.from(values, value => target === "Bft" ? beaufort(value * source.scale) : convert(value, source, target));
}
export function convertedLabel(variable: Variable, unit: string): string {
  return unit && unit !== "1" ? `${variableLabel(variable)} (${unit})` : variableLabel(variable);
}

/** ECMWF defaults apply only to recognized short names without conflicting CF metadata.
 * https://confluence.ecmwf.int/pages/viewpage.action?pageId=239340673
 * Each family's first unit is its ECMWF source unit.
 */
export function defaultECMWFUnit(variable: Variable): string | undefined {
  const { rule } = unitRule(variable);
  return rule?.names.includes(variable.name) ? UNIT_FAMILIES[rule.family][0].id : undefined;
}

export function displayValue(value: number, variable: Variable, target?: Unit): number {
  const source = unitChoice(variable).source;
  return source && target ? convert(value, source, target, variable.value_kind === "delta") : value;
}
