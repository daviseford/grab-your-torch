import { describe, expect, it } from "vitest";
import type {
  CastawayId,
  Challenge,
  Competition,
  Elimination,
  Episode,
  Season,
  SlimUser,
  Trade,
} from "../../types";
import {
  PROP_BET_MIN_RESOLVED,
  computeCompetitionOutcome,
  computeMyStats,
  rankOfTotal,
  sortOutcomes,
  type CompetitionOutcome,
  type ScoredOutcome,
  type SeasonResults,
} from "../myStats";

const C1 = "US0001" as CastawayId;
const C2 = "US0002" as CastawayId;
const C3 = "US0003" as CastawayId;
const C4 = "US0004" as CastawayId;
/** On nobody's roster: the first boot, so prop bets can resolve. */
const C5 = "US0005" as CastawayId;

const ME = "uid_me";
const BOB = "uid_bob";
const CARA = "uid_cara";
const DAN = "uid_dan";

const user = (uid: string): SlimUser => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  isAdmin: false,
});

const episode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: "season_50",
  season_num: 50,
  order,
  name: `Episode ${order}`,
  finale: order === 3,
  post_merge: order >= 2,
  merge_occurs: order === 2,
});

const challenge = (
  n: number,
  episodeNum: number,
  variant: Challenge["variant"],
  winners: CastawayId[],
): Challenge => ({
  id: `challenge_${n}`,
  season_id: "season_50",
  season_num: 50,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  order: 1,
  variant,
  winning_castaways: winners,
});

const firstBoot: Elimination = {
  id: "elimination_1",
  season_id: "season_50",
  season_num: 50,
  episode_id: "episode_1",
  episode_num: 1,
  castaway_id: C5,
  order: 1,
  variant: "tribal",
};

const season = {
  id: "season_50",
  order: 50,
  name: "Fixture",
  img: "",
  players: [C1, C2, C3, C4, C5].map((castaway_id) => ({
    season_id: "season_50",
    season_num: 50,
    castaway_id,
    full_name: castaway_id,
    img: "",
  })),
  episodes: [1, 2, 3].map(episode),
  castawayLookup: {},
} as unknown as Season;

/**
 * Immunity is worth 3 and reward 2. Through episode 3 that is C1 = 3 + 2 = 5
 * and C2 = 3 + 3 = 6; C3 and C4 never win anything.
 */
const results = (overrides: Partial<SeasonResults> = {}): SeasonResults => ({
  season,
  challenges: Object.fromEntries(
    [
      challenge(1, 1, "immunity", [C1]),
      challenge(2, 2, "immunity", [C2]),
      challenge(3, 2, "reward", [C1]),
      challenge(4, 3, "immunity", [C2]),
    ].map((c) => [c.id, c]),
  ),
  eliminations: { [firstBoot.id]: firstBoot },
  events: {},
  ...overrides,
});

const competition = (overrides: Partial<Competition> = {}): Competition =>
  ({
    id: "competition_a",
    competition_name: "Fixture League",
    season_id: "season_50",
    season_num: 50,
    draft_id: "draft_a",
    creator_uid: ME,
    participant_uids: [ME, BOB, CARA, DAN],
    participants: [ME, BOB, CARA, DAN].map(user),
    draft_picks: [
      [C1, ME],
      [C2, BOB],
      [C3, CARA],
      [C4, DAN],
    ].map(([castaway_id, user_uid], i) => ({
      season_id: "season_50",
      season_num: 50,
      order: i + 1,
      user_name: user_uid,
      user_uid,
      castaway_id,
      player_name: castaway_id,
    })),
    current_episode: null,
    finished: false,
    ...overrides,
  }) as Competition;

const scored = (o: CompetitionOutcome): ScoredOutcome => {
  if (o.kind !== "scored") throw new Error(`expected scored, got ${o.reason}`);
  return o;
};

const myOutcome = (
  c: Competition,
  r: SeasonResults | null,
  t: Trade[] | null,
) => computeCompetitionOutcome(c, r, t, ME);

describe("rankOfTotal", () => {
  it("shares a rank between ties and skips the next", () => {
    const totals = [9, 9, 4, 0];
    expect(rankOfTotal(totals, 9)).toBe(1);
    expect(rankOfTotal(totals, 4)).toBe(3);
    expect(rankOfTotal(totals, 0)).toBe(4);
  });
});

