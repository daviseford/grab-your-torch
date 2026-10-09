import {
  CastawayId,
  Challenge,
  Competition,
  DraftPick,
  Elimination,
  Episode,
  GameEvent,
  Season,
  SlimUser,
  Trade,
} from "../types";
import { getBroadcastDate, getLatestDataEpisode } from "./episodeAirDate";
import { getParticipantName } from "./misc";

/**
 * Trade ownership logic.
 *
 * `Competition.draft_picks` is immutable — trades live in a subcollection and
 * ownership is derived: the drafter owns a castaway from episode 1, and each
 * accepted trade moves ownership starting at its `effective_episode`. Points
 * from episodes before the cutoff stay with the previous owner.
 */

export type OwnershipWindow = {
  uid: string;
  /** First episode (inclusive) this uid owns the castaway. */
  fromEpisode: number;
};

const acceptedTrades = (trades: Trade[]): Trade[] =>
  trades
    .filter((t) => t.status === "accepted" && t.effective_episode !== undefined)
    .sort(
      (a, b) =>
        a.effective_episode! - b.effective_episode! ||
        (a.resolved_at ?? "").localeCompare(b.resolved_at ?? ""),
    );

/**
 * Ownership windows per castaway: an ascending list of segments, each valid
 * from `fromEpisode` until the next segment starts.
 */
export function getOwnershipWindows(
  draftPicks: DraftPick[],
  trades: Trade[],
): Record<CastawayId, OwnershipWindow[]> {
  const windows: Record<CastawayId, OwnershipWindow[]> = {};

  for (const pick of draftPicks) {
    windows[pick.castaway_id] = [{ uid: pick.user_uid, fromEpisode: 1 }];
  }

  for (const trade of acceptedTrades(trades)) {
    const moves: [CastawayId, string][] = [
      ...trade.offered_castaway_ids.map((id): [CastawayId, string] => [
        id,
        trade.offered_to_uid,
      ]),
      ...trade.requested_castaway_ids.map((id): [CastawayId, string] => [
        id,
        trade.offered_by_uid,
      ]),
    ];

    for (const [castawayId, newOwner] of moves) {
      windows[castawayId]?.push({
        uid: newOwner,
        fromEpisode: trade.effective_episode!,
      });
    }
  }

  return windows;
}

/** Who owned `castawayId` during `episode`, or undefined if never drafted. */
export function getOwnerAtEpisode(
  windows: Record<CastawayId, OwnershipWindow[]>,
  castawayId: CastawayId,
  episode: number,
): string | undefined {
  const segments = windows[castawayId];
  if (!segments) return undefined;

  let owner: string | undefined;
  for (const segment of segments) {
    if (segment.fromEpisode <= episode) owner = segment.uid;
    else break;
  }
  return owner;
}

/**
 * The episode whose ownership rosters and scoring should display. An accepted
 * trade whose cutoff is still in the future has not happened yet as far as
 * revealed game state goes, so the UI keeps the previous owner until the
 * competition reaches the cutoff.
 *
 * - Watch-along: the current episode, floored at 1 so a brand-new competition
 *   (episode 0) shows episode-1 cutoffs immediately -- nothing has been
 *   revealed for the swap to contradict.
 * - Live (`current_episode` is null): Infinity. Results appear as they air, so
 *   there is no revealed episode for a completed trade to contradict; every
 *   accepted trade displays at once.
 * - Finished: Infinity. Everything has been revealed, so nothing is left for a
 *   pending indicator to wait on -- final ownership displays.
 */
export function getRosterEpisode(competition: Competition): number {
  return competition.finished || competition.current_episode === null
    ? Infinity
    : Math.max(competition.current_episode, 1);
}

/**
 * Ownership windows for display purposes. A cutoff past the season's last
 * episode can never be revealed by a watch-along (legacy trades carry the
 * latest data episode + 1 -- see StatusBadge in TradesSection), so waiting for
 * it would leave the swap "pending" forever. Those cutoffs are treated as
 * already effective: live-mode semantics, where the roster moves and past
 * points stay with the previous owner. Without `lastEpisode` the windows are
 * used as-is.
 */
