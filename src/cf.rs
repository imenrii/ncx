use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, NaiveDate, NaiveDateTime};
use serde::Serialize;

use crate::dataset::{DatasetMetadata, VariableSummary, ViewHint};

#[derive(Clone, Debug, Default, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct VariableCapabilities {
    pub numeric: bool,
    pub coordinate: bool,
    pub mesh_geometry: bool,
    pub time_axis: bool,
    pub calendar: String,
    pub time: Option<TimeAxis>,
    pub references: BTreeMap<String, Vec<String>>,
    pub geographic: bool,
    pub geographic_axis: Option<GeographicAxis>,
    pub geographic_coordinates: Vec<GeographicCoordinates>,
    pub display_x: Option<usize>,
    pub display_y: Option<usize>,
    pub edge_dimension: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TimeAxis {
    pub multiplier_ms: f64,
    pub origin_ms: f64,
    pub offset_minutes: i32,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct GeographicCoordinates {
    pub dimensions: Vec<String>,
    pub longitude: String,
    pub latitude: String,
}

#[derive(Clone, Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "snake_case")]
pub enum GeographicAxis {
    Longitude,
    Latitude,
}

/// Add conservative display defaults without changing the file's raw metadata.
pub fn add_view_hints(metadata: &mut DatasetMetadata) -> crate::NcxResult<HashSet<String>> {
    let mut reference_bytes = crate::dataset::MAX_METADATA_BYTES;
    for variable in &metadata.variables {
        for attribute in &variable.attributes {
            if reference_attribute(&attribute.name)
                && let Some(value) = attribute.text()
            {
                let count = value.split_whitespace().count();
                let bytes = count
                    .saturating_mul(variable.path.len() + 32)
                    .saturating_add(value.len());
                reference_bytes = reference_bytes
                    .checked_sub(bytes)
                    .ok_or("metadata reference limit exceeded")?;
            }
        }
    }
    let connectivity_variables = metadata
        .variables
        .iter()
        .filter(|variable| {
            attribute_text(variable, "cf_role").is_some_and(|role| role.ends_with("_connectivity"))
        })
        .map(|variable| variable.path.clone())
        .collect();
    let mut hints = Vec::with_capacity(metadata.variables.len());
    let mut warnings = Vec::new();

    for variable in &metadata.variables {
        match detect_ugrid(variable, metadata) {
            Ok(Some(hint)) => hints.push(hint),
            Ok(None) => hints.push(detect_structured(variable, metadata, &mut warnings)),
            Err(warning) => {
                warnings.push(format!("{}: {warning}", variable.path));
                hints.push(ViewHint::Plain);
            }
        }
    }

    for (variable, hint) in metadata.variables.iter_mut().zip(hints) {
        variable.view_hint = hint;
    }
    metadata.warnings.extend(warnings);
    add_capabilities(metadata)?;
    Ok(connectivity_variables)
}

fn reference_attribute(name: &str) -> bool {
    matches!(
        name,
        "mesh" | "bounds" | "climatology" | "grid_mapping" | "coordinates"
    ) || name.ends_with("_coordinates")
        || name.ends_with("_connectivity")
}

fn add_capabilities(metadata: &mut DatasetMetadata) -> crate::NcxResult<()> {
    let mut coordinates = HashSet::new();
    let mut geometry = HashSet::new();
    for variable in &metadata.variables {
        let standard = attribute_text(variable, "standard_name").unwrap_or_default();
        let axis = attribute_text(variable, "axis")
            .unwrap_or_default()
            .to_ascii_uppercase();
        if (variable.dimensions.len() == 1
            && metadata.dimensions.iter().any(|d| d.path == variable.path))
            || matches!(axis.as_str(), "X" | "Y" | "Z" | "T")
            || matches!(
                standard,
                "longitude"
                    | "latitude"
                    | "time"
                    | "depth"
                    | "altitude"
                    | "projection_x_coordinate"
                    | "projection_y_coordinate"
            )
            || matches!(
                attribute_text(variable, "units"),
                Some("degrees_north" | "degrees_east")
            )
        {
            coordinates.insert(variable.path.clone());
        }
        for key in ["coordinates", "bounds", "climatology", "grid_mapping"] {
            if let Some(value) = attribute_text(variable, key) {
                coordinates.extend(
                    value.split_whitespace().map(|value| {
                        resolve_reference(&variable.path, value.trim_end_matches(':'))
                    }),
                );
            }
        }
        let role = attribute_text(variable, "cf_role").unwrap_or_default();
        if role.ends_with("_connectivity") || role == "location_index_set" {
            geometry.insert(variable.path.clone());
        }
        if role != "mesh_topology" {
            continue;
        }
        geometry.insert(variable.path.clone());
        for attribute in &variable.attributes {
            if (attribute.name.contains("coordinates") || attribute.name.contains("connectivity"))
                && let Some(value) = attribute.text()
            {
                geometry.extend(
                    value
                        .split_whitespace()
                        .map(|reference| resolve_reference(&variable.path, reference)),
                );
            }
        }
        for helper in &metadata.variables {
            let prefix = format!("{}_", variable.name);
            let Some(suffix) = helper.name.strip_prefix(&prefix) else {
                continue;
            };
            if helper.path.rsplit_once('/').map(|p| p.0)
                != variable.path.rsplit_once('/').map(|p| p.0)
            {
                continue;
            }
            let static_helper = matches!(
                suffix,
                "face_area"
                    | "face_static_mask"
                    | "edge_length"
                    | "edge_normal_x"
                    | "edge_normal_y"
                    | "edge_type"
                    | "input_face_id"
                    | "input_edge_id"
                    | "solver_face_id"
                    | "solver_edge_id"
                    | "solver_edge_sign"
            );
            if attribute_text(helper, "mesh").is_none()
                || (static_helper
                    && helper.dimensions.len() == 1
                    && attribute_text(helper, "mesh").is_some_and(|reference| {
                        resolve_reference(&helper.path, reference) == variable.path
                    }))
            {
                geometry.insert(helper.path.clone());
            }
        }
    }
    let mut reference_warnings = Vec::new();
    let capabilities = metadata
        .variables
        .iter()
        .map(|variable| {
            let mut references: BTreeMap<String, Vec<String>> = BTreeMap::new();
            for attribute in &variable.attributes {
                if reference_attribute(&attribute.name)
                    && let Some(value) = attribute.text()
                {
                    references.insert(
                        attribute.name.clone(),
                        value
                            .split_whitespace()
                            .map(|reference| {
                                resolve_reference(&variable.path, reference.trim_end_matches(':'))
                            })
                            .filter(|path| {
                                let found = find_variable(metadata, path).is_some();
                                if !found {
                                    reference_warnings.push(format!(
                                        "{}: missing reference {path}",
                                        variable.path
                                    ));
                                }
                                found
                            })
                            .collect(),
                    );
                }
            }
            let hint_axes = match &variable.view_hint {
                ViewHint::Rectilinear { x, y }
                | ViewHint::Curvilinear { x, y }
                | ViewHint::Ugrid2d { x, y, .. } => Some((x, y)),
                ViewHint::Plain => None,
            };
            let geographic = hint_axes.is_some_and(|(x, y)| {
                find_variable(metadata, x).is_some_and(is_longitude)
                    && find_variable(metadata, y).is_some_and(is_latitude)
            });
            let expected_dimensions = hint_axes
                .and_then(|(x, _)| find_variable(metadata, x))
                .map_or(&variable.dimensions, |x| &x.dimensions);
            let explicit = references.get("coordinates");
            let group = |path: &str| path.rsplit_once('/').map(|p| p.0).unwrap_or("").to_owned();
            let owner_group = group(&variable.path);
            let mesh_group = hint_axes.map(|(x, _)| group(x));
            let candidates = metadata
                .variables
                .iter()
                .filter(|candidate| {
                    let eligible = explicit.map_or_else(
                        || {
                            let parent = group(&candidate.path);
                            parent == owner_group || mesh_group.as_ref() == Some(&parent)
                        },
                        |paths| paths.contains(&candidate.path),
                    );
                    eligible
                        && !candidate.dimensions.is_empty()
                        && candidate.dimensions.len() <= 2
                        && candidate.dimensions.iter().all(|d| {
                            variable
                                .dimensions
                                .iter()
                                .chain(expected_dimensions)
                                .any(|v| v.path == d.path)
                        })
                })
                .collect::<Vec<_>>();
            let mut geographic_coordinates = Vec::new();
            for longitude in candidates.iter().filter(|v| is_longitude(v)) {
                let same_plane = |candidate: &&VariableSummary| {
                    candidate.dimensions.len() == longitude.dimensions.len()
                        && candidate
                            .dimensions
                            .iter()
                            .zip(&longitude.dimensions)
                            .all(|(a, b)| a.path == b.path)
                        && (explicit.is_some() || group(&candidate.path) == group(&longitude.path))
                };
                let latitudes = candidates
                    .iter()
                    .copied()
                    .filter(|v| is_latitude(v))
                    .filter(same_plane)
                    .collect::<Vec<_>>();
                let longitudes = candidates
                    .iter()
                    .copied()
                    .filter(|v| is_longitude(v))
                    .filter(same_plane)
                    .count();
                if latitudes.len() == 1 && longitudes == 1 {
                    geographic_coordinates.push(GeographicCoordinates {
                        longitude: longitude.path.clone(),
                        latitude: latitudes[0].path.clone(),
                        dimensions: longitude
                            .dimensions
                            .iter()
                            .map(|d| d.path.clone())
                            .collect(),
                    });
                }
            }
            let rank = variable.dimensions.len();
            let mut display_x = rank.checked_sub(1);
            let display_y = if matches!(variable.view_hint, ViewHint::Ugrid2d { .. }) {
                None
            } else {
                rank.checked_sub(2)
            };
            if let ViewHint::Ugrid2d { mesh, location, .. } = &variable.view_hint
                && location == "edge"
                && let Some(topology) = find_variable(metadata, mesh)
                && let Some(name) = edge_dimension(topology, metadata)
            {
                display_x = variable
                    .dimensions
                    .iter()
                    .position(|d| d.name == name)
                    .or(display_x);
            }
            let calendar = attribute_text(variable, "calendar")
                .unwrap_or("standard")
                .trim()
                .to_ascii_lowercase();
            VariableCapabilities {
                numeric: matches!(
                    variable.dtype.as_str(),
                    "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32" | "f64"
                ),
                coordinate: coordinates.contains(&variable.path),
                mesh_geometry: geometry.contains(&variable.path),
                time_axis: attribute_text(variable, "axis")
                    .is_some_and(|a| a.eq_ignore_ascii_case("T"))
                    || attribute_text(variable, "standard_name") == Some("time"),
                time: parse_time(
                    attribute_text(variable, "units").unwrap_or_default(),
                    &calendar,
                ),
                calendar,
                references,
                geographic,
                geographic_axis: if is_longitude(variable) {
                    Some(GeographicAxis::Longitude)
                } else if is_latitude(variable) {
                    Some(GeographicAxis::Latitude)
                } else {
                    None
                },
                geographic_coordinates,
                display_x,
                display_y,
                edge_dimension: edge_dimension(variable, metadata),
            }
        })
        .collect::<Vec<_>>();
    metadata.warnings.extend(reference_warnings);
    for (variable, capabilities) in metadata.variables.iter_mut().zip(capabilities) {
        variable.capabilities = capabilities;
    }
    metadata.default_variable = metadata
        .variables
        .iter()
        .filter(|v| {
            v.capabilities.numeric
                && !v.capabilities.coordinate
                && !v.capabilities.mesh_geometry
                && v.dimensions.iter().all(|d| d.length > 0)
        })
        .enumerate()
        .max_by_key(|(index, v)| {
            let animated = v.dimensions.iter().any(|d| {
                find_variable(metadata, &d.path).is_some_and(|v| v.capabilities.time_axis)
            });
            let score = usize::from(!matches!(v.view_hint, ViewHint::Plain)) * 8
                + usize::from(animated) * 4
                + v.dimensions.len().saturating_sub(1).min(3);
            (score, std::cmp::Reverse(*index))
        })
        .map(|(_, v)| v)
        .or_else(|| metadata.variables.iter().find(|v| v.capabilities.numeric))
        .map(|v| v.path.clone());
    Ok(())
}

fn edge_dimension(variable: &VariableSummary, metadata: &DatasetMetadata) -> Option<String> {
    attribute_text(variable, "edge_dimension")
        .map(str::to_owned)
        .or_else(|| {
            let reference = attribute_text(variable, "edge_node_connectivity")?;
            find_variable(metadata, &resolve_reference(&variable.path, reference))?
                .dimensions
                .first()
                .map(|d| d.name.clone())
        })
}

fn is_longitude(variable: &VariableSummary) -> bool {
    attribute_text(variable, "standard_name") == Some("longitude")
        || attribute_text(variable, "units").is_some_and(|u| u.starts_with("degrees_east"))
}

fn is_latitude(variable: &VariableSummary) -> bool {
    attribute_text(variable, "standard_name") == Some("latitude")
        || attribute_text(variable, "units").is_some_and(|u| u.starts_with("degrees_north"))
}

fn parse_time(units: &str, calendar: &str) -> Option<TimeAxis> {
    if !matches!(calendar, "standard" | "gregorian" | "proleptic_gregorian") {
        return None;
    }
    let separator = units.to_ascii_lowercase().find(" since ")?;
    let (unit, origin) = (&units[..separator], &units[separator + 7..]);
    let multiplier_ms = match unit.trim().to_ascii_lowercase().trim_end_matches('s') {
        "second" => 1_000.,
        "minute" => 60_000.,
        "hour" => 3_600_000.,
        "day" => 86_400_000.,
        _ => return None,
    };
    let origin = origin
        .trim()
        .to_ascii_uppercase()
        .replace(" UTC", " +00:00")
        .replace(" GMT", " +00:00")
        .replace('T', " ")
        .replace('Z', " +00:00");
    for format in [
        "%Y-%m-%d %H:%M:%S%.f %:z",
        "%Y-%m-%d %H:%M:%S%.f%:z",
        "%Y-%m-%d %H:%M:%S%.f %z",
        "%Y-%m-%d %H:%M %:z",
        "%Y-%m-%d %H:%M%:z",
        "%Y-%m-%d %H:%M %z",
    ] {
        if let Ok(date) = DateTime::parse_from_str(&origin, format) {
            return Some(TimeAxis {
                multiplier_ms,
                origin_ms: date.timestamp_millis() as f64,
                offset_minutes: date.offset().local_minus_utc() / 60,
            });
        }
    }
    let date = NaiveDateTime::parse_from_str(&origin, "%Y-%m-%d %H:%M:%S%.f")
        .ok()
        .or_else(|| NaiveDateTime::parse_from_str(&origin, "%Y-%m-%d %H:%M").ok())
        .or_else(|| {
            NaiveDate::parse_from_str(
                origin.strip_suffix("+00:00").unwrap_or(&origin).trim(),
                "%Y-%m-%d",
            )
            .ok()?
            .and_hms_opt(0, 0, 0)
        })?;
    Some(TimeAxis {
        multiplier_ms,
        origin_ms: date.and_utc().timestamp_millis() as f64,
        offset_minutes: 0,
    })
}

fn detect_ugrid(
    variable: &VariableSummary,
    metadata: &DatasetMetadata,
) -> Result<Option<ViewHint>, String> {
    let Some(mesh_reference) = attribute_text(variable, "mesh") else {
        return Ok(None);
    };
    let mesh_path = resolve_reference(&variable.path, mesh_reference);
    let mesh = find_variable(metadata, &mesh_path)
        .ok_or_else(|| format!("mesh attribute refers to missing variable {mesh_path}"))?;
    if attribute_text(mesh, "cf_role") != Some("mesh_topology")
        || attribute_integer(mesh, "topology_dimension") != Some(2)
    {
        return Err(format!("{mesh_path} is not a UGRID 2D mesh topology"));
    }

    let coordinates = attribute_text(mesh, "node_coordinates")
        .ok_or_else(|| format!("{mesh_path} has no node_coordinates"))?
        .split_whitespace()
        .map(|reference| resolve_reference(&mesh.path, reference))
        .collect::<Vec<_>>();
    if coordinates.len() < 2 {
        return Err(format!("{mesh_path} needs two node_coordinates"));
    }
    let (x, y) = order_xy(&coordinates, metadata)
        .unwrap_or_else(|| (coordinates[0].clone(), coordinates[1].clone()));

    let connectivity = attribute_text(mesh, "face_node_connectivity")
        .ok_or_else(|| format!("{mesh_path} has no face_node_connectivity"))?;
    let connectivity = resolve_reference(&mesh.path, connectivity);
    if find_variable(metadata, &connectivity).is_none() {
        return Err(format!(
            "mesh connectivity variable {connectivity} is missing"
        ));
    }
    let location = attribute_text(variable, "location")
        .filter(|location| matches!(*location, "node" | "edge" | "face"))
        .ok_or_else(|| "UGRID data location must be `node`, `edge`, or `face`".to_owned())?;

    Ok(Some(ViewHint::Ugrid2d {
        mesh: mesh_path,
        x,
        y,
        face_node_connectivity: connectivity,
        location: location.to_owned(),
    }))
}

fn detect_structured(
    variable: &VariableSummary,
    metadata: &DatasetMetadata,
    warnings: &mut Vec<String>,
) -> ViewHint {
    if variable.dimensions.len() < 2 {
        return ViewHint::Plain;
    }
    let y_dimension = &variable.dimensions[variable.dimensions.len() - 2];
    let x_dimension = &variable.dimensions[variable.dimensions.len() - 1];

    let mut candidates = attribute_text(variable, "coordinates")
        .map(|coordinates| {
            coordinates
                .split_whitespace()
                .map(|reference| resolve_reference(&variable.path, reference))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    candidates.push(x_dimension.path.clone());
    candidates.push(y_dimension.path.clone());
    candidates.sort();
    candidates.dedup();

    let coordinate_variables = candidates
        .iter()
        .filter_map(|path| find_variable(metadata, path))
        .collect::<Vec<_>>();
    let x = coordinate_variables.iter().copied().find(|coordinate| {
        coordinate_axis(coordinate) == Some(Axis::X) || coordinate.path == x_dimension.path
    });
    let y = coordinate_variables.iter().copied().find(|coordinate| {
        coordinate_axis(coordinate) == Some(Axis::Y) || coordinate.path == y_dimension.path
    });

    if let (Some(x), Some(y)) = (x, y) {
        let display_dimensions = [y_dimension.path.as_str(), x_dimension.path.as_str()];
        let x_dimensions = x
            .dimensions
            .iter()
            .map(|dimension| dimension.path.as_str())
            .collect::<Vec<_>>();
        let y_dimensions = y
            .dimensions
            .iter()
            .map(|dimension| dimension.path.as_str())
            .collect::<Vec<_>>();
        if x_dimensions == display_dimensions && y_dimensions == display_dimensions {
            return ViewHint::Curvilinear {
                x: x.path.clone(),
                y: y.path.clone(),
            };
        }
        if x_dimensions == [x_dimension.path.as_str()]
            && y_dimensions == [y_dimension.path.as_str()]
        {
            return ViewHint::Rectilinear {
                x: x.path.clone(),
                y: y.path.clone(),
            };
        }
    }

    if attribute_text(variable, "coordinates").is_some() {
        warnings.push(format!(
            "{}: coordinates do not match its two display dimensions; using index space",
            variable.path
        ));
    }
    ViewHint::Plain
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Axis {
    X,
    Y,
}

fn coordinate_axis(variable: &VariableSummary) -> Option<Axis> {
    match attribute_text(variable, "axis") {
        Some("X" | "x") => return Some(Axis::X),
        Some("Y" | "y") => return Some(Axis::Y),
        _ => {}
    }
    let standard_name = attribute_text(variable, "standard_name").unwrap_or_default();
    if matches!(standard_name, "longitude" | "projection_x_coordinate") {
        return Some(Axis::X);
    }
    if matches!(standard_name, "latitude" | "projection_y_coordinate") {
        return Some(Axis::Y);
    }
    let units = attribute_text(variable, "units").unwrap_or_default();
    if units.starts_with("degrees_east") {
        return Some(Axis::X);
    }
    if units.starts_with("degrees_north") {
        return Some(Axis::Y);
    }
    match variable.name.to_ascii_lowercase().as_str() {
        "x" | "lon" | "longitude" => Some(Axis::X),
        "y" | "lat" | "latitude" => Some(Axis::Y),
        _ => None,
    }
}

fn order_xy(paths: &[String], metadata: &DatasetMetadata) -> Option<(String, String)> {
    let x = paths
        .iter()
        .find(|path| find_variable(metadata, path).and_then(coordinate_axis) == Some(Axis::X))?;
    let y = paths
        .iter()
        .find(|path| find_variable(metadata, path).and_then(coordinate_axis) == Some(Axis::Y))?;
    Some((x.clone(), y.clone()))
}

fn find_variable<'a>(metadata: &'a DatasetMetadata, path: &str) -> Option<&'a VariableSummary> {
    metadata
        .variables
        .iter()
        .find(|variable| variable.path == path)
}

fn attribute_text<'a>(variable: &'a VariableSummary, name: &str) -> Option<&'a str> {
    variable
        .attributes
        .iter()
        .find(|attribute| attribute.name == name)
        .and_then(|attribute| attribute.text())
}