describe("computeCompetitionOutcome", () => {
  it("scores a live competition through every episode", () => {
    const o = scored(myOutcome(competition(), results(), []));
    expect(o.total).toBe(5);
    expect(o.rank).toBe(2); // Bob has 6
    expect(o.fieldSize).toBe(4);
    expect(o.started).toBe(true);
  });

  it("adds prop-bet points to the total, matching the scoreboard", () => {
    const withBets = competition({
      prop_bets: [
        {
          id: "propbet_me",
          user_name: "me",
          user_uid: ME,
          values: { propbet_first_vote: C5 },
        },
        {
          id: "propbet_bob",
          user_name: "bob",
          user_uid: BOB,
          values: { propbet_first_vote: C1 },
        },
      ],
    });
    const me = scored(myOutcome(withBets, results(), []));
    // 5 challenge points + 4 for calling the first boot.
    expect(me.total).toBe(9);
    expect(me.rank).toBe(1);
    expect(me.propBets).toEqual({ correct: 1, resolved: 1 });
    const bob = scored(computeCompetitionOutcome(withBets, results(), [], BOB));
    expect(bob.total).toBe(6);
    expect(bob.propBets).toEqual({ correct: 0, resolved: 1 });
  });

  it("counts neither unsettled nor unanswered bets as resolved", () => {
    const o = scored(
      myOutcome(
        competition({
          prop_bets: [
            {
              id: "propbet_me",
              user_name: "me",
              user_uid: ME,
              // Nothing has settled a winner bet, and the medevac bet is blank.
              values: { propbet_winner: C1, propbet_medical_evac: "" },
            },
          ],
        }),
        results({ eliminations: {} }),
        [],
      ),
    );
    expect(o.propBets).toEqual({ correct: 0, resolved: 0 });
  });

  it("only sees episodes up to the competition's own boundary", () => {
    const o = scored(
      myOutcome(competition({ current_episode: 1 }), results(), []),
    );
    // Episode 1 only: C1 has 3, nothing else has scored, so I lead.
    expect(o.total).toBe(3);
    expect(o.rank).toBe(1);
  });

  it("does not settle prop bets from episodes past the boundary", () => {
    const bet = {
      id: "propbet_me" as const,
      user_name: "me",
      user_uid: ME,
      values: { propbet_first_vote: C5 },
    };
    // The first boot happened in episode 1: revealed at boundary 1, hidden at 0.
    const seen = scored(
      myOutcome(
        competition({ current_episode: 1, prop_bets: [bet] }),
        results(),
        [],
      ),
    );
    expect(seen.propBets.resolved).toBe(1);
    const hidden = scored(
      myOutcome(
        competition({ current_episode: 0, prop_bets: [bet] }),
        results(),
        [],
      ),
    );
    expect(hidden.propBets.resolved).toBe(0);
    expect(hidden.total).toBe(0);
  });

  it("reports nothing revealed at boundary 0", () => {
    const o = scored(
      myOutcome(competition({ current_episode: 0 }), results(), []),
    );
    expect(o.started).toBe(false);
    expect(o.total).toBe(0);
  });

  it("gives tied participants the same rank and skips the next", () => {
    const tied = results({
      challenges: { challenge_1: challenge(1, 1, "immunity", [C1, C2]) },
    });
    const c = competition();
    expect(scored(computeCompetitionOutcome(c, tied, [], ME)).rank).toBe(1);
    expect(scored(computeCompetitionOutcome(c, tied, [], BOB)).rank).toBe(1);
    expect(scored(computeCompetitionOutcome(c, tied, [], CARA)).rank).toBe(3);
  });

  it("moves points only from a trade's effective episode onward", () => {
    const trade = {
      id: "trade_1",
      competition_id: "competition_a",
      season_id: "season_50",
      offered_by_uid: ME,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 2,
      created_at: "2026-01-01T00:00:00.000Z",
    } as Trade;
    const me = scored(myOutcome(competition(), results(), [trade]));
    // C1 in episode 1 (3), then C2 in episodes 2 and 3 (3 + 3).
    expect(me.total).toBe(9);
    const bob = scored(
      computeCompetitionOutcome(competition(), results(), [trade], BOB),
    );
    // C2 scored nothing in episode 1; C1 gives 2 in episode 2 and 0 in 3.
    expect(bob.total).toBe(2);
  });

  it("is unavailable, never zero, when season results are missing", () => {
    expect(myOutcome(competition(), null, [])).toMatchObject({
      kind: "unavailable",
      reason: "season_results",
    });
  });

  it("is unavailable, never zero, when trades could not be read", () => {
    expect(myOutcome(competition(), results(), null)).toMatchObject({
      kind: "unavailable",
      reason: "trades",
    });
  });

  it("is unavailable when the user is not on the participant list", () => {
    const c = competition({ participants: [BOB, CARA, DAN].map(user) });
    expect(myOutcome(c, results(), [])).toMatchObject({
      kind: "unavailable",
      reason: "not_a_participant",
    });
  });

  it("handles legacy documents with no prop_bets or team_names", () => {
    const c = competition();
    expect(c.prop_bets).toBeUndefined();
    expect(c.team_names).toBeUndefined();
    const o = scored(myOutcome(c, results(), []));
    expect(o.propBets).toEqual({ correct: 0, resolved: 0 });
  });
});

const outcome = (
  overrides: Partial<ScoredOutcome> & {
    finished?: boolean;
    name?: string;
  } = {},
): ScoredOutcome => {
  const { finished = true, name = "League", ...rest } = overrides;
  return {
    kind: "scored",
    competition: competition({
      id: `competition_${name}` as Competition["id"],
      competition_name: name,
      finished,
    }),
    rank: 1,
    fieldSize: 4,
    total: 10,
    started: true,
    propBets: { correct: 0, resolved: 0 },
    ...rest,
  };
};

