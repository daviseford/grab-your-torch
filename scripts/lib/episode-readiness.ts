/**
 * Decides whether survivoR has published every scoring input for one episode.
 *
 * survivoR lands an episode in one or more commits, and a commit can carry
 * some tables and not others (US50 Episode 10 arrived as `episodes` and
 * `vote_history` first, and everything else two days later). An
 * `episodes.json` row alone therefore does not mean the episode can be scored.
 *
 * Hard rules. Every one must hold or the episode is `partial`, and callers
 * must not import it:
 *
 * - `episodes`: exactly one row, with a title and a valid air date, and the
 *   previous episode is present, so episodes never arrive out of order.
 * - `challenge_results`: an immunity challenge with at least one winner.
 * - `challenge_description` lists the episode's challenges, and its challenge
 *   ids match `challenge_results` in both directions. This is what proves a
 *   reward challenge landed: an episode need not have one, so its absence
 *   from `challenge_results` alone proves nothing.
 * - `castaways`: at least one castaway whose game ended that episode, unless
 *   the episode had no vote at all and survivoR already lists the next one.
 * - `vote_history`: rows whenever someone was voted out, and the voted-out
 *   ids agree with `castaways` in both directions.
 * - `tribe_mapping`, once survivoR publishes it for the season: rows for the
 *   episode covering everyone still in the game. And whenever
 *   `challenge_results` shows a merged tribe, `tribe_mapping` must show the
 *   merge too, since the merge bonus is read from it.
 *
 * What cannot be proven. Finding an idol or advantage, and going on a
 * journey, are scored from `advantage_movement` and `journeys`, and an
 * episode can legitimately have no rows in either. Nothing upstream says
 * "this episode had no advantage events", so their completeness cannot be
 * shown from the data. The checks that can be made (an idol or vote
 * advantage visible in `vote_history` with no matching play) had exceptions
 * in nine real episodes of Seasons 43 to 50, so they are review notes for the
 * person approving the import, never a reason to hold or to pass.
 */

import type { SurvivorSeasonData } from "./survivor-client.js";
import type { SurvivorChallengeDescription } from "./survivor-types.js";

export type EpisodeReadinessStatus = "absent" | "partial" | "complete";

/** Season data plus the tables only the readiness gate reads. */
export interface ReadinessData extends SurvivorSeasonData {
  challengeDescription: SurvivorChallengeDescription[];
}

