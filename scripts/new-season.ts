/**
 * Season Bootstrap CLI — one command to scaffold a complete season.
 *
 * Usage: yarn new-season <N> [--push] [--force] [--dry-run] [--wiki-cast]
 *
 * Steps:
 *   1. Fetch player data from survivoR dataset
 *      (--wiki-cast: when survivoR has no castaways yet, read the announced
 *      cast from the Survivor Wiki with provisional castaway_ids)
 *   2. Transform survivoR data
 *   3. Fetch player images and bios from wiki (supplemental)
 *   4. Generate full season data file
 *   5. Fetch season logo and info from wiki
 *   6. Register season in src/data/seasons.ts
 *   7. (optional) Push to Firestore with --push
 */

import * as fs from "fs";
import * as path from "path";
import { generateFullSeasonFile, registerSeason } from "./lib/codegen.js";
import { pushSeasonToFirestore } from "./lib/firebase-push.js";
import { fetchSeasonData, fetchTable } from "./lib/survivor-client.js";
import {
  transformPlayers,
  transformResults,
} from "./lib/survivor-transformer.js";
import type { SurvivorCastaway } from "./lib/survivor-types.js";
import {
  downloadImage,
  fetchImageUrl,
  fetchWikitext,
  getSeasonPageName,
} from "./lib/wiki-api.js";
import {
  buildProvisionalCastaways,
  fetchWikiCast,
  nextCastawayId,
} from "./lib/wiki-cast.js";
import { fetchWikiSupplemental } from "./lib/wiki-supplemental.js";
import { parseSeasonInfobox } from "./lib/wikitext-parser.js";

const TOTAL_STEPS = 7;
const SEPARATOR = "=".repeat(60);

function logStep(step: number, message: string): void {
  console.log(`\n${SEPARATOR}`);
  console.log(`Step ${step}/${TOTAL_STEPS}: ${message}`);
  console.log(SEPARATOR);
}

/**
 * Download the season logo, trying the infobox first, then common filename fallbacks.
 * Returns the local public path (e.g. "/images/season_51/season-51-logo.png") or "".
 */