describe("computeMyStats", () => {
  it("returns null averages and rates with nothing finished", () => {
    const stats = computeMyStats([outcome({ finished: false })]);
    expect(stats).toMatchObject({
      entered: 1,
      active: 1,
      finished: 0,
      completed: 0,
      wins: 0,
      winRate: null,
      bestFinish: null,
      averageFinish: null,
      highestTotal: null,
    });
    expect(stats.podiums).toEqual({ count: 0, eligible: 0 });
    expect(stats.smallSample).toBe(false);
  });

  it("keeps active competitions out of every record stat", () => {
    const stats = computeMyStats([
      outcome({ name: "Done", rank: 2, total: 5 }),
      outcome({
        name: "Running",
        finished: false,
        rank: 1,
        total: 99,
        propBets: { correct: 9, resolved: 9 },
      }),
    ]);
    expect(stats.entered).toBe(2);
    expect(stats.active).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.wins).toBe(0);
    expect(stats.highestTotal?.total).toBe(5);
    expect(stats.bestFinish?.rank).toBe(2);
    expect(stats.propBets.resolved).toBe(0);
  });

  it("counts co-champions as full wins", () => {
    const stats = computeMyStats([
      outcome({ name: "A", rank: 1 }),
      outcome({ name: "B", rank: 1 }),
      outcome({ name: "C", rank: 3 }),
      outcome({ name: "D", rank: 4 }),
    ]);
    expect(stats.wins).toBe(2);
    expect(stats.winRate).toBe(0.5);
  });

  it("leaves competitions of fewer than four out of the podium entirely", () => {
    const stats = computeMyStats([
      outcome({ name: "Trio", rank: 2, fieldSize: 3 }),
      outcome({ name: "Quad", rank: 3, fieldSize: 4 }),
      outcome({ name: "Big", rank: 5, fieldSize: 8 }),
    ]);
    expect(stats.podiums).toEqual({ count: 1, eligible: 2 });
    // The trio still counts toward wins and averages.
    expect(stats.completed).toBe(3);
  });

  it("prefers the larger field between equal best finishes", () => {
    const stats = computeMyStats([
      outcome({ name: "Small", rank: 1, fieldSize: 3 }),
      outcome({ name: "Large", rank: 1, fieldSize: 8 }),
    ]);
    expect(stats.bestFinish).toMatchObject({ rank: 1, fieldSize: 8 });
  });

  it("averages finish and field size", () => {
    const stats = computeMyStats([
      outcome({ name: "A", rank: 1, fieldSize: 4 }),
      outcome({ name: "B", rank: 4, fieldSize: 8 }),
    ]);
    expect(stats.averageFinish).toEqual({ rank: 2.5, fieldSize: 6 });
  });

  it("reports the highest single total, not a sum", () => {
    const stats = computeMyStats([
      outcome({ name: "A", total: 40 }),
      outcome({ name: "B", total: 70 }),
    ]);
    expect(stats.highestTotal).toMatchObject({ total: 70 });
    expect(stats.highestTotal?.competition.competition_name).toBe("B");
  });

  it("flags a small sample under three completed competitions", () => {
    expect(computeMyStats([outcome({ name: "A" })]).smallSample).toBe(true);
    expect(
      computeMyStats(["A", "B", "C"].map((name) => outcome({ name })))
        .smallSample,
    ).toBe(false);
  });

  it("keeps unavailable competitions in 'entered' only", () => {
    const broken: CompetitionOutcome = {
      kind: "unavailable",
      competition: competition({ finished: true, competition_name: "Broken" }),
      reason: "season_results",
    };
    const stats = computeMyStats([broken, outcome({ name: "Fine", rank: 2 })]);
    expect(stats.entered).toBe(2);
    expect(stats.finished).toBe(2);
    expect(stats.unavailable).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.winRate).toBe(0);
  });

  it("only calls prop-bet accuracy sufficient at the minimum resolved count", () => {
    const few = computeMyStats([
      outcome({
        propBets: { correct: 2, resolved: PROP_BET_MIN_RESOLVED - 1 },
      }),
    ]);
    expect(few.propBets.sufficient).toBe(false);
    const enough = computeMyStats([
      outcome({ name: "A", propBets: { correct: 2, resolved: 3 } }),
      outcome({ name: "B", propBets: { correct: 1, resolved: 2 } }),
    ]);
    expect(enough.propBets).toMatchObject({
      correct: 3,
      resolved: 5,
      sufficient: true,
    });
  });
});

describe("sortOutcomes", () => {
  it("orders newest season first, then by name", () => {
    const a = outcome({ name: "B" });
    const b = outcome({ name: "A" });
    const newer = outcome({ name: "Z" });
    newer.competition = { ...newer.competition, season_num: 51 };
    expect(
      sortOutcomes([a, b, newer]).map((o) => o.competition.competition_name),
    ).toEqual(["Z", "A", "B"]);
  });
});
