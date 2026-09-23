import { describe, expect, it } from "vitest";
import type {
  CastawayId,
  Challenge,
  Competition,
  DraftPick,
  Episode,
  GameEvent,
  Season,
  Trade,
} from "../../types";
import {
  getCompetitionResult,
  getCompetitionTotals,
  rankCompetitionStandings,
  type CompetitionSeasonData,
} from "../competitionResult";
import { getPropBetScoresByUser } from "../propBetUtils";

const ALICE = "US0001" as CastawayId;
const BOB = "US0002" as CastawayId;
/** Undrafted: scores for nobody, so the Sole Survivor can be a neutral fact. */
const CARA = "US0003" as CastawayId;

const makeEpisode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: "season_46",
  season_num: 46,
  order,
  name: `Episode ${order}`,
  finale: order === 3,
  post_merge: order >= 2,
  merge_occurs: order === 2,
});

const season = {
  id: "season_46",
  order: 46,
  name: "Season 46",
  img: "",
  players: [ALICE, BOB, CARA].map((castaway_id) => ({ castaway_id })),
  episodes: [1, 2, 3].map(makeEpisode),
  castawayLookup: {},
} as unknown as Season;

const immunity = (id: string, episode: number, winners: CastawayId[]) =>
  ({
    id,
    season_id: "season_46",
    season_num: 46,
    episode_id: `episode_${episode}`,
    episode_num: episode,
    order: 1,
    variant: "immunity",
    winning_castaways: winners,
  }) as Challenge;

const event = (
  id: string,
  episode: number,
  action: GameEvent["action"],
  castaway_id: CastawayId,
) =>
  ({
    id,
    season_id: "season_46",
    season_num: 46,
    episode_id: `episode_${episode}`,
    episode_num: episode,
    action,
    multiplier: null,
    castaway_id,
  }) as GameEvent;

const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

const makeData = (
  challenges: Challenge[],
  events: GameEvent[],
): CompetitionSeasonData => ({
  season,
  challenges: byId(challenges),
  eliminations: {},
  events: byId(events),
});

const pick = (user_uid: string, castaway_id: CastawayId): DraftPick => ({
  season_id: "season_46",
  season_num: 46,
  order: 1,
  user_name: user_uid,
  user_uid,
  castaway_id,
  player_name: castaway_id,
});

const makeCompetition = (
  overrides: Partial<Competition> = {},
): Competition => ({
  id: "competition_test",
  competition_name: "Test",
  season_id: "season_46",
  season_num: 46,
  draft_id: "draft_test",
  creator_uid: "u1",
  participant_uids: ["u1", "u2"],
  participants: [
    { uid: "u1", displayName: "Ann", email: "ann@example.com", isAdmin: false },
    { uid: "u2", displayName: "Ben", email: "ben@example.com", isAdmin: false },
  ],
  draft_picks: [pick("u1", ALICE), pick("u2", BOB)],
  current_episode: null,
  finished: true,
  ...overrides,
});

// Alice wins the season; Bob only an early immunity.
const aliceWins = makeData(
  [immunity("challenge_1", 1, [BOB])],
  [event("event_win", 3, "win_survivor", ALICE)],
);

describe("rankCompetitionStandings", () => {
  it("gives equal totals the same rank and skips the next one", () => {
    const competition = makeCompetition({
      participant_uids: ["u1", "u2", "u3"],
      participants: [
        ...makeCompetition().participants,
        { uid: "u3", displayName: "Cy", email: "", isAdmin: false },
      ],
    });
    const standings = rankCompetitionStandings(competition, {
      u1: 10,
      u2: 10,
      u3: 4,
    });
    expect(standings.map((s) => [s.name, s.rank])).toEqual([
      ["Ann", 1],
      ["Ben", 1],
      ["Cy", 3],
    ]);
  });

  it("scores a participant with no total as zero", () => {
    const standings = rankCompetitionStandings(makeCompetition(), { u1: 3 });
    expect(standings.find((s) => s.uid === "u2")?.total).toBe(0);
  });
});