async function fetchSeasonLogo(
  wikitext: string | null,
  seasonNum: number,
  projectRoot: string,
): Promise<string> {
  const seasonKey = `season_${seasonNum}`;
  const imgDirPath = path.join(projectRoot, "public", "images", seasonKey);

  async function tryDownload(
    url: string,
    label: string,
  ): Promise<string | null> {
    const ext = path.extname(new URL(url).pathname) || ".png";
    const logoFileName = `season-${seasonNum}-logo${ext}`;
    const destPath = path.join(imgDirPath, logoFileName);
    const ok = await downloadImage(url, destPath);
    if (ok) {
      const localPath = `/images/${seasonKey}/${logoFileName}`;
      console.log(`  Downloaded logo${label}: ${localPath}`);
      return localPath;
    }
    return null;
  }

  // Try extracting from infobox
  if (wikitext) {
    const fieldMatch = wikitext.match(
      /\|\s*(?:image|logo)\s*=\s*([\s\S]*?)(?=\n\s*\||\n\}\})/i,
    );
    const fileMatch = fieldMatch?.[1]?.match(/\[\[File:([^\]|]+)/i);
    if (fileMatch) {
      const logoUrl = await fetchImageUrl(fileMatch[1].trim());
      if (logoUrl) {
        const result = await tryDownload(logoUrl, "");
        if (result) return result;
        console.log(`  Found logo URL but download failed`);
      }
    }
  }

  // Fallback: try common filename patterns
  const fallbackCandidates = [
    `US S${seasonNum} logo.png`,
    `Survivor ${seasonNum} Logo.png`,
  ];
  for (const candidate of fallbackCandidates) {
    const url = await fetchImageUrl(candidate);
    if (url) {
      const result = await tryDownload(url, " (fallback)");
      if (result) return result;
    }
  }

  console.log(`  No logo found — img will be empty`);
  return "";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));

  const seasonNum = Number(positional[0]);
  const force = flags.has("--force");
  const push = flags.has("--push");
  const dryRun = flags.has("--dry-run");
  const wikiCast = flags.has("--wiki-cast");

  if (!seasonNum || isNaN(seasonNum)) {
    console.error(
      "Usage: yarn new-season <season_number> [--push] [--force] [--dry-run] [--wiki-cast]",
    );
    console.error("Example: yarn new-season 51");
    process.exit(1);
  }

  const projectRoot = path.resolve(import.meta.dirname, "..");
  const seasonKey = `season_${seasonNum}`;
  const outputDir = path.join(projectRoot, "src", "data", seasonKey);
  const outputPath = path.join(outputDir, "index.ts");
  const seasonsFilePath = path.join(projectRoot, "src", "data", "seasons.ts");

  if (fs.existsSync(outputPath) && !force) {
    console.error(`Season data file already exists: ${outputPath}`);
    console.error(`Use --force to overwrite.`);
    process.exit(1);
  }

  // Step 1
  logStep(1, `Fetching survivoR data for Season ${seasonNum}`);
  const seasonData = await fetchSeasonData(seasonNum);

  let provisionalCast = false;
  if (seasonData.castaways.length === 0) {
    if (!wikiCast) {
      console.error(
        `\nsurvivoR has no castaways for Season ${seasonNum}. If CBS has announced the cast, rerun with --wiki-cast to bootstrap it from the Survivor Wiki with provisional castaway_ids.`,
      );
      process.exit(1);
    }

    console.log(
      `  Falling back to the Survivor Wiki cast table (provisional castaway_ids)...`,
    );
    const cast = await fetchWikiCast(seasonNum);
    if (cast.length === 0) {
      console.error(
        `\nNo castaways found on the wiki page "${getSeasonPageName(seasonNum)}" either. Nothing to bootstrap.`,
      );
      process.exit(1);
    }

    // survivoR numbers new castaways sequentially, alphabetically by
    // full_name; returning players keep the id they already have.
    const allCastaways = await fetchTable<SurvivorCastaway>("castaways");
    const knownIds = new Map(
      allCastaways
        .filter((c) => c.version === "US")
        .map((c) => [c.full_name, c.castaway_id] as const),
    );
    const firstId = nextCastawayId(knownIds.values());
    seasonData.castaways = buildProvisionalCastaways(
      cast,
      seasonNum,
      firstId,
      knownIds,
    );
    provisionalCast = true;

    console.log(
      `  Wiki cast: ${cast.length} castaways, provisional ids from ${firstId}`,
    );
    for (const c of seasonData.castaways) {
      const source = knownIds.has(c.full_name) ? "returning" : "provisional";
      console.log(`    ${c.castaway_id}  ${c.full_name.padEnd(28)} ${source}`);
    }
  }

  // Step 2
  logStep(2, "Transforming survivoR data");
  const playerData = transformPlayers(seasonData, seasonNum);
  const resultsData = transformResults(seasonData, seasonNum);

  // Step 3
  logStep(3, "Fetching player images and bios from wiki");
  await fetchWikiSupplemental(playerData.players, seasonNum, projectRoot);

  // Step 4
  logStep(4, "Generating season data file");
  let fileContent = generateFullSeasonFile(
    playerData,
    resultsData,
    seasonNum,
    outputPath,
  );
  if (provisionalCast) {
    fileContent =
      `// Cast bootstrapped from the Survivor Wiki before survivoR published this\n` +
      `// season. castaway_ids are PROVISIONAL: predicted from survivoR's numbering\n` +
      `// convention (sequential after the last id, alphabetical by full_name).\n` +
      `// scripts/sync-season.ts refuses to regenerate this file if survivoR's real\n` +
      `// ids differ, so any mismatch surfaces as a failed sync, not a silent swap.\n` +
      fileContent;
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, fileContent);
  console.log(`  Created: ${outputPath}`);

  // Step 5
  logStep(5, "Fetching season logo and info from wiki");
  const seasonWikitext = await fetchWikitext(getSeasonPageName(seasonNum));

  if (seasonWikitext) {
    const seasonInfo = parseSeasonInfobox(seasonWikitext);
    if (seasonInfo) {
      if (seasonInfo.location)
        console.log(`  Location: ${seasonInfo.location}`);
      if (seasonInfo.filmingDates)
        console.log(`  Filming: ${seasonInfo.filmingDates}`);
      if (seasonInfo.seasonRun) console.log(`  Aired: ${seasonInfo.seasonRun}`);
    } else {
      console.log(`  No {{Season}} infobox found on wiki page`);
    }
  }

  const localLogoPath = await fetchSeasonLogo(
    seasonWikitext,
    seasonNum,
    projectRoot,
  );

  // Step 6
  logStep(6, "Registering season in seasons.ts");
  registerSeason(seasonNum, seasonsFilePath, localLogoPath);

  // Step 7 (optional)
  if (push) {
    logStep(7, "Pushing to Firestore");
    await pushSeasonToFirestore(seasonNum, dryRun, localLogoPath);
  } else {
    console.log(`\n  Skipping Firestore push (use --push to enable)`);
  }

  // Summary
  console.log(`\n${SEPARATOR}`);
  console.log(`Season ${seasonNum} bootstrap complete!`);
  console.log(SEPARATOR);
  console.log(`  Players: ${playerData.players.length}`);
  console.log(`  Episodes: ${resultsData.episodes.length}`);
  console.log(`  Challenges: ${resultsData.challenges.length}`);
  console.log(`  Eliminations: ${resultsData.eliminations.length}`);
  console.log(`  Events: ${resultsData.events.length}`);
  console.log(`  Vote history: ${resultsData.voteHistory.length}`);
  if (resultsData.warnings.length > 0) {
    console.log(`  Warnings: ${resultsData.warnings.length}`);
  }
  console.log(`\nNext steps:`);
  console.log(`  1. Run 'yarn format' and 'yarn tsc' to verify`);
  console.log(`  2. Review generated file at ${outputPath}`);
  if (!push) {
    console.log(
      `  3. Run 'yarn new-season ${seasonNum} --push' to upload to Firestore`,
    );
  }
}

main().catch((err) => {
  console.error("\nSeason bootstrap failed:", err);
  process.exit(1);
});
