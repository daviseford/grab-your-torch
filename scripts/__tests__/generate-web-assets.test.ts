/**
 * Brand asset contract.
 *
 * Half of this suite exercises the outlining helpers; the other half validates
 * the committed outputs in public/, docs/brand, index.html, and the manifest,
 * so a stale or hand-edited asset fails CI rather than shipping.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BRAND_DOCS_DIR,
  BRAND_SOURCE_DIR,
  expectedPublicOutputs,
  findForbiddenEffects,
  findLiveText,
  listBrandDocsFiles,
  loadBrandFonts,
  outlineSvgText,
  parseTextRuns,
  PUBLIC_DIR,
  RASTER_OUTPUTS,
  referencedHeadAssets,
  renderSvgOutput,
  REPO_ROOT,
  SVG_OUTPUTS,
  textRunToPathData,
  WEB_MANIFEST,
  type BrandFonts,
} from "../lib/brand-assets";

const read = (rel: string) =>
  fs.readFileSync(path.join(PUBLIC_DIR, rel), "utf8");

describe("text outlining", () => {
  let fonts: BrandFonts;
  beforeAll(async () => {
    fonts = await loadBrandFonts();
  });

  it("parses every typographic attribute of a <text> element", () => {
    const runs = parseTextRuns(
      `<svg><text x="256" y="373" text-anchor="middle" fill="#1177FF" font-family="Space Grotesk, Inter, Arial, sans-serif" font-size="82" font-weight="800" font-style="italic" letter-spacing="-3">Torch</text></svg>`,
    );
    expect(runs).toEqual([
      {
        text: "Torch",
        family: "space-grotesk",
        weight: 800,
        italic: true,
        fontSize: 82,
        letterSpacing: -3,
        x: 256,
        y: 373,
        anchor: "middle",
        fill: "#1177FF",
      },
    ]);
  });

  it("rejects fonts outside the brand pair", () => {
    expect(() =>
      parseTextRuns(`<svg><text font-family="Comic Sans">x</text></svg>`),
    ).toThrow(/Unsupported font-family/);
  });

  it("lays glyphs out from the anchor along the baseline", () => {
    const base = {
      text: "Grab",
      family: "space-grotesk" as const,
      weight: 650,
      italic: false,
      fontSize: 67,
      letterSpacing: -2.2,
      y: 128,
      anchor: "start" as const,
      fill: "#000",
    };
    const d = textRunToPathData({ ...base, x: 190 }, fonts["space-grotesk"]);
    const xs = Array.from(d.matchAll(/[MLQC]([\d.-]+) ([\d.-]+)/g), (m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    expect(xs.length).toBeGreaterThan(20);
    // Starts at the anchor, sits on the baseline, rises to roughly cap height.
    expect(Math.min(...xs.map((p) => p.x))).toBeGreaterThanOrEqual(189);
    expect(Math.min(...xs.map((p) => p.x))).toBeLessThan(200);
    expect(Math.max(...xs.map((p) => p.y))).toBeLessThanOrEqual(130);
    expect(Math.min(...xs.map((p) => p.y))).toBeGreaterThan(60);
    expect(Math.min(...xs.map((p) => p.y))).toBeLessThan(90);

    // A middle anchor centers the same word on x.
    const centered = textRunToPathData(
      { ...base, x: 300, anchor: "middle" },
      fonts["space-grotesk"],
    );
    const cx = Array.from(centered.matchAll(/[ML]([\d.-]+) /g), (m) =>
      Number(m[1]),
    );
    const mid = (Math.min(...cx) + Math.max(...cx)) / 2;
    expect(Math.abs(mid - 300)).toBeLessThan(4);
  });

  it("slants italic runs to the right", () => {
    const run = {
      text: "T",
      family: "space-grotesk" as const,
      weight: 800,
      italic: false,
      fontSize: 73,
      letterSpacing: 0,
      x: 0,
      y: 100,
      anchor: "start" as const,
      fill: "#000",
    };
    const upright = textRunToPathData(run, fonts["space-grotesk"]);
    const italic = textRunToPathData(
      { ...run, italic: true },
      fonts["space-grotesk"],
    );
    const maxX = (d: string) =>
      Math.max(
        ...Array.from(d.matchAll(/[ML]([\d.-]+) /g), (m) => Number(m[1])),
      );
    expect(maxX(italic)).toBeGreaterThan(maxX(upright));
  });

  it("replaces every <text> with a filled path and keeps the rest intact", () => {
    const source = fs.readFileSync(
      path.join(BRAND_SOURCE_DIR, "grab-your-torch-primary-dark.svg"),
      "utf8",
    );
    const outlined = outlineSvgText(source, fonts);
    expect(findLiveText(outlined)).toEqual([]);
    expect(outlined).toContain('<mask id="m">');
    expect(outlined).toContain('fill="#EAF8FF" d="M');
    expect(outlined).toContain('fill="#18D5F2" d="M');
    // Two text runs become two new paths; the emblem's own paths are untouched.
    const countPaths = (svg: string) => (svg.match(/<path\b/g) ?? []).length;
    expect(countPaths(outlined)).toBe(countPaths(source) + 2);
  });
});

describe("shipping brand assets", () => {
  it("exist for every declared output", () => {
    const missing = expectedPublicOutputs().filter(
      (rel) => !fs.existsSync(path.join(PUBLIC_DIR, rel)),
    );
    expect(missing).toEqual([]);
  });

  it("contain no live text or forbidden effects in any shipping SVG", () => {
    for (const out of SVG_OUTPUTS) {
      const svg = read(out.target);
      expect(findLiveText(svg), out.target).toEqual([]);
      expect(findForbiddenEffects(svg), out.target).toEqual([]);
      expect(svg.startsWith("<svg"), out.target).toBe(true);
    }
  });

  it("are exactly what a fresh render of docs/brand/source produces", async () => {
    const fonts = await loadBrandFonts();
    for (const out of SVG_OUTPUTS) {
      expect(read(out.target), out.target).toBe(renderSvgOutput(out, fonts));
    }
  });

  it("carry provenance on every outlined lockup", () => {
    for (const out of SVG_OUTPUTS.filter((o) => o.outline)) {
      expect(read(out.target)).toContain(
        `Generated from docs/brand/source/${out.source}`,
      );
    }
  });

  it("rasters match their declared dimensions", async () => {
    for (const out of RASTER_OUTPUTS) {
      const meta = await sharp(path.join(PUBLIC_DIR, out.target)).metadata();
      expect([meta.width, meta.height], out.target).toEqual([
        out.width,
        out.height,
      ]);
      if (out.background) {
        const stats = await sharp(path.join(PUBLIC_DIR, out.target)).stats();
        expect(stats.isOpaque, `${out.target} should be opaque`).toBe(true);
      }
    }
  });

  it("never ship docs-only reference material", () => {
    const publicFiles = fs.readdirSync(path.join(PUBLIC_DIR, "brand"), {
      recursive: true,
    }) as string[];
    for (const file of publicFiles) {
      expect(file).not.toMatch(/brand-board|concept-directions|\.zip$|prompt/i);
    }
  });
});

describe("platform metadata", () => {
  it("site.webmanifest matches the shared definition and its icons exist", async () => {
    const manifest = JSON.parse(read("site.webmanifest"));
    expect(manifest).toEqual(WEB_MANIFEST);
    for (const icon of manifest.icons) {
      const file = path.join(PUBLIC_DIR, icon.src.replace(/^\//, ""));
      expect(fs.existsSync(file), icon.src).toBe(true);
      const meta = await sharp(file).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
      expect(meta.format, icon.src).toBe(icon.type.replace("image/", ""));
    }
    expect(
      manifest.icons.some(
        (i: { purpose?: string }) => i.purpose === "maskable",
      ),
    ).toBe(true);
  });

  it("index.html references existing icons, manifest, and social image with metadata", () => {
    const html = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");
    const refs = referencedHeadAssets(html);
    expect(refs).toEqual(
      expect.arrayContaining([
        "/favicon.svg",
        "/favicon-32x32.png",
        "/favicon-16x16.png",
        "/apple-touch-icon.png",
        "/site.webmanifest",
        "/og-image.png",
      ]),
    );
    for (const ref of refs) {
      expect(
        fs.existsSync(path.join(PUBLIC_DIR, ref.replace(/^\//, ""))),
        ref,
      ).toBe(true);
    }
    expect(html).toMatch(/property="og:image:width"\s+content="1200"/);
    expect(html).toMatch(/property="og:image:height"\s+content="630"/);
    expect(html).toMatch(/property="og:image:alt"\s+content="[^"]{20,}"/);
    expect(html).toMatch(/name="twitter:image:alt"\s+content="[^"]{20,}"/);
    expect(html).toMatch(
      /name="theme-color"\s+content="#071D3A"\s+media="\(prefers-color-scheme: dark\)"/,
    );
  });
});

describe("brand package inventory", () => {
  it("docs/brand/README.md accounts for every supplied file exactly once", () => {
    const readme = fs.readFileSync(
      path.join(BRAND_DOCS_DIR, "README.md"),
      "utf8",
    );
    // Only the supplied package is inventoried; repo-authored docs are not.
    const files = listBrandDocsFiles().filter(
      (f) =>
        /^(source|reference|provenance|archive)\//.test(f) ||
        f === "brand-guidelines.md",
    );
    expect(files.length).toBeGreaterThan(25);
    for (const file of files) {
      const occurrences = readme.split("`" + file + "`").length - 1;
      expect(occurrences, file).toBe(1);
    }
  });

  it("keeps the untouched delivery package under docs/brand/source", () => {
    const sources = fs.readdirSync(BRAND_SOURCE_DIR);
    for (const out of SVG_OUTPUTS) expect(sources).toContain(out.source);
    expect(sources).toContain("grab-your-torch-favicon-16.svg");
    expect(sources).toContain("grab-your-torch-apple-touch-icon-180.svg");
  });
});