describe("getCompetitionResult", () => {
  it("names no winner while the competition is running, even with a leader", () => {
    expect(
      getCompetitionResult(makeCompetition({ finished: false }), aliceWins, []),
    ).toEqual({ kind: "in-progress" });
  });

  it("names the participant with the top total once finished", () => {
    const result = getCompetitionResult(makeCompetition(), aliceWins, []);
    expect(result.kind).toBe("decided");
    if (result.kind !== "decided") return;
    expect(result.winners.map((w) => w.name)).toEqual(["Ann"]);
    expect(result.winners[0].rank).toBe(1);
    expect(result.winners[0].total).toBeGreaterThan(0);
  });

  it("names every participant sharing the top total as tied winners", () => {
    const tied = makeData(
      [immunity("challenge_1", 1, [ALICE, BOB])],
      [event("event_win", 3, "win_survivor", CARA)],
    );
    const result = getCompetitionResult(makeCompetition(), tied, []);
    expect(result.kind).toBe("decided");
    if (result.kind !== "decided") return;
    expect(result.winners.map((w) => w.name)).toEqual(["Ann", "Ben"]);
    expect(result.winners[0].total).toBe(result.winners[1].total);
  });

  it("credits the Sole Survivor's finale points to whoever held them after a trade", () => {
    const trade: Trade = {
      id: "trade_1",
      competition_id: "competition_test",
      season_id: "season_46",
      offered_by_uid: "u1",
      offered_to_uid: "u2",
      offered_castaway_ids: [ALICE],
      requested_castaway_ids: [BOB],
      status: "accepted",
      effective_episode: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      resolved_at: "2026-01-01T00:00:00.000Z",
    };
    const result = getCompetitionResult(makeCompetition(), aliceWins, [trade]);
    expect(
      result.kind === "decided" && result.winners.map((w) => w.uid),
    ).toEqual(["u2"]);
  });

  it("ignores trades that were never accepted", () => {
    const pending: Trade = {
      id: "trade_1",
      competition_id: "competition_test",
      season_id: "season_46",
      offered_by_uid: "u1",
      offered_to_uid: "u2",
      offered_castaway_ids: [ALICE],
      requested_castaway_ids: [BOB],
      status: "pending",
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const result = getCompetitionResult(makeCompetition(), aliceWins, [
      pending,
    ]);
    expect(
      result.kind === "decided" && result.winners.map((w) => w.uid),
    ).toEqual(["u1"]);
  });

  it("withholds the winner from a watch-along group behind the finale, even if marked finished", () => {
    expect(
      getCompetitionResult(
        makeCompetition({ current_episode: 2 }),
        aliceWins,
        [],
      ),
    ).toEqual({ kind: "unavailable", reason: "finale-not-revealed" });
  });

  it("names the winner once a watch-along group reaches the finale", () => {
    const result = getCompetitionResult(
      makeCompetition({ current_episode: 3 }),
      aliceWins,
      [],
    );
    expect(
      result.kind === "decided" && result.winners.map((w) => w.uid),
    ).toEqual(["u1"]);
  });

  it("scores a watch-along group only through its own boundary", () => {
    // Bob's immunity is after episode 1; Alice's is in it.
    const data = makeData(
      [immunity("challenge_1", 1, [ALICE]), immunity("challenge_2", 2, [BOB])],
      [event("event_win", 3, "win_survivor", CARA)],
    );
    const totals = getCompetitionTotals(
      makeCompetition({ current_episode: 1 }),
      data,
      [],
    );
    expect(totals.u1).toBeGreaterThan(0);
    expect(totals.u2).toBe(0);
  });

  it("is unavailable when finished but the season has no Sole Survivor", () => {
    expect(
      getCompetitionResult(
        makeCompetition(),
        makeData([immunity("challenge_1", 1, [ALICE])], []),
        [],
      ),
    ).toEqual({ kind: "unavailable", reason: "finale-not-revealed" });
  });

  it("is unavailable rather than naming everyone when nobody scored", () => {
    expect(
      getCompetitionResult(
        makeCompetition(),
        makeData([], [event("event_win", 3, "win_survivor", CARA)]),
        [],
      ),
    ).toEqual({ kind: "unavailable", reason: "no-scores" });
  });

  it("is unavailable when there is nobody to rank", () => {
    expect(
      getCompetitionResult(
        makeCompetition({ participants: [], participant_uids: [] }),
        aliceWins,
        [],
      ),
    ).toEqual({ kind: "unavailable", reason: "no-participants" });
  });

  it("uses the team name, then falls back when a profile is missing", () => {
    const result = getCompetitionResult(
      makeCompetition({
        participants: [
          { uid: "u1", displayName: "", email: "", isAdmin: false },
          { uid: "u2", displayName: "Ben", email: "", isAdmin: false },
        ],
      }),
      aliceWins,
      [],
    );
    expect(result.kind === "decided" && result.winners[0].name).toBe(
      "Unknown participant",
    );

    const named = getCompetitionResult(
      makeCompetition({ team_names: { u1: "Torchbearers" } }),
      aliceWins,
      [],
    );
    expect(named.kind === "decided" && named.winners[0].name).toBe(
      "Torchbearers",
    );
  });

  it("counts prop bet points toward the total", () => {
    // Ben called the Sole Survivor; Ann did not.
    const competition = makeCompetition({
      prop_bets: [
        {
          id: "propbet_u2",
          user_name: "Ben",
          user_uid: "u2",
          values: { propbet_winner: ALICE },
        },
      ],
    });
    const propBets = getPropBetScoresByUser(
      aliceWins.events,
      {},
      aliceWins.challenges,
      new Set([2, 3]),
      true,
      competition,
    );
    const withProps = getCompetitionTotals(competition, aliceWins, []);
    const withoutProps = getCompetitionTotals(makeCompetition(), aliceWins, []);
    expect(propBets.u2?.total).toBeGreaterThan(0);
    expect(withProps.u2).toBe(withoutProps.u2 + propBets.u2.total);
  });
});