function getDisplayWindows(
  draftPicks: DraftPick[],
  trades: Trade[],
  lastEpisode?: number,
): Record<CastawayId, OwnershipWindow[]> {
  const windows = getOwnershipWindows(draftPicks, trades);
  if (lastEpisode === undefined) return windows;

  for (const segments of Object.values(windows)) {
    for (const segment of segments) {
      if (segment.fromEpisode > lastEpisode) segment.fromEpisode = 1;
    }
  }
  return windows;
}

/**
 * Owner of every drafted castaway as of `episode` (see getRosterEpisode).
 * Pass the season's last episode so unreachable cutoffs display immediately
 * (see getDisplayWindows).
 */
export function getOwnersAtEpisode(
  draftPicks: DraftPick[],
  trades: Trade[],
  episode: number,
  lastEpisode?: number,
): Record<CastawayId, string> {
  const windows = getDisplayWindows(draftPicks, trades, lastEpisode);
  return Object.fromEntries(
    (Object.keys(windows) as CastawayId[]).map((id) => [
      id,
      getOwnerAtEpisode(windows, id, episode)!,
    ]),
  ) as Record<CastawayId, string>;
}

/**
 * Current owner of every drafted castaway (after all accepted trades,
 * including ones whose cutoff the competition has not reached yet). This is
 * what trading logic wants -- a castaway already promised away cannot be
 * offered again -- while display surfaces want getOwnersAtEpisode.
 */
export function getCurrentOwners(
  draftPicks: DraftPick[],
  trades: Trade[],
): Record<CastawayId, string> {
  return getOwnersAtEpisode(draftPicks, trades, Infinity);
}

/**
 * Who drafted each castaway. Draft history is fixed -- a trade moves the
 * roster, it never rewrites who made the pick.
 */
export function getDrafters(
  draftPicks: DraftPick[],
): Record<CastawayId, string> {
  return Object.fromEntries(
    draftPicks.map((pick) => [pick.castaway_id, pick.user_uid]),
  ) as Record<CastawayId, string>;
}

export type Acquisition = {
  /** Current owner, who is not the drafter. */
  uid: string;
  /** Previous owner -- who they came from in the trade that moved them here. */
  fromUid: string;
};

/**
 * Castaways sitting on a roster other than their drafter's as of `episode`, so
 * the UI can say "acquired" where it would otherwise say "drafted". Only
 * trades whose cutoff has been reached count, so the marker appears when the
 * roster swap does and not an episode early.
 *
 * A castaway traded away and later traded back is absent: their drafter owns
 * them again, so nothing distinguishes them from a pick that never moved.
 */
export function getAcquisitionsAtEpisode(
  draftPicks: DraftPick[],
  trades: Trade[],
  episode: number,
  lastEpisode?: number,
): Record<CastawayId, Acquisition> {
  const windows = getDisplayWindows(draftPicks, trades, lastEpisode);
  const acquisitions: Record<string, Acquisition> = {};

  for (const [castawayId, segments] of Object.entries(windows)) {
    const arrived = segments.filter((s) => s.fromEpisode <= episode);
    const drafter = segments[0].uid;
    const current = arrived[arrived.length - 1];
    if (!current || current.uid === drafter) continue;

    acquisitions[castawayId] = {
      uid: current.uid,
      fromUid: arrived[arrived.length - 2].uid,
    };
  }

  return acquisitions as Record<CastawayId, Acquisition>;
}

export type UpcomingMove = {
  /** Owner as of the displayed episode -- whose roster the castaway leaves. */
  fromUid: string;
  /** Owner after the next unreached cutoff -- the next hop, not necessarily
   * the final owner when further trades are chained behind it. */
  toUid: string;
  /**
   * True when the move lands at the very next reveal. Usually the case, since
   * a cutoff is normally `current_episode + 1` -- but trades accepted before
   * the cutoff was tied to `current_episode` can carry a later episode (see
   * StatusBadge in TradesSection), so wording must not promise "next episode"
   * unless this is set. Either way the copy stays relative; absolute episode
   * numbers would leak how far the season has run.
   */
  landsNextEpisode: boolean;
};

/**
 * Castaways whose accepted trade has not reached its cutoff as of `episode`:
 * they still sit on `fromUid`'s roster and move to `toUid` when the
 * competition reaches the trade's cutoff.
 */
