//! Cut the interface face down to the glyphs this viewer can set, at build time.
//!
//! Gorton Perfected is licensed for use, not redistribution. Its terms are
//! explicit that a subset is still the font -- "any derived versions of the
//! font remain my property and are subject to the same license" -- so neither
//! `res/gorton-perfected-1.02/` nor the subsets built from it are in the
//! repository, and both are in `.gitignore`. The subset exists only inside a
//! binary built by someone who holds a licence.
//!
//! That leaves three cases, and all three have to build:
//!
//!   1. licensed source present, fontTools available -- subset it now;
//!   2. no fontTools, but `res/gen/` holds subsets from an earlier run -- use
//!      those, so a machine without Python can still produce a binary;
//!   3. no licensed source at all -- emit empty files. The `@font-face` then
//!      fails to load and the CSS stack falls through to the platform sans,
//!      per glyph, exactly as it does for a reader whose network drops the
//!      CDN. The viewer is fully usable; it is only wearing a different face.
//!
//! Case 3 is the one that matters for anyone cloning this repository without
//! buying a licence: `cargo build` works, and nothing they can run will hand
//! them the font.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::{env, fs};

/// Regular for text, Semibold for the little that needs weight. Hierarchy in
/// this interface is built from size, case, tracking and rules rather than
/// weight, so two cuts is the whole range.
const FACES: [(&str, &str); 2] = [
    ("gorton-400.woff2", "GortonPerfected-Regular.otf"),
    ("gorton-600.woff2", "GortonPerfected-Semibold.otf"),
];

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let source_dir = root.join("res/gorton-perfected-1.02/Font (not variable)");
    let cached_dir = root.join("res/gen");
    let script = root.join("web/scripts/subset-fonts.py");

    println!("cargo::rerun-if-changed=web/dist/assets");
    fn asset_files(path: &Path, files: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(path).expect("build frontend assets first") {
            let path = entry.expect("read frontend asset").path();
            if path.is_dir() {
                asset_files(&path, files);
            } else {
                files.push(path);
            }
        }
    }
    let mut assets = Vec::new();
    asset_files(&root.join("web/dist/assets"), &mut assets);
    assets.sort();
    let entries = assets
        .iter()
        .map(|path| {
            let name = path.strip_prefix(root.join("web/dist/assets")).unwrap();
            let bytes = fs::read(path).expect("read frontend asset");
            let mut embedded = path.clone();
            let mut gzip = false;
            if matches!(
                path.extension().and_then(|ext| ext.to_str()),
                Some("wasm" | "mjs" | "js" | "css" | "json")
            ) {
                let mut encoder =
                    flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
                encoder.write_all(&bytes).expect("compress frontend asset");
                let compressed = encoder.finish().expect("finish frontend compression");
                if compressed.len() < bytes.len() {
                    embedded = out.join("assets").join(name);
                    fs::create_dir_all(embedded.parent().unwrap()).unwrap();
                    fs::write(&embedded, compressed).expect("write compressed asset");
                    gzip = true;
                }
            }
            format!(
                "WebAsset {{ name: {:?}, bytes: include_bytes!({:?}), gzip: {gzip} }},",
                name.to_str().unwrap(),
                embedded.to_str().unwrap()
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(
        out.join("web_assets.rs"),
        format!("const WEB_ASSETS: &[WebAsset] = &[{entries}];"),
    )
    .expect("write asset table");

    println!("cargo::rerun-if-changed=web/scripts/subset-fonts.py");
    println!("cargo::rerun-if-changed=res/gen");

    let subsetted = source_dir.join(FACES[0].1).exists() && run_subsetter(&root, &script);

    for (name, _) in FACES {
        let target = out.join(name);
        let cached = cached_dir.join(name);
        if subsetted && cached.exists() {
            fs::copy(&cached, &target).expect("copy subset into OUT_DIR");
        } else if cached.exists() {
            fs::copy(&cached, &target).expect("copy cached subset into OUT_DIR");
        } else {
            // No licence, no font. The stack in style.css covers it.
            fs::write(&target, b"").expect("write placeholder");
            println!(
                "cargo::warning=Gorton Perfected not found; the interface will \
                 use the platform sans. This is expected without a font licence."
            );
        }
    }
}

/// Returns true when fontTools ran and wrote fresh subsets into `res/gen/`.
fn run_subsetter(root: &Path, script: &Path) -> bool {
    Command::new("python3")
        .arg(script)
        .current_dir(root)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
