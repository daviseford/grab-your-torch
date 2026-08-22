/**
 * Victory Flame brand asset helpers.
 *
 * The supplied lockup SVGs (docs/brand/source) set the wordmark as live
 * `<text>` in Space Grotesk. An `<img>`-embedded SVG cannot load web fonts, so
 * a visitor without Space Grotesk installed silently sees Arial. Shipping
 * lockups therefore have their glyphs converted to outlines here, using the
 * same version-pinned Fontsource files the app bundles, so the wordmark is
 * deterministic everywhere.
 *
 * Everything in this module is pure (string in, string out) apart from
 * `loadBrandFonts`, which reads the font files once. `generate-web-assets.ts`
 * wires it to the filesystem and Sharp; the tests exercise the helpers and
 * validate the committed outputs.
 */
import * as fontkit from "fontkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decompress as decompressWoff2 } from "wawoff2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const BRAND_SOURCE_DIR = path.join(REPO_ROOT, "docs", "brand", "source");
export const BRAND_DOCS_DIR = path.join(REPO_ROOT, "docs", "brand");
export const PUBLIC_DIR = path.join(REPO_ROOT, "public");

/** Brand palette from docs/brand/brand-guidelines.md. */
export const BRAND_COLORS = {
  nightNavy: "#071D3A",
  leagueBlue: "#1177FF",
  signalCyan: "#18D5F2",
  emberOrange: "#FF5A36",
  victoryGold: "#FFC83D",
  iceWhite: "#EAF8FF",
  mistBlue: "#B8D9EE",
} as const;

export type BrandFontFamily = "space-grotesk" | "inter";

/** Latin, normal-style, weight-axis variable fonts the app also bundles. */
export const BRAND_FONT_FILES: Record<BrandFontFamily, string> = {
  "space-grotesk": path.join(
    REPO_ROOT,
    "node_modules",
    "@fontsource-variable",
    "space-grotesk",
    "files",
    "space-grotesk-latin-wght-normal.woff2",
  ),
  inter: path.join(
    REPO_ROOT,
    "node_modules",
    "@fontsource-variable",
    "inter",
    "files",
    "inter-latin-wght-normal.woff2",
  ),
};

/**
 * CSS's default oblique angle. Space Grotesk ships no italic, so browsers
 * synthesize the brand guideline's "ExtraBold Italic" by slanting the upright
 * face; outlining reproduces that same slant.
 */
export const SYNTHETIC_OBLIQUE_DEGREES = 14;

export type BrandFonts = Record<BrandFontFamily, fontkit.Font>;

/**
 * Fontsource ships WOFF2 only. fontkit cannot instance a variable WOFF2
 * (its transformed glyf table defeats `getVariation`), so each file is
 * decompressed to TTF in memory first.
 */
export async function loadBrandFonts(): Promise<BrandFonts> {
  const load = async (family: BrandFontFamily): Promise<fontkit.Font> => {
    const woff2 = fs.readFileSync(BRAND_FONT_FILES[family]);
    const ttf = Buffer.from(await decompressWoff2(woff2));
    const font = fontkit.create(ttf);
    if (!("layout" in font)) {
      throw new Error(
        `${BRAND_FONT_FILES[family]} is a collection, not a font`,
      );
    }
    return font;
  };
  return {
    "space-grotesk": await load("space-grotesk"),
    inter: await load("inter"),
  };
}

export interface TextRun {
  text: string;
  family: BrandFontFamily;
  weight: number;
  italic: boolean;
  fontSize: number;
  letterSpacing: number;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  fill: string;
}

const TEXT_ELEMENT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;

function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match?.[1];
}

