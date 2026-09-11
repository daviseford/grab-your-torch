import type { Pool, PoolCounters, PoolDisplayMode } from "../types";
import { timestampToMillis } from "./poolPageState";
import type { PoolStandingsView } from "./poolStandingsRead";

/**
 * The homepage pool module, as a state machine and a copy deck (U9).
 *
 * WHY THIS IS A PURE MODULE. The module has eight cases and five of them are
 * on screen. This repo has no React Testing Library and no `.test.tsx` files,
 * so a state machine living inside a component is a state machine nobody can
 * assert on. Everything the module decides, and every string it says, is
 * therefore resolved here; `HomePool.tsx` is a rendering shell around
 * `getPoolModuleState` and `describePoolModule`.
 *
 * WHAT IT MAY READ, which is the load-bearing constraint (R22). The config
 * document, the counters document, and the projected standings view. No
 * season document over the network and no season module in the bundle: the
 * cast size and the pick count come off the config roster, the deadline comes
 * off the stored `freeze_at` (R11), and completion comes off `season_complete`
 * as the recompute job stamped it. Reading `win_survivor` from `events` would
 * contradict R22 and is not something a signed-out visitor could do anyway.
 * `src/utils/__tests__/importBoundaries.test.ts` enforces the bundle half of
 * that transitively from `Home.tsx`, and the signed-out Playwright project
 * enforces the network half on real request traffic.
 *
 * WHAT IT MAY SAY (R17, R25). Handles, totals and positions, plus the as-of
 * stamp the leaderboard prints for itself. No castaway name and no elimination
 * state reaches a state object or a string of copy here, and the test beside
 * this module asserts that over every state with a roster of invented names
 * that could not occur by chance.
 */

// ---------------------------------------------------------------------------
// Two numbers with reasons
// ---------------------------------------------------------------------------

/**
 * Below this many entrants the open state explains the competition without
 * quoting the count as social proof.
 *
 * The plan leaves the number open ("a judgment call to revisit with real
 * numbers") and this is the judgment. Twenty five is roughly one day of
 * arrivals at the rate the 2026-09-06 Reddit launch actually produced (62
 * signups over several days), and it is about the size of field that reads as
 * "a handful of people" rather than as a crowd. Under it a printed count
 * discourages more than it reassures; over it the count is useful evidence
 * on the page that the thing is real.
 *
 * It gates copy only. No leaderboard is ever suppressed by it, because the
 * open state has no standings to suppress: the pool is unscored until the
 * premiere by construction.
 */
export const POOL_LOW_ENTRANT_THRESHOLD = 25;

/**
 * How long after the freeze the premiere counts as still going out.
 *
 * `freeze_at` is 8:00 PM Eastern on the premiere date (KTD9), which is the
 * instant the broadcast starts, so it is also the only signal the module has
 * for "the episode has aired". Six hours covers a two hour premiere plus the
 * Pacific feed three hours behind it, and nothing turns on the exact figure:
 * on either side of it the module is telling a visitor that entries are
 * closed and no totals are published, and the two states differ only in
 * whether the premiere is described as happening or as having happened.
 *
 * The moment a standings document exists this constant stops mattering
 * entirely, because the mid-season state is decided by the published data.
 */
export const POOL_PREMIERE_AIRING_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * The facts a display state carries, all of them off the config and the
 * counters. Deliberately numbers and ids: nothing here can name a person.
 */
export type PoolModuleFacts = {
  seasonId: Pool["season_id"];
  seasonNum: number;
  /** Castaways on the config roster. The module never loads a season module. */
  castCount: number;
  picksPerEntry: number;
  /** Entrants as of the last counters write. An absent document means zero. */
  entryCount: number;
  /** The stored freeze instant in milliseconds, and the only deadline (R11). */
  freezeAtMs: number;
};

export type PoolModuleState =
  /** The config read is in flight. Renders the fixed-height placeholder. */
  | { kind: "pending" }
  /** The config resolved and there is no pool. Renders nothing of its own. */
  | { kind: "no-pool" }
  /** `display_mode` is not "full": the rollback lever, at any state. */
  | { kind: "hidden" }
  /** Entry is open. The dominant element on the page (KD6, R20). */
  | {
      kind: "open";
      /** Below POOL_LOW_ENTRANT_THRESHOLD the count is not quoted. */
      variant: "first-movers" | "open-field";
      facts: PoolModuleFacts;
    }
  /** Entries closed, premiere going out, nothing published. */
  | { kind: "frozen"; facts: PoolModuleFacts }
  /** The premiere has aired and the recompute has not published yet. */
  | { kind: "aired-unscored"; facts: PoolModuleFacts }
  /** Standings are published and the season is still running. */
  | { kind: "mid-season"; facts: PoolModuleFacts }
  /** `season_complete` is stamped on the config. */
  | { kind: "complete"; facts: PoolModuleFacts };

