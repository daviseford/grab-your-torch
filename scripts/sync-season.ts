/**
 * Automated season data sync for CI.
 *
 * Detects new seasons in survivoR, syncs episode/challenge/elimination/event
 * data for the active season, validates, pushes to Firestore, and writes
 * a structured result file for the GitHub Actions workflow to consume.
 *
 * An episode newer than the committed bundle is imported only once survivoR
 * has every scoring input it can be checked for (lib/episode-readiness.ts).
 * Until then the run holds: it writes and pushes nothing and reports the gap.
 *
 * Usage: yarn tsx scripts/sync-season.ts [--no-push] [--ref <commit>]
 *   --no-push  write the season file only; publication happens after review
 *              (scripts/publish-season.ts, run by the survivoR observer)
 *   --ref      read every survivoR table at this upstream commit, not master
 */

import * as fs from "fs";
import * as path from "path";
import {
  extractExistingCastawayLookup,
  registerSeason,
} from "./lib/codegen.js";
import {
  holdUnconfirmedRenames,
  regenerateSeasonFile,
} from "./lib/curated-cast.js";
import {
  assessNewEpisodes,
  heldReasons,
  type EpisodeReadiness,
} from "./lib/episode-readiness.js";
import { planSeasonFileWrite } from "./lib/season-file-change.js";
import { readLocalSeasonImg } from "./lib/season-img.js";
import {
  fetchSeasonData,
  fetchTable,
  filterBySeason,
} from "./lib/survivor-client.js";
import {
  transformPlayers,
  transformResults,
} from "./lib/survivor-transformer.js";
import type {
  SurvivorCastaway,
  SurvivorCastawayDetails,
  SurvivorChallengeDescription,
} from "./lib/survivor-types.js";
import { validateSeasonData } from "./lib/validate-season.js";

interface SyncResult {
  changed: boolean;
  /**
   * Set only when the regenerated file was compared with the committed one
   * and matched. `changed: false` alone can also mean "nothing to read".
   */
  unchanged?: boolean;
  seasonNum: number;
  isNewSeason: boolean;
  error?: string;
  firestorePushed?: boolean;
  /** The survivoR commit read, when --ref pinned one. */
  upstreamRef?: string;
  /** Newer episodes survivoR has only partly published; nothing was written. */
  held?: string[];
  /** Readiness of each episode this import adds; all complete when written. */
  newEpisodes?: Pick<
    EpisodeReadiness,
    "episodeNum" | "status" | "waived" | "reviewNotes" | "counts"
  >[];
  summary?: {
    episodes: number;
    challenges: number;
    eliminations: number;
    events: number;
    voteHistory: number;
  };
  warnings?: string[];
}

function writeResult(resultPath: string, result: SyncResult): void {
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
}

/**
 * Parse registered season numbers from src/data/seasons.ts.
 */
function getRegisteredSeasons(seasonsFilePath: string): number[] {
  const content = fs.readFileSync(seasonsFilePath, "utf-8");
  const matches = [...content.matchAll(/season_(\d+):/g)];
  return matches.map((m) => Number(m[1]));
}

/**
 * Count episodes in season file content by matching episode object entries.
 * Uses a pattern that only matches the episode definition (not episode_id refs).
 */
