/**
 * The Competitions page's read cache across sign-outs and account switches.
 *
 * The navbar signs out in place, so the page (and `useCompetitionResults`)
 * stays mounted from one account to the next. This project has no React
 * Testing Library, so every decision the hook makes about which reads to
 * start, which results to keep, and what to show lives here. The in-browser
 * counterpart is the "in-place sign-out and account switch" test in
 * `e2e/auth-flows.spec.ts`.
 */

import { describe, expect, it } from "vitest";
import type {
  CastawayId,
  Competition,
  Episode,
  GameEvent,
  Season,
} from "../../types";
import type { CompetitionSeasonData } from "../competitionResult";
import {
  applyResultRead,
  createResultsSession,
  listForUser,
  planResultReads,
  resolveCompetitionResults,
  type ResultsSession,
} from "../competitionResultsSession";

const ALICE = "US0001" as CastawayId;
const BOB = "US0002" as CastawayId;

const makeEpisode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: "season_46",
  season_num: 46,
  order,
  name: `Episode ${order}`,
  finale: order === 2,
  post_merge: false,
  merge_occurs: false,
});

// Alice is the Sole Survivor, so whoever drafted her wins.
const seasonData = {
  season: {
    id: "season_46",
    order: 46,
    name: "Season 46",
    img: "",
    players: [ALICE, BOB].map((castaway_id) => ({ castaway_id })),
    episodes: [1, 2].map(makeEpisode),
    castawayLookup: {},
  } as unknown as Season,
  challenges: {},
  eliminations: {},
  events: {
    event_win: {
      id: "event_win",
      season_id: "season_46",
      season_num: 46,
      episode_id: "episode_2",
      episode_num: 2,
      action: "win_survivor",
      multiplier: null,
      castaway_id: ALICE,
    } as GameEvent,
  },
} as CompetitionSeasonData;

const makeCompetition = (
  id: string,
  overrides: Partial<Competition> = {},
): Competition =>
  ({
    id,
    competition_name: id,
    season_id: "season_46",
    season_num: 46,
    draft_id: `draft_${id}`,
    creator_uid: "u1",
    participant_uids: ["u1", "u2"],
    participants: [
      { uid: "u1", displayName: "Ann", email: "", isAdmin: false },
      { uid: "u2", displayName: "Ben", email: "", isAdmin: false },
    ],
    draft_picks: [
      { user_uid: "u1", castaway_id: ALICE },
      { user_uid: "u2", castaway_id: BOB },
    ].map((p, i) => ({
      ...p,
      season_id: "season_46",
      season_num: 46,
      order: i + 1,
      user_name: p.user_uid,
      player_name: p.castaway_id,
    })),
    current_episode: null,
    finished: true,
    ...overrides,
  }) as Competition;

const won = makeCompetition("competition_a" as Competition["id"]);
const alsoWon = makeCompetition("competition_b" as Competition["id"]);
const running = makeCompetition("competition_c" as Competition["id"], {
  finished: false,
});

/** Plans and completes every read for `competitions` in `session`. */
const loadAll = (session: ResultsSession, competitions: Competition[]) =>
  planResultReads(session, competitions).reduce(
    (current, read) =>
      applyResultRead(
        current,
        session.token,
        read,
        read.kind === "season" ? seasonData : [],
      ),
    session,
  );

describe("planResultReads", () => {
  it("reads season data once per season and trades once per finished competition", () => {
    const session = createResultsSession("u1");
    expect(planResultReads(session, [won, alsoWon, running])).toEqual([
      { kind: "season", seasonId: "season_46" },
      { kind: "trades", competitionId: "competition_a" },
      { kind: "trades", competitionId: "competition_b" },
    ]);
  });

  it("never repeats a read within one session", () => {
    const session = createResultsSession("u1");
    planResultReads(session, [won]);
    expect(planResultReads(session, [won, alsoWon])).toEqual([
      { kind: "trades", competitionId: "competition_b" },
    ]);
  });

  it("reads nothing while signed out", () => {
    expect(planResultReads(createResultsSession(undefined), [won])).toEqual([]);
  });

  it("reads again in a new session for the same user", () => {
    // Reads refused while signed out were recorded as failures in the old
    // session; signing back in must not reuse them.
    const first = createResultsSession("u1");
    planResultReads(first, [won]);
    expect(planResultReads(createResultsSession("u1"), [won])).toHaveLength(2);
  });
});

describe("applyResultRead", () => {
  it("records a read made in the current session", () => {
    const session = createResultsSession("u1");
    const [read] = planResultReads(session, [won]);
    const next = applyResultRead(session, session.token, read, seasonData);
    expect(next.seasonData.season_46).toBe(seasonData);
    expect(next.token).toBe(session.token);
    expect(next.requested).toBe(session.requested);
  });

  it("drops a read that lands after its session ended", () => {
    const signedOut = createResultsSession("u1");
    const [read] = planResultReads(signedOut, [won]);
    const signedBackIn = createResultsSession("u1");
    // The refusal from the signed-out moment arrives late.
    expect(applyResultRead(signedBackIn, signedOut.token, read, null)).toBe(
      signedBackIn,
    );
  });
});

describe("resolveCompetitionResults", () => {
  it("answers a running competition without reads and waits on finished ones", () => {
    const results = resolveCompetitionResults(
      [won, running],
      createResultsSession("u1"),
      "u1",
    );
    expect(results.competition_c).toEqual({ kind: "in-progress" });
    expect(results.competition_a).toEqual({ kind: "loading" });
  });

  it("names the winner once the session's reads are in", () => {
    const result = resolveCompetitionResults(
      [won],
      loadAll(createResultsSession("u1"), [won]),
      "u1",
    ).competition_a;
    expect(result.kind).toBe("decided");
    if (result.kind !== "decided") return;
    expect(result.winners.map((w) => w.name)).toEqual(["Ann"]);
  });

  it("shows a failed read as unavailable", () => {
    const session = createResultsSession("u1");
    const failed = planResultReads(session, [won]).reduce(
      (current, read) => applyResultRead(current, session.token, read, null),
      session,
    );
    expect(
      resolveCompetitionResults([won], failed, "u1").competition_a,
    ).toEqual({ kind: "unavailable", reason: "read-failed" });
  });

  it("shows nothing from another account's session", () => {
    // The render between an account switch and the session reset: the old
    // session is still in state but belongs to someone else.
    const adminSession = loadAll(createResultsSession("admin"), [won]);
    expect(
      resolveCompetitionResults([won], adminSession, "u2").competition_a,
    ).toEqual({ kind: "loading" });
    expect(
      resolveCompetitionResults([won], adminSession, undefined).competition_a,
    ).toEqual({ kind: "loading" });
  });
});

describe("listForUser", () => {
  const list = { uid: "admin", data: [won, alsoWon] };

  it("returns the list to the account it was read for", () => {
    expect(listForUser(list, "admin")).toEqual([won, alsoWon]);
  });

  it("hides the list after a sign-out", () => {
    expect(listForUser(list, undefined)).toEqual([]);
  });

  it("hides the list from the next account on the same page", () => {
    expect(listForUser(list, "u2")).toEqual([]);
  });

  it("hides a list that was never read", () => {
    expect(listForUser({ uid: undefined, data: [won] }, undefined)).toEqual([]);
  });
});