export type PoolModuleStateInput = {
  /** `pools/{poolId}`, from `usePool`. */
  pool: Pool | undefined;
  /** `usePool().isLoaded`. False while the config read is in flight. */
  poolLoaded: boolean;
  /** `pools/{poolId}/meta/counters`. Absent means zero entrants, not no pool. */
  counters: PoolCounters | undefined;
  /** The projected view from `usePoolStandings`, never a raw document. */
  standings: PoolStandingsView;
  /**
   * `pool?.display_mode`, passed explicitly so the lever is visible in the
   * signature rather than buried in the config object.
   */
  displayMode: PoolDisplayMode | undefined;
  /** Milliseconds since the epoch. */
  now: number;
};

const factsFor = (
  pool: Pool,
  counters: PoolCounters | undefined,
): PoolModuleFacts => ({
  seasonId: pool.season_id,
  seasonNum: pool.season_num,
  castCount: pool.roster?.length ?? 0,
  picksPerEntry: pool.picks_per_entry,
  // An absent counters document is zero entrants, never an absent pool. The
  // provisioning script writes it at zero for exactly this reason, but the
  // module must not fall apart if that write is ever missed.
  entryCount: counters?.entry_count ?? 0,
  freezeAtMs: timestampToMillis(pool.freeze_at),
});

/**
 * Which of the eight cases the module is in.
 *
 * The order of the checks is the whole design:
 *
 *  - `pending` comes before `no-pool`, because those two are what a cold load
 *    and a genuinely absent pool look like from the same starting point. A
 *    machine that collapsed them would render the absent case on every cold
 *    load and, having no placeholder, would shift the product identity and
 *    the start path down the page each time the module popped in (1b).
 *  - `hidden` comes next, so the rollback lever works at every display state
 *    rather than only at the ones that reach a leaderboard.
 *  - `complete` comes off the config before anything else is considered,
 *    because it is the one fact the job stamps that the browser cannot derive
 *    (R22).
 *  - published standings beat the clock, so a pool that has been scored is
 *    mid-season whatever the local machine thinks the time is.
 *  - only then does the clock decide, and only between the three states that
 *    have nothing published to look at.
 */
export const getPoolModuleState = ({
  pool,
  poolLoaded,
  counters,
  standings,
  displayMode,
  now,
}: PoolModuleStateInput): PoolModuleState => {
  if (!poolLoaded) return { kind: "pending" };
  if (!pool) return { kind: "no-pool" };
  if (displayMode !== "full") return { kind: "hidden" };

  const facts = factsFor(pool, counters);

  if (pool.season_complete) return { kind: "complete", facts };
  if (standings.kind === "ready") return { kind: "mid-season", facts };

  if (pool.status === "open" && now < facts.freezeAtMs) {
    return {
      kind: "open",
      variant:
        facts.entryCount < POOL_LOW_ENTRANT_THRESHOLD
          ? "first-movers"
          : "open-field",
      facts,
    };
  }

  if (now < facts.freezeAtMs + POOL_PREMIERE_AIRING_MS) {
    return { kind: "frozen", facts };
  }
  return { kind: "aired-unscored", facts };
};

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** What stands where the standings go. */
export type PoolModuleStandingsSlot =
  /** No standings exist and none are expected yet. One explanatory line. */
  | { kind: "none"; note: string }
  /**
   * Standings are expected and have not landed. Rendered through the
   * leaderboard's own awaiting-data slate so the treatment is the one the
   * pool page already uses, with this wording in place of its default.
   */
  | { kind: "awaiting"; title: string; body: string }
  /** The published leaderboard, which prints its own as-of stamp (R25). */
  | { kind: "leaderboard" };

export type PoolModuleCopy = {
  headline: string;
  support: string;
  action: { label: string; to: string };
  standings: PoolModuleStandingsSlot;
  /** True only while entry is open (KD6): the dominant treatment. */
  dominant: boolean;
};

const people = (n: number): string =>
  n === 1 ? "1 person has" : `${n} people have`;

const entries = (n: number): string =>
  n === 1 ? "1 entry is locked in" : `${n} entries are locked in`;

const poolRoute = (seasonId: Pool["season_id"]): string => `/pool/${seasonId}`;

/** Recompute from the deadline so a suspended tab never accumulates drift. */
export const getPoolCountdown = (freezeAtMs: number, now: number) => {
  const remaining = Math.max(0, Math.ceil((freezeAtMs - now) / 1000));
  return {
    days: Math.floor(remaining / 86400),
    hours: Math.floor((remaining % 86400) / 3600),
    minutes: Math.floor((remaining % 3600) / 60),
    seconds: remaining % 60,
  };
};

/**
 * Every string the module says, per state.
 *
 * Written here rather than at the call site so the six that render can be read
 * and reviewed as one set, which is what the plan asks for. Two rules bind all
 * of it: the pool vocabulary from U10 (cast, your picks, entry, handle,
 * standings, and never a draft's ownership words), and no em-dash in anything
 * a person reads.
 *
 * THE AIRED-UNSCORED WORDING IS THE ONE THAT MATTERS. It happens on premiere
 * night, when every entrant genuinely has zero points and the recompute has
 * not run. A leaderboard of zeroes there would be a plausible-looking lie
 * about a public surface, so the state says the totals have not been worked
 * out yet and points at the data landing rather than at the scores.
 *
 * Returns null for `pending` and `hidden`, which say nothing by design: one is
 * a placeholder holding a footprint and the other is a lever thrown by an
 * operator. `no-pool` does get copy: the homepage renders its fallback instead
 * of the module, so these strings are the answer of record for what the module
 * would say, and the surface that wants an absent-pool sentence has one to use
 * rather than inventing a second.
 */
