/**
 * Repair `img: ""` entries in generated season data files.
 *
 * Two passes, in order:
 *
 *   1. On-disk match — an image is already downloaded but under a name the
 *      codegen merge could not match. `patch-player-images.ts` matches only
 *      `full_name`, so an image saved under the wiki page title (e.g.
 *      "Coach-Wade.jpg" for Benjamin Wade) is invisible to it. This pass also
 *      tries the wiki-resolved title, the castaway short name, and a surname
 *      match against unreferenced files in the season's image directory.
 *
 *   2. Wiki download — no image exists on disk for that castaway in that
 *      season, so fetch the season-correct one via the same resolver and
 *      download path `new-season` uses.
 *
 * Every season references only its own `public/images/season_<N>/` directory
 * (908 image references, zero cross-season), so this never points one season
 * at another season's file.
 *
 * Usage:
 *   yarn tsx scripts/fix-missing-player-images.ts [season_numbers...] [--dry-run] [--no-download]
 *     no season numbers = every season with a blank img
 */

import * as fs from "fs";
import * as path from "path";
import {
  downloadImage,
  fetchImageUrls,
  fetchWikitext,
  toThumbnailUrl,
} from "./lib/wiki-api.js";
import { resolveWikiPageTitle } from "./lib/wiki-name-resolver.js";
import { parseContestantPage } from "./lib/wikitext-parser.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

interface Blank {
  seasonNum: number;
  castawayId: string;
  fullName: string;
  castawayShortName?: string;
}

const IMAGE_RE = /\.(jpg|jpeg|png|webp)$/i;

function normalize(s: string): string {
  return s
    .replace(IMAGE_RE, "")
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9 ]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Collect every player with an empty img, across the requested seasons. */
function findBlanks(seasonNums: number[]): Blank[] {
  const blanks: Blank[] = [];
  for (const seasonNum of seasonNums) {
    const dataPath = path.join(
      projectRoot,
      "src",
      "data",
      `season_${seasonNum}`,
      "index.ts",
    );
    if (!fs.existsSync(dataPath)) continue;
    const content = fs.readFileSync(dataPath, "utf-8");
    for (const m of content.matchAll(/buildPlayer\(\{(.*?)\}\)/gs)) {
      const block = m[1];
      if (!/img:\s*""/.test(block)) continue;
      const castawayId = /castaway_id:\s*"([^"]+)"/.exec(block)?.[1];
      const fullName = /full_name:\s*"([^"]+)"/.exec(block)?.[1];
      if (!castawayId || !fullName) continue;
      blanks.push({ seasonNum, castawayId, fullName });
    }
  }
  return blanks;
}

/** Image files in a season dir that no player currently references. */
function unreferencedImages(seasonNum: number): string[] {
  const seasonKey = `season_${seasonNum}`;
  const imgDir = path.join(projectRoot, "public", "images", seasonKey);
  const dataPath = path.join(projectRoot, "src", "data", seasonKey, "index.ts");
  if (!fs.existsSync(imgDir) || !fs.existsSync(dataPath)) return [];
  const content = fs.readFileSync(dataPath, "utf-8");
  const referenced = new Set(
    [...content.matchAll(/img:\s*"([^"]+)"/g)].map((m) => path.basename(m[1])),
  );
  return fs
    .readdirSync(imgDir)
    .filter(
      (f) => IMAGE_RE.test(f) && !f.includes("logo") && !referenced.has(f),
    );
}

/** Pass 1: find an already-downloaded file this player plausibly owns. */
function matchOnDisk(blank: Blank): string | null {
  const candidates = unreferencedImages(blank.seasonNum);
  if (candidates.length === 0) return null;

  const wanted = normalize(blank.fullName);
  const parts = wanted.split(" ");
  const surname = parts[parts.length - 1];
  const forename = parts[0];

  // Seasons reference short "First-Last.jpg" names. Raw wiki originals
  // ("Survivor-50-Cast-Tiffany-Ervin.jpg") are downloaded alongside them but
  // never referenced, so prefer the conventional name and fall back to the
  // original only when it is the sole candidate.
  const isRawWikiOriginal = (f: string) => /^Survivor-\d+-Cast-/i.test(f);

  const pick = (list: string[]): string | null => {
    if (list.length === 0) return null;
    if (list.length > 1) {
      // Shortest normalized name is the least-decorated, most specific match.
      const sorted = [...list].sort(
        (a, b) => normalize(a).length - normalize(b).length,
      );
      if (normalize(sorted[0]).length === normalize(sorted[1]).length) {
        return null; // genuinely ambiguous
      }
      return sorted[0];
    }
    return list[0];
  };

  // Run the whole ladder over conventional names first, so a raw original is
  // never chosen while a conventionally-named file for the same player exists
  // further down the ladder.
  const search = (pool: string[]): string | null => {
    const exact = pool.find((f) => normalize(f) === wanted);
    if (exact) return exact;
    const both = pick(
      pool.filter((f) => {
        const n = normalize(f);
        return n.includes(surname) && n.includes(forename);
      }),
    );
    if (both) return both;
    return pick(pool.filter((f) => normalize(f).includes(surname)));
  };

  return (
    search(candidates.filter((f) => !isRawWikiOriginal(f))) ??
    search(candidates)
  );
}