function familyFromFontStack(stack: string | undefined): BrandFontFamily {
  const first = (stack ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("space grotesk")) return "space-grotesk";
  if (first.startsWith("inter")) return "inter";
  throw new Error(
    `Unsupported font-family "${stack}": only Space Grotesk and Inter are brand fonts`,
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract every `<text>` element of a brand SVG as a typographic run. */
export function parseTextRuns(svg: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const match of svg.matchAll(TEXT_ELEMENT_RE)) {
    const attrs = match[1];
    const anchor = (attr(attrs, "text-anchor") ?? "start") as TextRun["anchor"];
    runs.push({
      text: decodeEntities(match[2].trim()),
      family: familyFromFontStack(attr(attrs, "font-family")),
      weight: Number(attr(attrs, "font-weight") ?? 400),
      italic: attr(attrs, "font-style") === "italic",
      fontSize: Number(attr(attrs, "font-size") ?? 16),
      letterSpacing: Number(attr(attrs, "letter-spacing") ?? 0),
      x: Number(attr(attrs, "x") ?? 0),
      y: Number(attr(attrs, "y") ?? 0),
      anchor,
      fill: attr(attrs, "fill") ?? "#000",
    });
  }
  return runs;
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function clampWeight(font: fontkit.Font, weight: number): number {
  const axis = font.variationAxes?.wght;
  if (!axis) return weight;
  return Math.min(axis.max, Math.max(axis.min, weight));
}

/**
 * Lay out a text run with fontkit and return the SVG path data for its glyph
 * outlines in document coordinates (y down, baseline at `run.y`).
 */
export function textRunToPathData(run: TextRun, font: fontkit.Font): string {
  const weighted = font.variationAxes?.wght
    ? font.getVariation({ wght: clampWeight(font, run.weight) })
    : font;
  const scale = run.fontSize / weighted.unitsPerEm;
  const skew = run.italic
    ? Math.tan((SYNTHETIC_OBLIQUE_DEGREES * Math.PI) / 180)
    : 0;
  const spacingUnits = run.letterSpacing / scale;

  const layout = weighted.layout(run.text);
  const advances = layout.positions.map((p) => p.xAdvance);
  const totalUnits =
    advances.reduce((sum, a) => sum + a, 0) +
    spacingUnits * Math.max(0, layout.glyphs.length - 1);
  const totalWidth = totalUnits * scale;

  let startX = run.x;
  if (run.anchor === "middle") startX = run.x - totalWidth / 2;
  if (run.anchor === "end") startX = run.x - totalWidth;

  const segments: string[] = [];
  let pen = 0;
  layout.glyphs.forEach((glyph, i) => {
    const pos = layout.positions[i];
    const originX = pen + pos.xOffset;
    const originY = pos.yOffset;
    const point = (px: number, py: number): string => {
      const x = startX + (originX + px + skew * py) * scale;
      const y = run.y - (originY + py) * scale;
      return `${round(x)} ${round(y)}`;
    };

    for (const cmd of glyph.path.commands) {
      const a = cmd.args;
      switch (cmd.command) {
        case "moveTo":
          segments.push(`M${point(a[0], a[1])}`);
          break;
        case "lineTo":
          segments.push(`L${point(a[0], a[1])}`);
          break;
        case "quadraticCurveTo":
          segments.push(`Q${point(a[0], a[1])} ${point(a[2], a[3])}`);
          break;
        case "bezierCurveTo":
          segments.push(
            `C${point(a[0], a[1])} ${point(a[2], a[3])} ${point(a[4], a[5])}`,
          );
          break;
        case "closePath":
          segments.push("Z");
          break;
      }
    }

    pen += pos.xAdvance + spacingUnits;
  });

  return segments.join("");
}

/**
 * Replace every `<text>` element in a brand SVG with outlined `<path>`s.
 * Non-text markup (masks, emblem geometry, metadata) is preserved verbatim.
 */
export function outlineSvgText(svg: string, fonts: BrandFonts): string {
  const runs = parseTextRuns(svg);
  let index = 0;
  return svg.replace(TEXT_ELEMENT_RE, () => {
    const run = runs[index++];
    const d = textRunToPathData(run, fonts[run.family]);
    return `<path fill="${run.fill}" d="${d}"/>`;
  });
}

/** Returns the inner text of every live `<text>` element, if any survive. */
export function findLiveText(svg: string): string[] {
  return Array.from(svg.matchAll(TEXT_ELEMENT_RE), (m) => m[2].trim());
}

/** Effects the brand guidelines forbid in logo artwork. */
export const FORBIDDEN_SVG_EFFECTS = [
  "<filter",
  "<linearGradient",
  "<radialGradient",
  "<image",
  "<foreignObject",
  "<script",
] as const;

export function findForbiddenEffects(svg: string): string[] {
  return FORBIDDEN_SVG_EFFECTS.filter((tag) => svg.includes(tag));
}

/**
 * Stamp an outlined SVG with its provenance so nobody edits the generated
 * file by hand. Placed after the XML/SVG opening so `<svg` stays first.
 */
export function stampProvenance(
  svg: string,
  sourceName: string,
  derived = false,
): string {
  const how = derived
    ? "derived dark variant, wordmark outlined"
    : "wordmark outlined";
  const comment = `<!-- Generated from docs/brand/source/${sourceName} by scripts/generate-web-assets.ts (${how}). Do not edit by hand. -->`;
  return svg.replace(/(<svg\b[^>]*>)/, `$1\n  ${comment}`);
}

/** Strip the indentation/newlines the source files carry; keep structure. */
export function compactSvg(svg: string): string {
  return svg
    .replace(/\r?\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export interface SvgOutput {
  /** File under docs/brand/source */
  source: string;
  /** Output path relative to public/ */
  target: string;
  /** Whether the source contains wordmark text that must be outlined. */
  outline: boolean;
  /** Optional transform applied to the source before outlining (derived variants). */
  derive?: (svg: string) => string;
}

/**
 * The package ships the stacked lockup for light backgrounds only. The
 * standby slates (auth, reset, not found, access denied) sit on Night Navy,
 * so a dark variant is derived with the same color mapping the supplied
 * primary-dark lockup uses: navy wordmark and handle become Ice White, the
 * blue "Torch" and handle highlight become Signal Cyan, the bowl stays blue.
 */
export function deriveStackedDark(svg: string): string {
  return svg
    .replace(
      /aria-label="Grab Your Torch stacked logo"/,
      'aria-label="Grab Your Torch stacked logo, dark background"',
    )
    .replace(/fill="#071D3A"/g, 'fill="#EAF8FF"')
    .replace(
      /<path fill="#1177FF" d="M76 168/,
      '<path fill="#18D5F2" d="M76 168',
    )
    .replace(/(<text[^>]*)fill="#1177FF"/g, '$1fill="#18D5F2"');
}

export interface RasterOutput {
  /** Source SVG: a public/ path produced by `SVG_OUTPUTS` or a docs source. */
  from: { public: string } | { source: string };
  /** Output path relative to public/ */
  target: string;
  width: number;
  height: number;
  /** Flatten transparency onto this color (Apple touch icons must be opaque). */
  background?: string;
  /** Render the artwork inside a full-bleed field at this fraction of the canvas. */
  maskableSafeZone?: number;
}

/**
 * Every vector that ships. Lockups with text are outlined; the rest are
 * copied from source so the runtime never depends on docs/brand.
 */
export const SVG_OUTPUTS: SvgOutput[] = [
  {
    source: "grab-your-torch-primary-light.svg",
    target: "brand/grab-your-torch-primary-light.svg",
    outline: true,
  },
  {
    source: "grab-your-torch-primary-dark.svg",
    target: "brand/grab-your-torch-primary-dark.svg",
    outline: true,
  },
  {
    source: "grab-your-torch-stacked.svg",
    target: "brand/grab-your-torch-stacked.svg",
    outline: true,
  },
  {
    source: "grab-your-torch-stacked.svg",
    target: "brand/grab-your-torch-stacked-dark.svg",
    outline: true,
    derive: deriveStackedDark,
  },
  {
    source: "grab-your-torch-emblem-color.svg",
    target: "brand/grab-your-torch-emblem-color.svg",
    outline: false,
  },
  {
    source: "grab-your-torch-app-icon-512.svg",
    target: "brand/grab-your-torch-app-icon-512.svg",
    outline: false,
  },
  {
    source: "grab-your-torch-one-color-black.svg",
    target: "brand/exports/grab-your-torch-one-color-black.svg",
    outline: true,
  },
  {
    source: "grab-your-torch-one-color-white.svg",
    target: "brand/exports/grab-your-torch-one-color-white.svg",
    outline: true,
  },
  {
    source: "grab-your-torch-social-avatar.svg",
    target: "brand/social/grab-your-torch-social-avatar.svg",
    outline: false,
  },
  {
    source: "grab-your-torch-og-1200x630.svg",
    target: "brand/social/grab-your-torch-og-1200x630.svg",
    outline: true,
  },
  // The 32 px favicon artwork is the scalable tab icon; the 16 px variant is
  // only ever rasterized because it is pixel-aligned for exactly that size.
  {
    source: "grab-your-torch-favicon-32.svg",
    target: "favicon.svg",
    outline: false,
  },
];

export const RASTER_OUTPUTS: RasterOutput[] = [
  // Brand raster exports mirror the supplied PNG dimensions.
  {
    from: { public: "brand/grab-your-torch-primary-light.svg" },
    target: "brand/grab-your-torch-primary-light.png",
    width: 1200,
    height: 347,
  },
  {
    from: { public: "brand/grab-your-torch-primary-dark.svg" },
    target: "brand/grab-your-torch-primary-dark.png",
    width: 1200,
    height: 347,
  },
  {
    from: { public: "brand/grab-your-torch-stacked.svg" },
    target: "brand/grab-your-torch-stacked.png",
    width: 1024,
    height: 1024,
  },
  {
    from: { public: "brand/grab-your-torch-stacked-dark.svg" },
    target: "brand/grab-your-torch-stacked-dark.png",
    width: 1024,
    height: 1024,
  },
  {
    from: { public: "brand/grab-your-torch-emblem-color.svg" },
    target: "brand/grab-your-torch-emblem-color.png",
    width: 800,
    height: 1000,
  },
  {
    from: { public: "brand/grab-your-torch-app-icon-512.svg" },
    target: "brand/grab-your-torch-app-icon-512.png",
    width: 512,
    height: 512,
  },
  {
    from: { public: "brand/exports/grab-your-torch-one-color-black.svg" },
    target: "brand/exports/grab-your-torch-one-color-black.png",
    width: 1200,
    height: 347,
  },
  {
    from: { public: "brand/exports/grab-your-torch-one-color-white.svg" },
    target: "brand/exports/grab-your-torch-one-color-white.png",
    width: 1200,
    height: 347,
  },
  {
    from: { public: "brand/social/grab-your-torch-social-avatar.svg" },
    target: "brand/social/grab-your-torch-social-avatar.png",
    width: 512,
    height: 512,
  },
  // Platform assets at their canonical root paths.
  {
    from: { public: "brand/social/grab-your-torch-og-1200x630.svg" },
    target: "og-image.png",
    width: 1200,
    height: 630,
  },
  {
    from: { source: "grab-your-torch-favicon-16.svg" },
    target: "favicon-16x16.png",
    width: 16,
    height: 16,
  },
  {
    from: { source: "grab-your-torch-favicon-32.svg" },
    target: "favicon-32x32.png",
    width: 32,
    height: 32,
  },
  {
    from: { source: "grab-your-torch-apple-touch-icon-180.svg" },
    target: "apple-touch-icon.png",
    width: 180,
    height: 180,
    // iOS composites transparent corners over black; keep the tile Night Navy.
    background: BRAND_COLORS.nightNavy,
  },
  {
    from: { public: "brand/grab-your-torch-app-icon-512.svg" },
    target: "icons/icon-192.png",
    width: 192,
    height: 192,
  },
  {
    from: { public: "brand/grab-your-torch-emblem-color.svg" },
    target: "icons/icon-512-maskable.png",
    width: 512,
    height: 512,
    background: BRAND_COLORS.nightNavy,
    maskableSafeZone: 0.6,
  },
];

/** Every file the generator writes, relative to public/. */
export function expectedPublicOutputs(): string[] {
  return [
    ...SVG_OUTPUTS.map((o) => o.target),
    ...RASTER_OUTPUTS.map((o) => o.target),
  ];
}

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
}

export const WEB_MANIFEST: WebManifest = {
  name: "Grab Your Torch",
  short_name: "Grab Your Torch",
  description:
    "Fantasy Survivor league for friends. Draft castaways, earn points, and compete spoiler-free.",
  start_url: "/",
  display: "standalone",
  background_color: BRAND_COLORS.nightNavy,
  theme_color: BRAND_COLORS.nightNavy,
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    {
      src: "/brand/grab-your-torch-app-icon-512.png",
      sizes: "512x512",
      type: "image/png",
    },
    {
      src: "/icons/icon-512-maskable.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

/**
 * Root-relative asset paths referenced by index.html head metadata:
 * icons, manifest, and the social image (absolute URLs are reduced to paths).
 */
export function referencedHeadAssets(html: string): string[] {
  const refs = new Set<string>();
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)) {
    const tag = m[0];
    if (/rel="(icon|apple-touch-icon|manifest|mask-icon)"/.test(tag)) {
      refs.add(m[1]);
    }
  }
  for (const m of html.matchAll(
    /<meta\b[^>]*(?:property|name)="(?:og:image|twitter:image)"[^>]*\bcontent="([^"]+)"/g,
  )) {
    refs.add(m[1].replace(/^https?:\/\/[^/]+/, ""));
  }
  return Array.from(refs);
}

/** Files in the supplied brand package, relative to docs/brand. */
export function listBrandDocsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(BRAND_DOCS_DIR, full).replace(/\\/g, "/"));
    }
  };
  walk(BRAND_DOCS_DIR);
  return out.sort();
}