export function getUpcomingMoves(
  draftPicks: DraftPick[],
  trades: Trade[],
  episode: number,
  lastEpisode?: number,
): Record<CastawayId, UpcomingMove> {
  const windows = getDisplayWindows(draftPicks, trades, lastEpisode);
  const moves: Record<string, UpcomingMove> = {};

  for (const [castawayId, segments] of Object.entries(windows)) {
    const owner = getOwnerAtEpisode(
      windows,
      castawayId as CastawayId,
      episode,
    )!;
    const nextCutoff = segments.find((s) => s.fromEpisode > episode);
    if (!nextCutoff) continue;

    // Net owner once the next cutoff is reached -- resolves chains where two
    // trades share a cutoff episode.
    const nextOwner = getOwnerAtEpisode(
      windows,
      castawayId as CastawayId,
      nextCutoff.fromEpisode,
    )!;
    if (nextOwner !== owner) {
      moves[castawayId] = {
        fromUid: owner,
        toUid: nextOwner,
        landsNextEpisode: nextCutoff.fromEpisode === episode + 1,
      };
    }
  }

  return moves as Record<CastawayId, UpcomingMove>;
}

/** Relative timing phrase for an upcoming move -- never an episode number. */
export function getUpcomingMoveTiming(move: UpcomingMove): string {
  return move.landsNextEpisode ? "next episode" : "in an upcoming episode";
}

/**
 * Tooltip copy for a pending swap, naming both sides of the move. Timing
 * stays relative -- an absolute episode number would leak season progress.
 */
export function getUpcomingMoveLabel(
  move: UpcomingMove,
  participants: SlimUser[],
  teamNames?: Record<string, string>,
): string {
  const from = getParticipantName(participants, move.fromUid, teamNames);
  const to = getParticipantName(participants, move.toUid, teamNames);
  return `Traded from ${from} to ${to}. Takes effect ${getUpcomingMoveTiming(move)}`;
}

/**
 * Tooltip copy for a traded-in castaway. Deliberately says nothing about which
 * episode the trade took effect -- that would leak how far the season has run
 * to a competition that has not revealed it yet.
 */
export function getAcquisitionLabel(
  acquisition: Acquisition,
  drafterUid: string | undefined,
  participants: SlimUser[],
  teamNames?: Record<string, string>,
): string {
  const from = getParticipantName(participants, acquisition.fromUid, teamNames);
  const drafter = drafterUid
    ? getParticipantName(participants, drafterUid, teamNames)
    : null;

  return drafter && drafterUid !== acquisition.fromUid
    ? `Acquired from ${from} · drafted by ${drafter}`
    : `Acquired from ${from} in a trade`;
}

/** Castaways owned by `uid` during `episode` — what scoring sums over. */
export function getOwnedCastawaysAtEpisode(
  draftPicks: DraftPick[],
  trades: Trade[],
  uid: string,
  episode: number,
): CastawayId[] {
  const windows = getOwnershipWindows(draftPicks, trades);
  return (Object.keys(windows) as CastawayId[]).filter(
    (id) => getOwnerAtEpisode(windows, id, episode) === uid,
  );
}

/**
 * The episode whose air date closes trading today, or null when trading is
 * open. Seasons without air dates never lock.
 *
 * The lock exists to stop someone trading on knowledge of an episode they have
 * already seen, so it only applies to the episode a competition is *about to*
 * reveal:
 *
 * - Watch-along: locks only when the episode airing today is
 *   `current_episode + 1`. A group on episode 3 while the broadcast is on
 *   episode 11 has no hindsight to exploit and keeps trading normally; they
 *   only lock once they have caught up to the broadcast.
 * - Live: every participant sees results as they arrive, so any episode airing
 *   today closes trading.
 *
 * "Today" is the broadcast day, not the viewer's local day: `air_date` comes
 * from survivoR in broadcast terms, so comparing it against a local date would
 * open and close the lock at different instants for participants in different
 * timezones — in the same league, trading against each other.
 *
 * Because the lock can only ever name the next episode a group will reveal, its
 * `order` is safe to show them.
 */
