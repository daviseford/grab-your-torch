/**
 * Replace returning players' photos with the season-correct one from the wiki.
 *
 * A returning contestant's wiki infobox lists one image per season, most
 * recent first (`<tabber>Winners at War=[[File:S40 Tony Vlachos.jpg]]|-|
 * Cagayan=[[File:S28 Tony Vlachos.jpg]]</tabber>`). The image downloader used
 * to take the first entry, so every season a player appeared in ended up
 * with a byte-identical copy of their most recent photo. This script walks
 * every castaway_id that appears in more than one season data file under
 * `src/data/` and, for each season, downloads the entry labelled `S<N>`.
 *
 * A file is only overwritten when the wiki has an image explicitly labelled
 * for that season and its bytes differ from what is on disk. Pairs with no
 * season-specific wiki image keep their existing file and are reported.
 *
 * Downloads use the same 400px-wide wiki thumbnail as every other player image
 * in `public/images/`, so no post-processing is needed.
 *
 * Usage:
 *   yarn tsx scripts/fix-returning-player-images.ts [season_numbers...] [--dry-run]
 *     no season numbers = every season a returning player appears in
 */

import * as fs from "fs";
import * as path from "path";
import {
  delay,
  fetchImageBytes,
  fetchImageUrls,
  fetchWikitext,
  toThumbnailUrl,
} from "./lib/wiki-api.js";
import { resolveWikiPageTitle } from "./lib/wiki-name-resolver.js";
import { parseContestantPage } from "./lib/wikitext-parser.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

/** One castaway in one season, as declared in that season's data file. */
interface Appearance {
  seasonNum: number;
  castawayId: string;
  fullName: string;
  castawayShortName?: string;
  /** Local image path as referenced by the data file, e.g. "/images/season_28/Tony-Vlachos.jpg" */
  img: string;
}

type Outcome =
  | { kind: "replaced"; wikiFile: string }
  | { kind: "unchanged"; wikiFile: string }
  | { kind: "unresolved"; reason: string };

/** Read every player appearance from the local season data files. */
function loadAppearances(): Appearance[] {
  const dataDir = path.join(projectRoot, "src", "data");
  const appearances: Appearance[] = [];

  for (const dir of fs.readdirSync(dataDir)) {
    const seasonNum = Number(/^season_(\d+)$/.exec(dir)?.[1]);
    if (!seasonNum) continue;
    const content = fs.readFileSync(
      path.join(dataDir, dir, "index.ts"),
      "utf-8",
    );

    const shortNames = new Map<string, string>();
    for (const m of content.matchAll(
      /^\s*(US\d+):\s*\{\s*full_name:\s*"[^"]+",\s*castaway:\s*"([^"]+)"/gm,
    )) {
      shortNames.set(m[1], m[2]);
    }

    for (const m of content.matchAll(/buildPlayer\(\{(.*?)\}\)/gs)) {
      const block = m[1];
      const castawayId = /castaway_id:\s*"([^"]+)"/.exec(block)?.[1];
      const fullName = /full_name:\s*"([^"]+)"/.exec(block)?.[1];
      const img = /img:\s*"([^"]*)"/.exec(block)?.[1];
      if (!castawayId || !fullName || img === undefined) continue;
      appearances.push({
        seasonNum,
        castawayId,
        fullName,
        castawayShortName: shortNames.get(castawayId),
        img,
      });
    }
  }

  return appearances.sort((a, b) => a.seasonNum - b.seasonNum);
}

/** Group appearances by castaway, keeping only players seen in 2+ seasons. */
function groupReturningPlayers(
  appearances: Appearance[],
): Map<string, Appearance[]> {
  const byCastaway = new Map<string, Appearance[]>();
  for (const a of appearances) {
    const list = byCastaway.get(a.castawayId) ?? [];
    list.push(a);
    byCastaway.set(a.castawayId, list);
  }
  for (const [id, list] of byCastaway) {
    if (list.length < 2) byCastaway.delete(id);
  }
  return byCastaway;
}

/**
 * Resolve the wiki page for a castaway. Names occasionally change between
 * seasons (e.g. "Amber Brkich" then "Amber Mariano"), so try the most recent
 * appearance's name first and fall back to the earlier ones.
 */
async function resolveWikitext(
  group: Appearance[],
): Promise<{ title: string; wikitext: string } | null> {
  const tried = new Set<string>();
  for (const a of [...group].reverse()) {
    if (tried.has(a.fullName)) continue;
    tried.add(a.fullName);
    const resolution = await resolveWikiPageTitle(
      {
        wikiPageTitle: a.fullName,
        localName: a.fullName,
        castawayShortName: a.castawayShortName,
      } as Parameters<typeof resolveWikiPageTitle>[0],
      fetchWikitext,
    );
    if (resolution) return resolution;
  }
  return null;
}