function countEpisodes(content: string): number {
  const matches = content.match(/^\s+id: "episode_\d+",$/gm);
  return matches?.length ?? 0;
}

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const RESULT_PATH = path.join(PROJECT_ROOT, "sync-result.json");

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const noPush = process.argv.includes("--no-push");
  const ref = argValue("--ref");
  if (ref !== undefined && !/^[0-9a-f]{40}$/.test(ref)) {
    throw new Error(`--ref must be a full survivoR commit SHA, got "${ref}"`);
  }
  const seasonsFilePath = path.join(PROJECT_ROOT, "src", "data", "seasons.ts");

  // Phase 1: Detect — find active season and check for new seasons
  console.log("Phase 1: Detecting active season...");

  if (ref) console.log(`  Reading survivoR at commit ${ref}`);
  const allCastaways = await fetchTable<SurvivorCastaway>("castaways", ref);
  const usCastaways = allCastaways.filter((c) => c.version === "US");
  const survivorSeasons = [...new Set(usCastaways.map((c) => c.season))].sort(
    (a, b) => a - b,
  );
  const registeredSeasons = getRegisteredSeasons(seasonsFilePath);
  const highestRegistered = Math.max(...registeredSeasons);
  const highestInSurvivor = Math.max(...survivorSeasons);

  console.log(
    `  Registered seasons: ${registeredSeasons.sort((a, b) => a - b).join(", ")}`,
  );
  console.log(`  survivoR seasons: ${survivorSeasons.join(", ")}`);

  const isNewSeason = highestInSurvivor > highestRegistered;
  const seasonNum = isNewSeason ? highestInSurvivor : highestRegistered;

  if (isNewSeason) {
    console.log(`  New season detected: ${seasonNum} (not yet registered)`);
  } else {
    console.log(`  Syncing highest registered season: ${seasonNum}`);
  }

  // Phase 2: Fetch + Generate
  console.log(`\nPhase 2: Fetching survivoR data for season ${seasonNum}...`);

  const seasonData = await fetchSeasonData(seasonNum, ref);
  if (seasonData.castaways.length === 0) {
    const result: SyncResult = {
      changed: false,
      seasonNum,
      isNewSeason,
      warnings: [`No castaways found in survivoR for season ${seasonNum}`],
    };
    writeResult(RESULT_PATH, result);
    console.log(`  No castaways found — nothing to sync.`);
    return;
  }

  const seasonKey = `season_${seasonNum}`;
  const seasonDir = path.join(PROJECT_ROOT, "src", "data", seasonKey);
  const seasonFilePath = path.join(seasonDir, "index.ts");
  const existingContent = fs.existsSync(seasonFilePath)
    ? fs.readFileSync(seasonFilePath, "utf-8")
    : undefined;

  // A committed name changes only when survivoR's person table agrees.
  let renameNotes: string[] = [];
  if (existingContent !== undefined) {
    const held = holdUnconfirmedRenames(
      seasonData.castaways,
      extractExistingCastawayLookup(existingContent),
      await fetchTable<SurvivorCastawayDetails>("castaway_details", ref),
    );
    seasonData.castaways = held.castaways;
    renameNotes = held.notes;
    for (const note of renameNotes) console.log(`  ${note}`);
  }

  const playerData = transformPlayers(seasonData, seasonNum);
  const resultsData = transformResults(seasonData, seasonNum);

  // Keep the committed cast (images, professions, bios, nicknames and any
  // hand correction) and regenerate only the results; see lib/curated-cast.ts.
  console.log("  Generating season file...");
  const { content: rawContent, keptDifferences } = regenerateSeasonFile(
    existingContent,
    playerData,
    resultsData,
    seasonNum,
  );
  if (keptDifferences.length > 0) {
    console.log(
      `  Kept ${keptDifferences.length} committed cast values survivoR disagrees with:`,
    );
    for (const note of keptDifferences) {
      console.log(`    - ${note}`);
    }
  }

  // Compare and write Prettier's layout, the one the workflow commits.
  const { content: generatedContent, unchanged } = await planSeasonFileWrite(
    existingContent,
    rawContent,
    seasonFilePath,
  );

  if (!isNewSeason && existingContent !== undefined) {
    if (unchanged) {
      const result: SyncResult = {
        changed: false,
        unchanged: true,
        seasonNum,
        isNewSeason: false,
        upstreamRef: ref,
      };
      writeResult(RESULT_PATH, result);
      console.log("\nPhase 3: No changes detected. Exiting.");
      return;
    }
    console.log("\nPhase 3: Changes detected.");
  } else {
    console.log(
      `\nPhase 3: ${isNewSeason ? "New season" : "File missing"} — will create.`,
    );
  }

  const existingEpisodeCount =
    isNewSeason || !existingContent
      ? undefined
      : countEpisodes(existingContent);

  // Hold rather than import half an episode: survivoR fills its tables over
  // one or more commits, and a partial episode would publish wrong scores.
  // The transformer imports every upstream row, so one unfinished episode
  // holds the whole import.
  let newEpisodes: EpisodeReadiness[] = [];
  if (existingEpisodeCount !== undefined) {
    const challengeDescription = filterBySeason(
      await fetchTable<SurvivorChallengeDescription>(
        "challenge_description",
        ref,
      ),
      seasonNum,
    );
    newEpisodes = assessNewEpisodes(
      { ...seasonData, challengeDescription },
      seasonNum,
      existingEpisodeCount,
      ref,
    );
    for (const r of newEpisodes) {
      for (const w of r.waived) {
        console.log(
          `  Episode ${r.episodeNum}: waived "${w}" (READINESS_WAIVERS)`,
        );
      }
    }
    const held = heldReasons(newEpisodes);
    if (held.length > 0) {
      writeResult(RESULT_PATH, {
        changed: false,
        seasonNum,
        isNewSeason: false,
        upstreamRef: ref,
        held,
      });
      console.log("\nHolding: survivoR has not finished these episodes:");
      for (const h of held) console.log(`  - ${h}`);
      return;
    }
  }

  // Phase 4: Validate
  console.log("\nPhase 4: Validating data...");
  const existingCastaways = existingContent
    ? extractExistingCastawayLookup(existingContent)
    : undefined;
  const validation = validateSeasonData(
    playerData,
    resultsData,
    existingEpisodeCount,
    existingCastaways,
  );

  if (!validation.valid) {
    const result: SyncResult = {
      changed: true,
      seasonNum,
      isNewSeason,
      error: `Validation failed: ${validation.errors.join("; ")}`,
      firestorePushed: false,
      warnings: validation.warnings,
    };
    writeResult(RESULT_PATH, result);
    console.error("  Validation failed:");
    for (const err of validation.errors) {
      console.error(`    - ${err}`);
    }
    process.exit(1);
  }

  if (validation.warnings.length > 0) {
    console.log("  Warnings:");
    for (const w of validation.warnings) {
      console.log(`    - ${w}`);
    }
  }
  console.log("  Validation passed.");

  // Phase 5: Write + Push
  console.log("\nPhase 5: Writing file and pushing to Firestore...");

  if (!fs.existsSync(seasonDir)) {
    fs.mkdirSync(seasonDir, { recursive: true });
  }
  fs.writeFileSync(seasonFilePath, generatedContent);
  console.log(`  Wrote: ${seasonFilePath}`);

  // For new seasons, register in seasons.ts
  if (isNewSeason) {
    registerSeason(seasonNum, seasonsFilePath, "");
  }

  // Push to Firestore
  const seasonImg = isNewSeason
    ? ""
    : readLocalSeasonImg(fs.readFileSync(seasonsFilePath, "utf-8"), seasonNum);
  let firestorePushed = false;
  let firestoreError: string | undefined;

  if (noPush) {
    console.log("  --no-push: Firestore not touched.");
  } else {
    try {
      // Imported here so --no-push runs without the Admin SDK key.
      const { pushSeasonToFirestore } = await import("./lib/firebase-push.js");
      await pushSeasonToFirestore(seasonNum, false, seasonImg);
      firestorePushed = true;
      console.log("  Firestore push successful.");
    } catch (err) {
      firestoreError = err instanceof Error ? err.message : String(err);
      console.error(`  Firestore push failed: ${firestoreError}`);
    }
  }

  const result: SyncResult = {
    changed: true,
    seasonNum,
    isNewSeason,
    firestorePushed,
    upstreamRef: ref,
    newEpisodes: newEpisodes.map(
      ({ episodeNum, status, waived, reviewNotes, counts }) => ({
        episodeNum,
        status,
        waived,
        reviewNotes,
        counts,
      }),
    ),
    error: firestoreError
      ? `Firestore push failed: ${firestoreError}`
      : undefined,
    summary: {
      episodes: resultsData.episodes.length,
      challenges: resultsData.challenges.length,
      eliminations: resultsData.eliminations.length,
      events: resultsData.events.length,
      voteHistory: resultsData.voteHistory.length,
    },
    warnings: [...renameNotes, ...validation.warnings, ...keptDifferences],
  };
  writeResult(RESULT_PATH, result);

  console.log("\nSync complete!");
  console.log(`  Season: ${seasonNum}`);
  console.log(`  New season: ${isNewSeason}`);
  console.log(`  Episodes: ${resultsData.episodes.length}`);
  console.log(`  Challenges: ${resultsData.challenges.length}`);
  console.log(`  Eliminations: ${resultsData.eliminations.length}`);
  console.log(`  Events: ${resultsData.events.length}`);
  console.log(`  Vote history: ${resultsData.voteHistory.length}`);
  console.log(`  Firestore pushed: ${firestorePushed}`);
}

main().catch((err) => {
  const result: SyncResult = {
    changed: false,
    seasonNum: 0,
    isNewSeason: false,
    error: err instanceof Error ? err.message : String(err),
    firestorePushed: false,
  };
  writeResult(RESULT_PATH, result);
  console.error("Sync failed:", err);
  process.exit(1);
});