export function getTradeLockEpisode(
  season: Season,
  currentEpisode: number | null,
  today: Date = new Date(),
): Episode | null {
  const todayISO = getBroadcastDate(today);
  const airingToday =
    [...(season.episodes ?? [])]
      .sort((a, b) => a.order - b.order)
      .find((ep) => ep.air_date === todayISO) ?? null;

  if (!airingToday) return null;
  if (currentEpisode === null) return airingToday;
  return airingToday.order === currentEpisode + 1 ? airingToday : null;
}

/**
 * First episode whose points go to the new owner.
 *
 * A trade takes effect for the next episode the competition has not seen yet,
 * so points already on the board stay with the previous owner:
 *
 * - Watch-along (`current_episode` is a number, and 0 on a brand-new
 *   competition): the next episode to be revealed. Trade before revealing
 *   anything and the cutoff is episode 1; trade while sitting on episode 4 and
 *   the cutoff is episode 5.
 * - Live (`current_episode` is null): nothing is revealed on a schedule, so the
 *   same idea against the only clock available -- the first episode that has no
 *   scoring data yet.
 */
export function getEffectiveEpisode(input: {
  competition: Competition;
  challenges: Record<string, Challenge>;
  eliminations: Record<string, Elimination>;
  events: Record<string, GameEvent>;
}): number {
  return (
    (input.competition.current_episode ??
      getLatestDataEpisode(
        input.challenges,
        input.eliminations,
        input.events,
      )) + 1
  );
}

export type TradeValidationInput = {
  competition: Competition;
  season: Season;
  /** All trades in the competition (any status). */
  existingTrades: Trade[];
  /** Castaway IDs eliminated within the competition's visible episodes. */
  eliminatedCastawayIds: CastawayId[];
  offeredByUid: string;
  offeredToUid: string;
  offeredCastawayIds: CastawayId[];
  requestedCastawayIds: CastawayId[];
  today?: Date;
};

export type TradeValidation =
  | { valid: true }
  | { valid: false; reason: string };

/** Client-side validation shared by the proposal form and acceptance. */
export function validateTrade(input: TradeValidationInput): TradeValidation {
  const {
    competition,
    season,
    existingTrades,
    eliminatedCastawayIds,
    offeredByUid,
    offeredToUid,
    offeredCastawayIds,
    requestedCastawayIds,
    today,
  } = input;

  if (competition.finished) {
    return { valid: false, reason: "This competition has finished." };
  }

  const lockEpisode = getTradeLockEpisode(
    season,
    competition.current_episode,
    today,
  );
  if (lockEpisode) {
    return {
      valid: false,
      reason: `Trades are locked. Episode ${lockEpisode.order} airs today.`,
    };
  }

  const participantUids = competition.participant_uids;
  if (
    !participantUids.includes(offeredByUid) ||
    !participantUids.includes(offeredToUid)
  ) {
    return { valid: false, reason: "Both users must be participants." };
  }

  if (offeredByUid === offeredToUid) {
    return { valid: false, reason: "You cannot trade with yourself." };
  }

  if (offeredCastawayIds.length === 0 || requestedCastawayIds.length === 0) {
    return {
      valid: false,
      reason: "Each side must include at least one player.",
    };
  }

  const allIds = [...offeredCastawayIds, ...requestedCastawayIds];
  if (new Set(allIds).size !== allIds.length) {
    return { valid: false, reason: "A player cannot appear on both sides." };
  }

  const owners = getCurrentOwners(competition.draft_picks, existingTrades);
  for (const id of offeredCastawayIds) {
    if (owners[id] !== offeredByUid) {
      return { valid: false, reason: "You no longer own an offered player." };
    }
  }
  for (const id of requestedCastawayIds) {
    if (owners[id] !== offeredToUid) {
      return {
        valid: false,
        reason: "Your trade partner no longer owns a requested player.",
      };
    }
  }

  const eliminated = new Set(eliminatedCastawayIds);
  if (allIds.some((id) => eliminated.has(id))) {
    return {
      valid: false,
      reason: "Eliminated players cannot be traded.",
    };
  }

  const pendingIds = new Set(
    existingTrades
      .filter((t) => t.status === "pending")
      .flatMap((t) => [...t.offered_castaway_ids, ...t.requested_castaway_ids]),
  );
  if (allIds.some((id) => pendingIds.has(id))) {
    return {
      valid: false,
      reason: "A player in this trade is part of another pending trade.",
    };
  }

  return { valid: true };
}