export const describePoolModule = (
  state: PoolModuleState,
): PoolModuleCopy | null => {
  switch (state.kind) {
    case "pending":
    case "hidden":
      return null;

    case "no-pool":
      return {
        headline: "No season pool is open",
        support:
          "A pool opens for each season before it premieres, and anyone can enter alone. Until the next one opens, start a competition with friends on any season.",
        action: { label: "Pick a season to get started", to: "/seasons" },
        standings: {
          kind: "none",
          note: "Standings appear once a pool has been scored.",
        },
        dominant: false,
      };

    case "open": {
      const { seasonNum, seasonId, castCount, picksPerEntry, entryCount } =
        state.facts;
      const how = `Pick ${picksPerEntry} of the ${castCount} castaways and answer the predictions. Compete against everyone on Grab Your Torch on one sitewide leaderboard.`;
      return {
        headline: `Survivor ${seasonNum}: You vs. everyone`,
        support:
          state.variant === "first-movers"
            ? how
            : `${people(entryCount)} entered. ${how}`,
        action: { label: "Enter the season pool", to: poolRoute(seasonId) },
        standings: {
          kind: "none",
          note: "Standings open after the premiere. Nothing is scored until the first episode airs.",
        },
        dominant: true,
      };
    }

    case "frozen":
      return {
        headline: `Survivor ${state.facts.seasonNum} entries are closed`,
        support: `${entries(state.facts.entryCount)} and the premiere is here. Standings appear as soon as the first episode's data lands.`,
        action: { label: "See the pool", to: poolRoute(state.facts.seasonId) },
        standings: {
          kind: "awaiting",
          title: "Standings start after the first episode",
          body: "Nothing has been scored yet. Totals appear here once the first episode's data lands.",
        },
        dominant: false,
      };

    case "aired-unscored":
      return {
        headline: `Survivor ${state.facts.seasonNum} is being scored`,
        support:
          "The premiere has aired and the first totals are being worked out. Nobody is on zero: scoring lands once the episode data does.",
        action: { label: "See the pool", to: poolRoute(state.facts.seasonId) },
        standings: {
          kind: "awaiting",
          title: "Standings land with the episode data",
          body: "Scoring runs once each episode's data arrives. The first totals appear here as soon as it does.",
        },
        dominant: false,
      };

    case "mid-season":
      return {
        headline: `Survivor ${state.facts.seasonNum} season pool`,
        support:
          "Everyone who entered, ranked by what their picks have earned so far.",
        action: {
          label: "See the full standings",
          to: poolRoute(state.facts.seasonId),
        },
        standings: { kind: "leaderboard" },
        dominant: false,
      };

    case "complete":
      return {
        headline: `Survivor ${state.facts.seasonNum} season pool is finished`,
        support:
          "The season is over and the last update is in. These are the final totals.",
        action: {
          label: "See the full standings",
          to: poolRoute(state.facts.seasonId),
        },
        standings: { kind: "leaderboard" },
        dominant: false,
      };
  }
};

// ---------------------------------------------------------------------------
// R21: the pool where a person looks for their competitions
// ---------------------------------------------------------------------------

/**
 * The pools this user has an entry in, newest season first.
 *
 * Resolved by listing `pools` and getting `entries/{uid}`, never by a
 * collection-group query: there are none in this repo and the rules provide
 * no block for one. The caller does the two reads; this is the selection.
 */
export const selectEnteredPools = (
  pools: readonly Pool[],
  enteredPoolIds: ReadonlySet<string>,
): Pool[] =>
  pools
    .filter((pool) => enteredPoolIds.has(pool.id))
    .sort((a, b) => b.season_num - a.season_num);

export type PoolLifecycle = {
  /** Pool lifecycle wording, never the competition status vocabulary. */
  label: string;
  /**
   * Which status treatment to draw it in. A pool has no participant count and
   * no competition type, so it borrows the badge's look and none of its words.
   */
  tone: "open" | "closed" | "scoring" | "final";
};

/**
 * Where a pool is in its life, for the entrant's competitions list.
 *
 * The same freeze reading as the module (R11: the stored instant, never a
 * premiere date), and the kill switch checked before the clock so a pool
 * closed early explains itself as closed rather than as still open.
 */
export const describePoolLifecycle = (
  pool: Pool,
  now: number,
): PoolLifecycle => {
  if (pool.season_complete) return { label: "Final", tone: "final" };
  if (typeof pool.latest_episode_num === "number") {
    return { label: "Scoring", tone: "scoring" };
  }
  if (pool.status === "open" && now < timestampToMillis(pool.freeze_at)) {
    return { label: "Entries open", tone: "open" };
  }
  return { label: "Entries closed", tone: "closed" };
};