/** Pass 2: resolve the wiki page and download the season-correct image. */
async function downloadFromWiki(blank: Blank): Promise<string | null> {
  const seasonKey = `season_${blank.seasonNum}`;
  const resolution = await resolveWikiPageTitle(
    {
      wikiPageTitle: blank.fullName,
      localName: blank.fullName,
      castawayShortName: blank.castawayShortName,
    } as Parameters<typeof resolveWikiPageTitle>[0],
    fetchWikitext,
  );
  if (!resolution) {
    console.warn(`    could not resolve a wiki page for ${blank.fullName}`);
    return null;
  }

  const info = parseContestantPage(resolution.wikitext, blank.seasonNum);
  if (!info?.imageFileName) {
    console.warn(
      `    no infobox image for "${resolution.title}" in season ${blank.seasonNum}`,
    );
    return null;
  }

  const urls = await fetchImageUrls([info.imageFileName]);
  const url = urls.get(info.imageFileName);
  if (!url) {
    console.warn(`    could not resolve an image URL for ${blank.fullName}`);
    return null;
  }

  const thumbUrl = toThumbnailUrl(url);
  const localFileName = blank.fullName.replace(/\s+/g, "-") + ".jpg";
  const imgDir = path.join(projectRoot, "public", "images", seasonKey);
  fs.mkdirSync(imgDir, { recursive: true });

  const ok = await downloadImage(thumbUrl, path.join(imgDir, localFileName));
  if (!ok) {
    console.warn(`    download failed for ${blank.fullName}`);
    return null;
  }
  return localFileName;
}

/** Write the resolved filename into the season data file. */
function patchDataFile(blank: Blank, fileName: string, dryRun: boolean): void {
  const seasonKey = `season_${blank.seasonNum}`;
  const dataPath = path.join(projectRoot, "src", "data", seasonKey, "index.ts");
  const content = fs.readFileSync(dataPath, "utf-8");
  const imgPath = `/images/${seasonKey}/${fileName}`;

  // Anchor on castaway_id so we patch exactly this player, even when two
  // players in a season share a surname.
  const re = new RegExp(
    `(castaway_id:\\s*"${blank.castawayId}",[\\s\\S]{0,400}?img:\\s*)""`,
  );
  if (!re.test(content)) {
    console.warn(`    could not locate ${blank.castawayId} in ${dataPath}`);
    return;
  }
  if (dryRun) return;
  fs.writeFileSync(dataPath, content.replace(re, `$1"${imgPath}"`));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const noDownload = args.includes("--no-download");
  const requested = args.filter((a) => /^\d+$/.test(a)).map(Number);

  const allSeasons = requested.length
    ? requested
    : fs
        .readdirSync(path.join(projectRoot, "src", "data"))
        .map((d) => /^season_(\d+)$/.exec(d)?.[1])
        .filter((n): n is string => Boolean(n))
        .map(Number)
        .sort((a, b) => a - b);

  const blanks = findBlanks(allSeasons);
  if (blanks.length === 0) {
    console.log("No blank img fields found.");
    return;
  }

  console.log(`Found ${blanks.length} blank img field(s)\n`);
  let fromDisk = 0;
  let fromWiki = 0;
  const unresolved: Blank[] = [];

  for (const blank of blanks) {
    console.log(`S${blank.seasonNum} ${blank.castawayId} ${blank.fullName}`);

    const onDisk = matchOnDisk(blank);
    if (onDisk) {
      console.log(`    on disk: ${onDisk}`);
      patchDataFile(blank, onDisk, dryRun);
      fromDisk++;
      continue;
    }

    if (noDownload) {
      unresolved.push(blank);
      console.log(`    no local match (download skipped)`);
      continue;
    }

    const downloaded = await downloadFromWiki(blank);
    if (downloaded) {
      console.log(`    downloaded: ${downloaded}`);
      if (!dryRun) patchDataFile(blank, downloaded, dryRun);
      fromWiki++;
    } else {
      unresolved.push(blank);
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}matched on disk: ${fromDisk}, downloaded: ${fromWiki}, unresolved: ${unresolved.length}`,
  );
  for (const b of unresolved) {
    console.log(`  UNRESOLVED S${b.seasonNum} ${b.fullName}`);
  }
  if (unresolved.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("fix-missing-player-images failed:", err);
  process.exit(1);
});