function localImagePath(a: Appearance): string {
  return path.join(projectRoot, "public", a.img);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const requested = new Set(args.filter((a) => /^\d+$/.test(a)).map(Number));

  const groups = groupReturningPlayers(loadAppearances());
  const pairs = [...groups.values()]
    .flat()
    .filter((a) => requested.size === 0 || requested.has(a.seasonNum));

  console.log(
    `Found ${groups.size} returning castaway(s), ${pairs.length} castaway/season pair(s) to check${
      dryRun ? " [DRY RUN]" : ""
    }\n`,
  );

  // Phase 1: resolve each castaway's wiki page once and work out which wiki
  // file each season should use.
  const wanted = new Map<Appearance, string>(); // appearance -> wiki file name
  const outcomes = new Map<Appearance, Outcome>();

  for (const [castawayId, group] of groups) {
    const targets = group.filter(
      (a) => requested.size === 0 || requested.has(a.seasonNum),
    );
    if (targets.length === 0) continue;

    const label = `${castawayId} ${group[group.length - 1].fullName}`;
    const resolution = await resolveWikitext(group);
    if (!resolution) {
      for (const a of targets) {
        outcomes.set(a, {
          kind: "unresolved",
          reason: "could not resolve a wiki page",
        });
      }
      console.log(`${label}: could not resolve a wiki page`);
      continue;
    }

    for (const a of targets) {
      if (!a.img) {
        outcomes.set(a, {
          kind: "unresolved",
          reason: "img is blank (run fix-missing-player-images first)",
        });
        continue;
      }
      const info = parseContestantPage(resolution.wikitext, a.seasonNum);
      if (!info?.imageFileName || !info.imageIsSeasonSpecific) {
        outcomes.set(a, {
          kind: "unresolved",
          reason: `no S${a.seasonNum} image on wiki page "${resolution.title}"`,
        });
        continue;
      }
      wanted.set(a, info.imageFileName);
    }
    await delay(100);
  }

  // Phase 2: resolve CDN URLs in batches, then download and compare.
  const fileNames = [...new Set(wanted.values())];
  const urls = await fetchImageUrls(fileNames);

  for (const [a, wikiFile] of wanted) {
    const url = urls.get(wikiFile);
    if (!url) {
      outcomes.set(a, {
        kind: "unresolved",
        reason: `wiki has no file "${wikiFile}"`,
      });
      continue;
    }

    const bytes = await fetchImageBytes(toThumbnailUrl(url));
    if (!bytes) {
      outcomes.set(a, {
        kind: "unresolved",
        reason: `download failed for "${wikiFile}"`,
      });
      continue;
    }

    const dest = localImagePath(a);
    const existing = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    if (existing && existing.equals(bytes)) {
      outcomes.set(a, { kind: "unchanged", wikiFile });
      continue;
    }

    if (!dryRun) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
    }
    outcomes.set(a, { kind: "replaced", wikiFile });
    await delay(100);
  }

  // Report
  let replaced = 0;
  let unchanged = 0;
  const unresolved: Appearance[] = [];
  const sorted = [...outcomes.entries()].sort(
    ([a], [b]) =>
      a.castawayId.localeCompare(b.castawayId) || a.seasonNum - b.seasonNum,
  );
  for (const [a, outcome] of sorted) {
    const prefix = `S${String(a.seasonNum).padStart(2)} ${a.castawayId} ${a.fullName}`;
    switch (outcome.kind) {
      case "replaced":
        replaced++;
        console.log(
          `${prefix}: ${dryRun ? "would replace" : "replaced"} with ${outcome.wikiFile}`,
        );
        break;
      case "unchanged":
        unchanged++;
        console.log(`${prefix}: already ${outcome.wikiFile}`);
        break;
      case "unresolved":
        unresolved.push(a);
        console.log(`${prefix}: KEPT (${outcome.reason})`);
        break;
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}${dryRun ? "would replace" : "replaced"}: ${replaced}, already correct: ${unchanged}, unresolved (kept existing file): ${unresolved.length}`,
  );
  for (const a of unresolved) {
    const outcome = outcomes.get(a);
    const reason = outcome?.kind === "unresolved" ? outcome.reason : "";
    console.log(`  UNRESOLVED S${a.seasonNum} ${a.fullName}: ${reason}`);
  }
}

main().catch((err) => {
  console.error("fix-returning-player-images failed:", err);
  process.exit(1);
});
