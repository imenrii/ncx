# res/

Fonts the `ncx` binary embeds at compile time. The viewer's usual home is an
SSH tunnel to a cluster with no route to a CDN, so everything it needs to draw
itself has to be inside the executable.

| Directory | Face | Job | Licence | In git |
|---|---|---|---|---|
| `AVHershey/` | AVHershey Simplex | plot glyphs, matching the project's printed figures | WTFPL v2 | yes |
| `AVHershey/NationalPark.woff2` | National Park | plot fallback and chrome labels | SIL OFL 1.1 | yes |
| `gorton-perfected-1.02/` | [Gorton Perfected](https://shifthappens.site/store/#fonts) | interface text | commercial, per-seat | **no** |
| `gen/` | Gorton Perfected, subset | what actually ships | same as above | **no** |
| `CommitMono/commit-web-*.woff2` | Commit Mono Web 400/450/600 | web controls, identifiers, values, descriptive metadata | SIL OFL 1.1 | yes |
| `CommitMono/commit-400.woff2`, `commit-700.woff2` | Legacy Commit Mono | unchanged browser plot fallback | SIL OFL 1.1 | yes |
| `CommitMono/src/` | Legacy Commit Mono TrueType | historical source for the plot fallback | SIL OFL 1.1 | **no** |
| `NewCM/` | New Computer Modern Math | every mathematical symbol, in any face | SIL OFL 1.1 | yes |

Nothing is loaded from a CDN. Commit Mono used to be, which put the one face
whose entire job is column alignment behind the one dependency this binary
cannot satisfy — so it was missing precisely where the viewer normally runs.

`NewCM/` is mounted by `unicode-range`, not by markup: it leads every font stack
in `style.css` carrying Greek, arrows and the operator block, and font matching
runs per character. That sets every Greek letter and operator in LaTeX's face
wherever it appears, including inside SVG plot labels, with no wrapper element.
It also fills a real hole — Gorton carries no lowercase Greek and no
superscripts at all.

## Why some of these are gitignored

[Gorton Perfected](https://shifthappens.site/store/#fonts) (Marcin Wichary) is licensed for use, not redistribution (see background: [The Hardest Working Font in Manhattan](https://aresluna.org/the-hardest-working-font-in-manhattan/)). The terms are
explicit that a subset does not escape them:

> **MODIFICATIONS:** You may also subset and modify the font software itself
> for your own purposes; any derived versions of the font remain my property
> and are subject to the same license and limitations.

> **DISTRIBUTION:** Except in very specific instances described and permitted
> in this license, you may not distribute (share, rent, lend, give away, or
> sell) the font. You agree to take all reasonable steps to prevent unlicensed
> users from accessing, distributing, or re-serving the font file.

Committing `gen/` would distribute the font to everyone who clones. So both the
source and the subsets stay out of the repository, and the subset exists only
inside a binary built by someone holding a licence. `FORMATS` permits WOFF2,
which is what is served.

`CommitMono/src/` holds old sources for the separate plot fallback. The new
Commit Mono Web sources and reproducible build are in the sibling
`Style/Fonts/Commit_Mono` package. The committed web cuts preserve hint tables
(`gasp`, `fpgm`, `prep`, `cvt `). A normal ncx build uses those committed files
and needs no font-generation tools.

## Building without a licence

`cargo build` works either way. `build.rs` covers three cases:

1. **licensed source present, fontTools available** — subsets it now;
2. **no fontTools, but `gen/` holds subsets from an earlier run** — uses those;
3. **no licensed source** — emits empty files and prints a build warning. The
   `@font-face` then fails to load and `style.css` falls through to the
   platform sans, per glyph. The viewer is fully usable; it is wearing a
   different face.

Release authorization for this project covers WOFF2 subsets embedded in the
executable. It does not cover full font sources or separate font downloads.
Keep both sources and generated subsets out of Git and release attachments.
`deploy/package-release.sh` checks that every embedded font is available in
viewer and hub modes and stops if a required font is missing. Subsetting alone
does not change the original licence terms.

## Gorton and National Park subsets

The existing subsetter needs `fonttools` and `brotli`. `build.rs` calls it
when the licensed Gorton source is present:

```bash
python3 web/scripts/subset-fonts.py
```

It produces Gorton 400/600 and National Park. Missing sources leave existing
outputs intact. It does not regenerate either Commit Mono family. Gorton keeps
`kern,tnum,zero,ss02,ss04,ss06,ss12`; National Park keeps `kern`.

## Commit Mono Web

This family is for web UI only. The old `Commit Mono` family and its 400/700
assets remain the browser plot fallback. Non-web scientific plotting styles
do not change.

The customized fonts use upstream Commit Mono 1.143, pinned to revision
`d407cd2bf8e01ca1db70544052fbbb9606406c3b`. They retain all 1,175 supported
code points. Weight 450 is normal on light surfaces, 600 is emphasis, and 400
is for the dark status strip. Round dots and the default slashed zero replace
the old square-dot UI treatment.

The font files retain `ss03`, `ss04`, and `ss05`, but not `calt`, character
alternates, operator ligatures, or arrow substitutions. The UI profile uses
`ss05`; Literal disables all three; Read enables all three. `style.css` owns
the application role mapping. `commit-mono.css` declares the family and tokens.
CM Math remains first. Its symbols have proportional metrics, so mixed math
values need layout-based alignment.

From the sibling Style directory, use an isolated build environment:

```bash
python3 -m venv /tmp/commit-mono-build
/tmp/commit-mono-build/bin/python -m pip install -r Fonts/Commit_Mono/requirements.txt
/tmp/commit-mono-build/bin/python Fonts/Commit_Mono/build.py --ncx ../ncx
/tmp/commit-mono-build/bin/python Fonts/Commit_Mono/build.py --check --ncx ../ncx
```

The build instances the pinned TrueType variable source at 400/450/600 and
hints it with the author's strong-stem modes and 400 reference. It checks
weight metadata, character coverage, features, hints, ASCII widths, line
metrics, hashes, and synchronized copies. The source package contains the
complete input, TTF/WOFF2 outputs, manifest, and instructions.

The ncx runtime needs only the committed WOFF2 files. Rust serves them in both
viewer and hub modes. Export embeds the family for comparison-pane headers;
its plot axis, title, and legend families stay unchanged. If font bytes change,
revise their CSS and export URLs to avoid stale immutable cache entries.

After a font/CSS update, run frontend tests and build, then rebuild Rust before
browser checks. `tests/ui-smoke.mjs` checks actual font loading and role
settings. `tests/release-smoke.py` checks font responses in viewer and hub modes.
Native Windows/macOS rasterization remains a manual check; hint tables alone
do not prove the visual result on those systems.

Keep `CommitMonoWeb-OFL.txt` with the customized family. The older fallback
keeps `CommitMono-LICENSE.txt`. Both are OFL; neither contains Gorton data.
