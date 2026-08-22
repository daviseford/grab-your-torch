/**
 * Produce every shipping Victory Flame asset from the untouched brand package
 * in docs/brand/source.
 *
 *   yarn tsx scripts/generate-web-assets.ts            # generate + validate
 *   yarn tsx scripts/generate-web-assets.ts --check    # validate only
 *
 * What it does:
 *   1. Outlines the wordmark in every lockup SVG (Space Grotesk / Inter glyphs
 *      become paths) so `<img>`-embedded logos render identically on every
 *      device, then writes the vectors under public/brand and public/favicon.svg.
 *   2. Rasterizes PNG exports, favicons, the Apple touch icon, manifest icons,
 *      and the Open Graph image with Sharp at exact pixel sizes.
 *   3. Writes public/site.webmanifest from the shared manifest definition.
 *   4. Validates the result: expected files, dimensions, no live `<text>` or
 *      forbidden effects in shipping SVGs, manifest and index.html references.
 *
 * The docs/brand tree (source, reference, provenance, archive) is read-only
 * input and is never copied into public/.
 */
import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  BRAND_SOURCE_DIR,
  compactSvg,
  expectedPublicOutputs,
  findForbiddenEffects,
  findLiveText,
  loadBrandFonts,
  outlineSvgText,
  PUBLIC_DIR,
  RASTER_OUTPUTS,
  referencedHeadAssets,
  REPO_ROOT,
  stampProvenance,
  SVG_OUTPUTS,
  WEB_MANIFEST,
  type RasterOutput,
} from "./lib/brand-assets";

const checkOnly = process.argv.includes("--check");

function publicPath(rel: string): string {
  return path.join(PUBLIC_DIR, rel);
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function viewBoxOf(svg: string): { width: number; height: number } {
  const m = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (!m) throw new Error("SVG has no viewBox");
  const [, , w, h] = m[1].trim().split(/\s+/).map(Number);
  return { width: w, height: h };
}

async function generateSvgs(): Promise<void> {
  const fonts = await loadBrandFonts();
  for (const out of SVG_OUTPUTS) {
    const source = fs.readFileSync(
      path.join(BRAND_SOURCE_DIR, out.source),
      "utf8",
    );
    let svg = source;
    if (out.outline) {
      svg = stampProvenance(outlineSvgText(source, fonts), out.source);
    }
    const target = publicPath(out.target);
    ensureDir(target);
    fs.writeFileSync(target, compactSvg(svg) + "\n");
    console.log(`✓ ${out.target}${out.outline ? " (outlined)" : ""}`);
  }
}

async function renderRaster(out: RasterOutput): Promise<void> {
  const svgPath =
    "public" in out.from
      ? publicPath(out.from.public)
      : path.join(BRAND_SOURCE_DIR, out.from.source);
  const svg = fs.readFileSync(svgPath, "utf8");
  const box = viewBoxOf(svg);
  const target = publicPath(out.target);
  ensureDir(target);

  if (out.maskableSafeZone) {
    // Maskable icons are cropped to arbitrary platform shapes, so the
    // artwork sits inside the safe zone on a full-bleed brand field.
    const inner = Math.round(out.height * out.maskableSafeZone);
    const innerWidth = Math.round((inner * box.width) / box.height);
    const art = await sharp(Buffer.from(svg), {
      density: (72 * inner) / box.height,
    })
      .resize(innerWidth, inner)
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: out.width,
        height: out.height,
        channels: 4,
        background: out.background ?? "#00000000",
      },
    })
      .composite([
        {
          input: art,
          left: Math.round((out.width - innerWidth) / 2),
          top: Math.round((out.height - inner) / 2),
        },
      ])
      .png()
      .toFile(target);
  } else {
    let image = sharp(Buffer.from(svg), {
      density: (72 * out.width) / box.width,
    }).resize(out.width, out.height);
    if (out.background) image = image.flatten({ background: out.background });
    await image.png().toFile(target);
  }
  console.log(`✓ ${out.target} (${out.width}×${out.height})`);
}

function writeManifest(): void {
  const target = publicPath("site.webmanifest");
  fs.writeFileSync(target, JSON.stringify(WEB_MANIFEST, null, 2) + "\n");
  console.log("✓ site.webmanifest");
}

async function validate(): Promise<string[]> {
  const problems: string[] = [];

  for (const rel of expectedPublicOutputs()) {
    if (!fs.existsSync(publicPath(rel))) problems.push(`missing ${rel}`);
  }

  for (const out of SVG_OUTPUTS) {
    const file = publicPath(out.target);
    if (!fs.existsSync(file)) continue;
    const svg = fs.readFileSync(file, "utf8");
    const live = findLiveText(svg);
    if (live.length) {
      problems.push(
        `${out.target} still contains live text: ${live.join(", ")}`,
      );
    }
    const effects = findForbiddenEffects(svg);
    if (effects.length) {
      problems.push(
        `${out.target} uses forbidden effects: ${effects.join(", ")}`,
      );
    }
  }

  for (const out of RASTER_OUTPUTS) {
    const file = publicPath(out.target);
    if (!fs.existsSync(file)) continue;
    const meta = await sharp(file).metadata();
    if (meta.width !== out.width || meta.height !== out.height) {
      problems.push(
        `${out.target} is ${meta.width}×${meta.height}, expected ${out.width}×${out.height}`,
      );
    }
    if (out.background && meta.hasAlpha) {
      const stats = await sharp(file).stats();
      if (!stats.isOpaque) problems.push(`${out.target} should be opaque`);
    }
  }

  const manifest = JSON.parse(
    fs.readFileSync(publicPath("site.webmanifest"), "utf8"),
  ) as typeof WEB_MANIFEST;
  for (const icon of manifest.icons) {
    const file = publicPath(icon.src.replace(/^\//, ""));
    if (!fs.existsSync(file)) {
      problems.push(`manifest icon ${icon.src} does not exist`);
      continue;
    }
    const meta = await sharp(file).metadata();
    if (`${meta.width}x${meta.height}` !== icon.sizes) {
      problems.push(
        `manifest icon ${icon.src} is ${meta.width}x${meta.height}, declared ${icon.sizes}`,
      );
    }
  }

  const html = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");
  for (const ref of referencedHeadAssets(html)) {
    if (!fs.existsSync(publicPath(ref.replace(/^\//, "")))) {
      problems.push(`index.html references missing asset ${ref}`);
    }
  }

  return problems;
}

async function main(): Promise<void> {
  if (!checkOnly) {
    await generateSvgs();
    for (const out of RASTER_OUTPUTS) await renderRaster(out);
    writeManifest();
  }
  const problems = await validate();
  if (problems.length) {
    console.error("\nAsset validation failed:");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(
    `\nAll ${expectedPublicOutputs().length} brand assets ${checkOnly ? "validated" : "generated and validated"} in public/`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