fn attribute_integer(variable: &VariableSummary, name: &str) -> Option<i64> {
    variable
        .attributes
        .iter()
        .find(|attribute| attribute.name == name)
        .and_then(|attribute| attribute.integer())
}

fn resolve_reference(owner_path: &str, reference: &str) -> String {
    let mut parts = if reference.starts_with('/') {
        Vec::new()
    } else {
        owner_path
            .trim_start_matches('/')
            .split('/')
            .collect::<Vec<_>>()
    };
    if !reference.starts_with('/') {
        parts.pop();
    }
    for part in reference.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            name => parts.push(name),
        }
    }
    format!("/{}", parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_grouped_mesh_references_and_geometry() {
        let dataset = crate::dataset::Dataset::open(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/grouped_ugrid.nc"),
        )
        .unwrap();
        let metadata = dataset.metadata();
        let field = find_variable(metadata, "/ocean/state/temp").unwrap();
        assert!(
            matches!(&field.view_hint, ViewHint::Ugrid2d { mesh, x, .. } if mesh == "/ocean/mesh" && x == "/ocean/lon")
        );
        assert_eq!(
            field.capabilities.references["coordinates"],
            ["/ocean/lon", "/ocean/lat"]
        );
        assert_eq!(
            field
                .capabilities
                .geographic_coordinates
                .first()
                .unwrap()
                .longitude,
            "/ocean/lon"
        );
        let mesh = find_variable(metadata, "/ocean/mesh").unwrap();
        assert_eq!(
            mesh.capabilities.references["edge_face_connectivity"],
            ["/ocean/edge_faces"]
        );
        assert!(mesh.capabilities.mesh_geometry);
        assert!(!field.capabilities.mesh_geometry);
        let cross = find_variable(metadata, "/ocean/state/cross_group").unwrap();
        assert_eq!(
            cross.capabilities.geographic_coordinates[0].longitude,
            "/ocean/geo/lon"
        );
        let missing = find_variable(metadata, "/ocean/state/missing_reference").unwrap();
        assert!(missing.capabilities.geographic_coordinates.is_empty());
        assert!(
            metadata
                .warnings
                .iter()
                .any(|warning| warning.contains("missing reference /ocean/missing"))
        );
    }

    #[test]
    fn canonical_time_preserves_timezone_and_refuses_model_calendars() {
        let time = parse_time("hours since 2024-07-25 00:00:00 +08:00", "standard").unwrap();
        assert_eq!(time.offset_minutes, 480);
        assert_eq!(time.multiplier_ms, 3_600_000.);
        let utc = parse_time("hours since 2024-07-24 16:00:00 UTC", "standard").unwrap();
        assert_eq!(utc.origin_ms, time.origin_ms);
        for units in [
            "HOURS SINCE 2024-07-24 16:00 utc",
            "hours since 2024-07-24 16:00",
            "hours since 2024-07-24 16:00 gmt",
        ] {
            assert_eq!(
                parse_time(units, "standard").unwrap().origin_ms,
                utc.origin_ms
            );
        }
        assert!(parse_time("days since 2000-01-01", "360_day").is_none());
        for units in ["days since 2024-07-25 UTC", "days since 2024-07-25Z"] {
            assert_eq!(
                parse_time(units, "standard").unwrap().origin_ms,
                1_721_865_600_000.
            );
        }
        assert!(parse_time("days since 2000-01-01", "noleap").is_none());
        assert!(parse_time("days since 2001-02-29", "standard").is_none());
        assert_eq!(
            parse_time("seconds since 1970-01-01T00:00:00Z", "standard")
                .unwrap()
                .origin_ms,
            0.
        );
    }

    #[test]
    fn resolves_group_relative_references_without_a_path_library() {
        assert_eq!(
            resolve_reference("/ocean/state/temp", "lon"),
            "/ocean/state/lon"
        );
        assert_eq!(
            resolve_reference("/ocean/state/temp", "../mesh"),
            "/ocean/mesh"
        );
        assert_eq!(
            resolve_reference("/ocean/temp", "/coordinates/lon"),
            "/coordinates/lon"
        );
    }
}
