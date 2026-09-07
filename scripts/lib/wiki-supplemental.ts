/**
 * Shared wiki supplemental enrichment — fetches player images, bios,
 * and occupations from the Survivor Wiki using the layered name resolver.
 *
 * Used by both new-season.ts and batch-new-season.ts.
 */

import * as path from "path";
import type { ScrapedPlayer } from "./types.js";
import {
  delay,
  downloadImage,
  fetchImageUrls,
  toThumbnailUrl,
} from "./wiki-api.js";
import { resolveWikiPageTitle } from "./wiki-name-resolver.js";
import { parseContestantPage } from "./wikitext-parser.js";

/** Resolution stats for summary logging. */
interface ResolutionStats {
  override: number;
  full_name: number;
  castaway: number;
  failed: number;
}

/**
 * Fetch player images and bios from the Survivor Wiki as a supplemental step
 * after survivoR data fetch. Uses the layered wiki name resolver to handle
 * name mismatches (nicknames, shortened names, spelling differences).
 */
export async function fetchWikiSupplemental(
  players: ScrapedPlayer[],
  seasonNum: number,
  projectRoot: string,
): Promise<void> {
  const seasonKey = `season_${seasonNum}`;
  const imageFileNames = new Map<string, string>(); // wikiPageTitle -> imageFileName
  const stats: ResolutionStats = {
    override: 0,
    full_name: 0,
    castaway: 0,
    failed: 0,
  };

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const originalTitle = player.wikiPageTitle;

    const resolution = await resolveWikiPageTitle(player);

    if (!resolution) {
      console.warn(
        `  ✗ ${originalTitle.padEnd(30)} → all layers failed — skipping`,
      );
      stats.failed++;
      if (i < players.length - 1) await delay(150);
      continue;
    }

    // Mutate wikiPageTitle if resolved via a layer other than full_name
    if (resolution.layer !== "full_name") {
      player.wikiPageTitle = resolution.title;
    }

    // Log resolution result
    const layerLabel =
      resolution.layer === "full_name"
        ? "full_name (direct match)"
        : `${resolution.layer} → "${resolution.title}"`;
    console.log(`  ✓ ${originalTitle.padEnd(30)} → ${layerLabel}`);
    stats[resolution.layer]++;

    // Parse infobox for image, occupation, nickname
    const info = parseContestantPage(resolution.wikitext, seasonNum);
    if (!info) {
      console.warn(
        `    ⚠ No {{Contestant}} infobox found for "${resolution.title}" — skipping enrichment`,
      );
    } else {
      if (info.imageFileName) {
        imageFileNames.set(player.wikiPageTitle, info.imageFileName);
      }
      if (info.occupation) {
        player.profession = info.occupation;
      }
      if (info.nickname) {
        player.nickname = info.nickname;
      }
    }

    if (i < players.length - 1) await delay(150);
  }

  // Print resolution summary
  console.log(
    `\n  Resolution: ${stats.full_name} direct, ${stats.override} override, ${stats.castaway} castaway, ${stats.failed} failed`,
  );

  if (imageFileNames.size === 0) return;

  // Batch-resolve image URLs and download
  console.log(`  Resolving ${imageFileNames.size} image URLs...`);
  const imageUrls = await fetchImageUrls([...imageFileNames.values()]);
  console.log(`  Resolved ${imageUrls.size}/${imageFileNames.size} image URLs`);

  const imgDirPath = path.join(projectRoot, "public", "images", seasonKey);
  let downloaded = 0;

  for (const player of players) {
    const fileName = imageFileNames.get(player.wikiPageTitle);
    if (!fileName) continue;
    const url = imageUrls.get(fileName);
    if (!url) continue;

    const name = player.localName || player.wikiPageTitle;
    const thumbUrl = toThumbnailUrl(url);
    const localFileName = name.replace(/\s+/g, "-") + ".jpg";
    const localPath = path.join(imgDirPath, localFileName);

    const ok = await downloadImage(thumbUrl, localPath);
    if (ok) {
      player.imageUrl = `/images/${seasonKey}/${localFileName}`;
      downloaded++;
    } else {
      console.warn(`    Failed to download image for ${name}`);
    }
    await delay(100);
  }
  console.log(`  Downloaded ${downloaded}/${imageUrls.size} images`);
}