export interface EpisodeReadiness {
  seasonNum: number;
  episodeNum: number;
  status: EpisodeReadinessStatus;
  /** Why the episode is not complete; empty when it is. */
  missing: string[];
  /**
   * Things a reviewer should check by hand. They never change the status:
   * see "What cannot be proven" above.
   */
  reviewNotes: string[];
  /** Rows found for this episode in each scoring table. */
  counts: {
    episodes: number;
    challengeResults: number;
    challengeDescription: number;
    voteHistory: number;
    castawaysOut: number;
    tribeMapping: number;
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

const MERGED_STATUS = /^(merged|mergatory)$/i;

/** A vote_event that only happens when an advantage was played. */
const ADVANTAGE_VOTE_EVENT =
  /^(extra vote|steal a vote|block a vote|played block a vote|played bank your vote|played banked vote)/i;

export function assessEpisodeReadiness(
  data: ReadinessData,
  seasonNum: number,
  episodeNum: number,
): EpisodeReadiness {
  const onEpisode = <T extends { episode?: number | null }>(rows: T[]) =>
    rows.filter((r) => episodeOf(r) === episodeNum);

  const episodeRows = onEpisode(data.episodes);
  const challengeRows = onEpisode(data.challengeResults);
  const descriptionRows = onEpisode(data.challengeDescription);
  const voteRows = onEpisode(data.voteHistory);
  const castawaysOut = onEpisode(data.castaways).filter(
    (c) => c.result != null && c.result !== "",
  );
  const tribeRows = onEpisode(data.tribeMapping);
  const advantageRows = onEpisode(data.advantageMovement);
  const journeyRows = onEpisode(data.journeys);

  const counts = {
    episodes: episodeRows.length,
    challengeResults: challengeRows.length,
    challengeDescription: descriptionRows.length,
    voteHistory: voteRows.length,
    castawaysOut: castawaysOut.length,
    tribeMapping: tribeRows.length,
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
      reviewNotes: [],
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

  const resultIds = new Set(challengeRows.map((c) => c.challenge_id));
  const describedIds = new Set(descriptionRows.map((c) => c.challenge_id));
  if (descriptionRows.length === 0) {
    missing.push("challenge_description: no rows");
  } else {
    for (const id of [...describedIds].sort((a, b) => a - b)) {
      if (!resultIds.has(id)) {
        missing.push(`challenge_results: no rows for challenge ${id}`);
      }
    }
    for (const id of [...resultIds].sort((a, b) => a - b)) {
      if (!describedIds.has(id)) {
        missing.push(`challenge_description: no row for challenge ${id}`);
      }
    }
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

  // Season 51 has no tribe_mapping rows at all yet, so coverage is required
  // only once survivoR publishes the table for the season.
  if (data.tribeMapping.length > 0) {
    const mapped = new Set(tribeRows.map((t) => t.castaway_id));
    const stillIn = data.castaways.filter((c) => {
      const left = episodeOf(c);
      return !(c.result && left !== null && left < episodeNum);
    });
    const unmapped = stillIn.filter((c) => !mapped.has(c.castaway_id));
    if (unmapped.length > 0) {
      missing.push(
        `tribe_mapping: ${unmapped.length} castaway(s) in the game have no row`,
      );
    }
  }
  // challenge_results, not vote_history: S47's vote rows call Episode 6
  // merged, a week before its challenge and tribe rows do.
  const mergeShown = data.challengeResults.some((r) => {
    const ep = episodeOf(r);
    return (
      ep !== null && ep <= episodeNum && MERGED_STATUS.test(r.tribe_status)
    );
  });
  const mergeMapped = data.tribeMapping.some((t) => {
    const ep = episodeOf(t);
    return (
      ep !== null && ep <= episodeNum && MERGED_STATUS.test(t.tribe_status)
    );
  });
  if (mergeShown && !mergeMapped) {
    missing.push(
      "tribe_mapping: the merge appears in challenge_results but not here",
    );
  }

  return {
    seasonNum,
    episodeNum,
    status: missing.length === 0 ? "complete" : "partial",
    missing,
    reviewNotes: reviewNotes(data, episodeNum, voteRows, counts),
    counts,
  };
}

function reviewNotes(
  data: ReadinessData,
  episodeNum: number,
  voteRows: SurvivorSeasonData["voteHistory"],
  counts: EpisodeReadiness["counts"],
): string[] {
  const notes: string[] = [];
  const played = data.advantageMovement.filter(
    (a) => episodeOf(a) === episodeNum && /^played$/i.test(a.event),
  );
  const idolTargets = new Set(
    voteRows.filter((v) => v.immunity === "Hidden").map((v) => v.castaway_id),
  );
  for (const id of idolTargets) {
    if (!played.some((p) => p.played_for_id === id)) {
      notes.push(
        `vote_history shows an idol protecting ${id}, but advantage_movement has no play for them`,
      );
    }
  }
  if (voteRows.some((v) => v.nullified) && played.length === 0) {
    notes.push(
      "vote_history has nullified votes, but advantage_movement has no play this episode",
    );
  }
  for (const v of voteRows) {
    const event = v.vote_event ?? "";
    if (
      ADVANTAGE_VOTE_EVENT.test(event) &&
      !played.some((p) => p.castaway_id === v.castaway_id)
    ) {
      notes.push(
        `vote_history shows "${event}" for ${v.castaway_id}, but advantage_movement has no play for them`,
      );
    }
    if (
      /journey/i.test(event) &&
      !data.journeys.some(
        (j) =>
          j.castaway_id === v.castaway_id &&
          (episodeOf(j) ?? Infinity) <= episodeNum,
      )
    ) {
      notes.push(
        `vote_history shows "${event}" for ${v.castaway_id}, but journeys has no row for them`,
      );
    }
  }
  notes.push(
    `advantage_movement has ${counts.advantageMovement} row(s) and journeys ${counts.journeys} for this episode; check idol finds and journeys against the broadcast`,
  );
  return [...new Set(notes)];
}

/**
 * Every episode number above `afterEpisode` that has a row in a table that
 * records what happened in an episode, ascending. Used to find what an import
 * would add, including an episode that so far exists only in a table other
 * than `episodes`.
 *
 * `tribe_mapping` is left out: during a season it lists the tribes for the
 * episode after the newest one (US50 at survivoR 403f4a4 has episodes to 9
 * and tribe_mapping to 10), so counting it would hold every import.
 */
export function upstreamEpisodesAfter(
  data: ReadinessData,
  afterEpisode: number,
): number[] {
  const tables = [
    data.episodes,
    data.challengeResults,
    data.challengeDescription,
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

/** Readiness of every episode survivoR has above the committed count. */
export function assessNewEpisodes(
  data: ReadinessData,
  seasonNum: number,
  committedEpisodes: number,
): EpisodeReadiness[] {
  return upstreamEpisodesAfter(data, committedEpisodes).map((ep) =>
    assessEpisodeReadiness(data, seasonNum, ep),
  );
}

/** Readable reasons for every new episode that is not complete. */
export function heldReasons(readiness: EpisodeReadiness[]): string[] {
  return readiness
    .filter((r) => r.status !== "complete")
    .map((r) => `Episode ${r.episodeNum}: ${r.missing.join("; ")}`);
}
