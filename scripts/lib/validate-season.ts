/**
 * Validates regenerated season data before Firestore push.
 * Catches bad data (regressions, invalid references, duplicates)
 * so the automated sync pipeline does not push corrupt data.
 */

import type { ScrapeResult, ScrapeResultsOutput } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Collect duplicate messages from an array by a derived key. */
function findDuplicates<T>(
  items: T[],
  toKey: (item: T) => string,
  toMessage: (item: T) => string,
): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const item of items) {
    const key = toKey(item);
    if (seen.has(key)) {
      messages.push(toMessage(item));
    }
    seen.add(key);
  }
  return messages;
}

/** A castaway_id → full_name pair already committed in a season file. */
export interface ExistingCastaway {
  castawayId: string;
  fullName: string;
}

/**
 * Validate season data against sanity checks:
 * - Episode count monotonicity (cannot decrease)
 * - Castaway identity stability: an id already in the committed file must
 *   still exist and a committed full_name must keep its id (drafts and
 *   competitions key on castaway_id, so a re-numbered cast would silently
 *   hand rosters to the wrong people; this matters most for casts
 *   bootstrapped from the wiki with provisional ids before survivoR
 *   published the season)
 * - All castaway_id references exist in the player list
 * - No duplicate IDs for challenges, eliminations, or events
 * - Structural integrity (required fields present)
 */
export function validateSeasonData(
  playerData: ScrapeResult,
  resultsData: ScrapeResultsOutput,
  existingEpisodeCount?: number,
  existingCastaways?: ExistingCastaway[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const playerIds = new Set(playerData.players.map((p) => p.castawayId));

  // Castaway identity stability against the committed file
  if (existingCastaways && existingCastaways.length > 0) {
    const newNameById = new Map(
      playerData.players.map((p) => [p.castawayId, p.localName]),
    );
    const newIdByName = new Map(
      playerData.players.map((p) => [p.localName, p.castawayId]),
    );
    for (const existing of existingCastaways) {
      const newName = newNameById.get(existing.castawayId);
      const newId = newIdByName.get(existing.fullName);
      if (newName === undefined) {
        errors.push(
          `Castaway ${existing.castawayId} (${existing.fullName}) is in the committed file but missing from the new data`,
        );
      } else if (newName !== existing.fullName) {
        if (newId !== undefined && newId !== existing.castawayId) {
          errors.push(
            `Castaway "${existing.fullName}" changed id from ${existing.castawayId} to ${newId}`,
          );
        } else {
          warnings.push(
            `Castaway ${existing.castawayId} renamed from "${existing.fullName}" to "${newName}"`,
          );
        }
      }
    }
  }

  // Episode count monotonicity
  if (
    existingEpisodeCount !== undefined &&
    resultsData.episodes.length < existingEpisodeCount
  ) {
    errors.push(
      `Episode count decreased from ${existingEpisodeCount} to ${resultsData.episodes.length}`,
    );
  }

  // Castaway ID integrity for challenges
  for (const challenge of resultsData.challenges) {
    for (const id of challenge.winnerCastawayIds) {
      if (!playerIds.has(id)) {
        errors.push(
          `Challenge (episode ${challenge.episodeNum}, order ${challenge.order}) references unknown castaway_id "${id}"`,
        );
      }
    }
  }

  // Castaway ID integrity for eliminations
  for (const elim of resultsData.eliminations) {
    if (!elim.castawayId) {
      errors.push(
        `Elimination (episode ${elim.episodeNum}, order ${elim.order}) missing required castaway_id`,
      );
    } else if (!playerIds.has(elim.castawayId)) {
      errors.push(
        `Elimination (episode ${elim.episodeNum}, order ${elim.order}) references unknown castaway_id "${elim.castawayId}"`,
      );
    }
  }

  // Castaway ID integrity for events
  for (const event of resultsData.events) {
    if (!playerIds.has(event.castawayId)) {
      errors.push(
        `Event "${event.action}" (episode ${event.episodeNum}) references unknown castaway_id "${event.castawayId}"`,
      );
    }
  }

  // Duplicate detection
  errors.push(
    ...findDuplicates(
      resultsData.challenges,
      (c) => `ep${c.episodeNum}_o${c.order}`,
      (c) => `Duplicate challenge: episode ${c.episodeNum}, order ${c.order}`,
    ),
  );

  errors.push(
    ...findDuplicates(
      resultsData.eliminations,
      (e) => `ep${e.episodeNum}_o${e.order}`,
      (e) => `Duplicate elimination: episode ${e.episodeNum}, order ${e.order}`,
    ),
  );

  warnings.push(
    ...findDuplicates(
      resultsData.events,
      (ev) => `ep${ev.episodeNum}_${ev.castawayId}_${ev.action}`,
      (ev) =>
        `Duplicate event: "${ev.action}" for ${ev.castawayId} in episode ${ev.episodeNum}`,
    ),
  );

  return { valid: errors.length === 0, errors, warnings };
}
