/**
 * Decides whether survivoR has published every scoring input for one episode.
 *
 * survivoR lands an episode table by table, so an `episodes.json` row alone
 * does not mean the episode can be scored. An episode is complete only when
 * each table the scoring pipeline reads carries consistent rows for it:
 *
 * - `episodes`: exactly one row, with a title and a valid air date
 * - `challenge_results`: an immunity challenge with at least one winner
 * - `castaways`: at least one castaway whose game ended that episode, unless
 *   the episode had no vote at all and survivoR already lists the next one
 * - `vote_history`: rows for that episode whenever someone was voted out,
 *   and the voted-out ids agree with `castaways` in both directions
 * - the previous episode is present, so episodes never arrive out of order
 *
 * Advantage and journey rows are scored too, but an episode can have none,
 * so their absence cannot mark it incomplete.
 *
 * Anything short of that is `partial` (some rows present) or `absent` (none),
 * and callers must treat both as "do not import yet".
 */

import type { SurvivorSeasonData } from "./survivor-client.js";

export type EpisodeReadinessStatus = "absent" | "partial" | "complete";

export interface EpisodeReadiness {
  seasonNum: number;
  episodeNum: number;
  status: EpisodeReadinessStatus;
  /** Why the episode is not complete; empty when it is. */
  missing: string[];
  /** Rows found for this episode in each scoring table. */
  counts: {
    episodes: number;
    challengeResults: number;
    voteHistory: number;
    castawaysOut: number;
    advantageMovement: number;
    journeys: number;
  };
}

/** survivoR encodes integers as floats; null means "still in the game". */
function episodeOf(row: { episode?: number | null }): number | null {
  return row.episode == null ? null : Math.round(row.episode);
}

function isVoteOut(result: string): boolean {
  return /voted out/i.test(result);
}

export function assessEpisodeReadiness(
  data: SurvivorSeasonData,
  seasonNum: number,
  episodeNum: number,
): EpisodeReadiness {
  const onEpisode = <T extends { episode?: number | null }>(rows: T[]) =>
    rows.filter((r) => episodeOf(r) === episodeNum);

  const episodeRows = onEpisode(data.episodes);
  const challengeRows = onEpisode(data.challengeResults);
  const voteRows = onEpisode(data.voteHistory);
  const castawaysOut = onEpisode(data.castaways).filter(
    (c) => c.result != null && c.result !== "",
  );
  const advantageRows = onEpisode(data.advantageMovement);
  const journeyRows = onEpisode(data.journeys);

  const counts = {
    episodes: episodeRows.length,
    challengeResults: challengeRows.length,
    voteHistory: voteRows.length,
    castawaysOut: castawaysOut.length,
    advantageMovement: advantageRows.length,
    journeys: journeyRows.length,
  };

  const anyRows = Object.values(counts).some((n) => n > 0);
  if (!anyRows) {
    return {
      seasonNum,
      episodeNum,
      status: "absent",
      missing: [`no survivoR rows for episode ${episodeNum}`],
      counts,
    };
  }

  const missing: string[] = [];

  if (episodeRows.length === 0) {
    missing.push("episodes: no row");
  } else if (episodeRows.length > 1) {
    missing.push(`episodes: ${episodeRows.length} rows, expected 1`);
  } else {
    const ep = episodeRows[0];
    if (!ep.episode_title) missing.push("episodes: no title");
    if (!ep.episode_date || Number.isNaN(Date.parse(ep.episode_date))) {
      missing.push("episodes: no valid air date");
    }
  }

  if (episodeNum > 1) {
    const previous = data.episodes.some((e) => episodeOf(e) === episodeNum - 1);
    if (!previous) missing.push(`episodes: episode ${episodeNum - 1} missing`);
  }

  const immunityWinners = challengeRows.filter(
    (c) => /immunity/i.test(c.challenge_type ?? "") && c.won === 1,
  );
  if (challengeRows.length === 0) {
    missing.push("challenge_results: no rows");
  } else if (immunityWinners.length === 0) {
    missing.push("challenge_results: no immunity challenge winner");
  }

  // A few episodes have no tribal council and no boot (S41 and S42 episode
  // 6). That looks the same as boot rows not landed yet, so accept it only
  // once survivoR has moved on to the next episode.
  if (castawaysOut.length === 0) {
    const nextEpisodeListed = data.episodes.some(
      (e) => episodeOf(e) === episodeNum + 1,
    );
    if (voteRows.length > 0 || !nextEpisodeListed) {
      missing.push("castaways: nobody left the game this episode");
    }
  }

  const votedOutInCastaways = new Set(
    castawaysOut.filter((c) => isVoteOut(c.result)).map((c) => c.castaway_id),
  );
  const votedOutInVotes = new Set(
    voteRows.map((v) => v.voted_out_id).filter((id): id is string => !!id),
  );
  if (votedOutInCastaways.size > 0 && voteRows.length === 0) {
    missing.push("vote_history: no rows for a voted-out castaway");
  }
  for (const id of votedOutInCastaways) {
    if (voteRows.length > 0 && !votedOutInVotes.has(id)) {
      missing.push(`vote_history: ${id} is voted out in castaways only`);
    }
  }
  const outIds = new Set(castawaysOut.map((c) => c.castaway_id));
  for (const id of votedOutInVotes) {
    if (!outIds.has(id)) {
      missing.push(`castaways: ${id} is voted out in vote_history only`);
    }
  }

  return {
    seasonNum,
    episodeNum,
    status: missing.length === 0 ? "complete" : "partial",
    missing,
    counts,
  };
}

/**
 * Every episode number above `afterEpisode` that has a row in any scoring
 * table, ascending. Used to find what an import would add, including an
 * episode that so far exists only in a table other than `episodes`.
 */
export function upstreamEpisodesAfter(
  data: SurvivorSeasonData,
  afterEpisode: number,
): number[] {
  const tables = [
    data.episodes,
    data.challengeResults,
    data.voteHistory,
    data.castaways,
    data.advantageMovement,
    data.journeys,
  ];
  const nums = new Set<number>();
  for (const rows of tables) {
    for (const row of rows as { episode?: number | null }[]) {
      const ep = episodeOf(row);
      if (ep !== null && ep > afterEpisode) nums.add(ep);
    }
  }
  return [...nums].sort((a, b) => a - b);
}

/**
 * Episodes above the committed count that survivoR has not finished, as
 * readable reasons. Empty means an import may proceed.
 */
export function heldEpisodes(
  data: SurvivorSeasonData,
  seasonNum: number,
  committedEpisodes: number,
): string[] {
  return upstreamEpisodesAfter(data, committedEpisodes)
    .map((ep) => assessEpisodeReadiness(data, seasonNum, ep))
    .filter((r) => r.status !== "complete")
    .map((r) => `Episode ${r.episodeNum}: ${r.missing.join("; ")}`);
}
