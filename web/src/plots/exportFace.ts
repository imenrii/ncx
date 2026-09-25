import { PLOT_FONTS, PLOT_STYLE } from "./plotStyle";
import { STANDARD } from "./exportSettings";

/**
 * The export typeface. A face is one of the families ncx serves, a system
 * family, a Google Fonts family name, or a Google Fonts CSS link. Only Google
 * Fonts is fetched: it is the one remote source the dialog offers, and its CSS
 * and font files are embedded in the saved file like the local faces.
 */

const GOOGLE_CSS = "https://fonts.googleapis.com/";
const GOOGLE_FILES = "https://fonts.gstatic.com/";
const GENERIC = ["system-ui", "sans-serif", "serif", "monospace", "cursive", "fantasy",
  "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"];
export const LOCAL_FACES = [...new Set(PLOT_FONTS.map(font => font.family))].filter(family => family !== "CM Math");

export type FaceSource = "ncx" | "system" | "google";
export interface ResolvedFace { family: string; source: FaceSource; stack: string }

/** The family a face names; for a Google Fonts link, its first `family`. */
export function faceFamily(face: string): string {
  const value = face.trim();
  if (value.startsWith(GOOGLE_CSS)) {
    try {
      return new URL(value).searchParams.get("family")?.split(":")[0].replace(/\+/g, " ").trim() ?? "";
    } catch {
      return "";
    }
  }
  return value;
}

/** CM Math still leads, so mathematics keeps its face; the Style stack is the fallback. */
function stackFor(family: string): string {
  if (!family) return PLOT_STYLE.face;
  const named = GENERIC.includes(family) ? family : `"${family.replace(/["\\]/g, "")}"`;
  return `"CM Math", ${named}, ${PLOT_STYLE.face}`;
}

const googleHref = (face: string, family: string) => face.trim().startsWith(GOOGLE_CSS) ? face.trim()
  : `${GOOGLE_CSS}css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;

const cssCache = new Map<string, Promise<string>>();

/** The stylesheet text, once per link. A family Google does not serve is a system family. */
function googleCss(href: string): Promise<string> {
  let css = cssCache.get(href);
  if (!css) {
    css = fetch(href).then(response => {
      if (!response.ok) throw new Error(`Google Fonts has no such family (${response.status})`);
      return response.text();
    });
    css.catch(() => cssCache.delete(href));
    cssCache.set(href, css);
  }
  return css;
}

/** Load the face into this page, so layout measures the text it will draw. */
export async function resolveFace(face: string): Promise<ResolvedFace> {
  const family = faceFamily(face);
  // The Style face is already first in the Style stack.
  if (!family || family === STANDARD.face) return { family, source: "ncx", stack: PLOT_STYLE.face };
  if (LOCAL_FACES.includes(family)) return { family, source: "ncx", stack: stackFor(family) };
  if (GENERIC.includes(family) || !/^[\w -]+$/.test(family)) return { family, source: "system", stack: stackFor(family) };
  const href = googleHref(face, family);
  try {
    const css = await googleCss(href);
    if (!document.head.querySelector(`style[data-export-face="${CSS.escape(href)}"]`)) {
      const style = document.createElement("style");
      style.dataset.exportFace = href;
      style.textContent = css;
      document.head.append(style);
    }
    await Promise.all([400, 700].map(weight => document.fonts.load(`${weight} 16px "${family}"`)));
    return { family, source: "google", stack: stackFor(family) };
  } catch {
    return { family, source: "system", stack: stackFor(family) };
  }
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const embedCache = new Map<string, Promise<string>>();
const EMBEDDED_SUBSETS = ["latin", "latin-ext", "greek", "greek-ext"];

/** Google Fonts faces with their files inlined, for the isolated export SVG. */
export function embeddedGoogleCss(face: string): Promise<string> {
  const family = faceFamily(face);
  const href = googleHref(face, family);
  let embedded = embedCache.get(href);
  if (!embedded) {
    embedded = googleCss(href).then(async full => {
      // Google splits a family into script subsets; a plot needs the Latin and Greek ones.
      const subsets = [...full.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g)];
      const css = subsets.length
        ? subsets.filter(([, subset]) => EMBEDDED_SUBSETS.includes(subset)).map(([, , rule]) => rule).join("\n")
        : full;
      const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(match => match[1]))]
        .filter(url => url.startsWith(GOOGLE_FILES));
      const files = await Promise.all(urls.map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cannot load export font (${response.status})`);
        return [url, `data:font/woff2;base64,${base64(await response.arrayBuffer())}`] as const;
      }));
      return files.reduce((text, [url, data]) => text.split(url).join(data), css);
    });
    embedded.catch(() => embedCache.delete(href));
    embedCache.set(href, embedded);
  }
  return embedded;
}
