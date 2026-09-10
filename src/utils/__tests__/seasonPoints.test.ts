import { sum } from "lodash-es";
import { describe, expect, it } from "vitest";
import {
  CastawayId,
  Challenge,
  Elimination,
  Episode,
  GameEvent,
} from "../../types";
import { EnhancedScores, getEnhancedSurvivorPoints } from "../scoringUtils";
import { getSeasonPointsByCastaway } from "../seasonPoints";

// --- Fixture ---

const ALICE = "US0001" as CastawayId;
const BOB = "US0002" as CastawayId;
const CHARLIE = "US0003" as CastawayId;
/** On nobody's roster and in no records: proves absence still scores zero. */
const DANA = "US0004" as CastawayId;

const makeEpisode = (order: number): Episode => ({
  id: `episode_${order}`,
  season_id: "season_46",
  season_num: 46,
  order,
  name: `Episode ${order}`,
  finale: false,
  post_merge: order >= 2,
  merge_occurs: order === 2,
});

const episodes: Episode[] = [1, 2, 3].map(makeEpisode);

const challenges: Challenge[] = [
  {
    id: "challenge_1",
    season_id: "season_46",
    season_num: 46,
    episode_id: "episode_1",
    episode_num: 1,
    order: 1,
    variant: "immunity",
    winning_castaways: [ALICE],
  },
  {
    id: "challenge_2",
    season_id: "season_46",
    season_num: 46,
    episode_id: "episode_2",
    episode_num: 2,
    order: 1,
    variant: "reward",
    winning_castaways: [BOB],
  },
];

const eliminations: Elimination[] = [
  {
    id: "elimination_1",
    season_id: "season_46",
    season_num: 46,
    episode_id: "episode_2",
    episode_num: 2,
    castaway_id: CHARLIE,
    order: 1,
    variant: "tribal",
  },
];

const events: GameEvent[] = [
  {
    id: "event_1",
    season_id: "season_46",
    season_num: 46,
    episode_id: "episode_3",
    episode_num: 3,
    action: "find_idol",
    multiplier: null,
    castaway_id: ALICE,
  },
];

const castawayIds: CastawayId[] = [ALICE, BOB, CHARLIE, DANA];

/**
 * Characterization oracle: a verbatim copy of the per-castaway memo that lived
 * in `useScoringCalculations` before `getSeasonPointsByCastaway` was extracted.
 * Kept here so the extraction is proven equivalent rather than assumed.
 */
const legacySurvivorPointsByEpisode = (): Record<string, EnhancedScores[]> =>
  castawayIds.reduce<Record<string, EnhancedScores[]>>((accum, castawayId) => {
    accum[castawayId] = episodes.map((e) =>
      getEnhancedSurvivorPoints(
        challenges,
        eliminations,
        events,
        e.order,
        castawayId,
      ),
    );
    return accum;
  }, {});

const totals = (byCastaway: Record<string, EnhancedScores[]>) =>
  Object.entries(byCastaway).reduce<Record<string, number>>(
    (accum, [castawayId, perEpisode]) => {
      accum[castawayId] = sum(perEpisode.map((x) => x.total));
      return accum;
    },
    {},
  );

// --- Tests ---

describe("characterization baseline (pre-extraction behavior)", () => {
  it("pins the per-castaway per-episode totals the hook produced", () => {
    const legacy = legacySurvivorPointsByEpisode();

    expect(legacy[ALICE].map((x) => x.total)).toEqual([3, 0, 1]);
    expect(legacy[BOB].map((x) => x.total)).toEqual([0, 2, 0]);
    expect(legacy[CHARLIE].map((x) => x.total)).toEqual([0, 2, 0]);
    expect(legacy[DANA].map((x) => x.total)).toEqual([0, 0, 0]);

    expect(totals(legacy)).toEqual({
      [ALICE]: 4,
      [BOB]: 2,
      [CHARLIE]: 2,
      [DANA]: 0,
    });
  });

  it("pins the competition standings the hook derived from those points", () => {
    const legacy = legacySurvivorPointsByEpisode();

    // The roster sum `useScoringCalculations` performs per participant, with
    // no trades in play. Ownership helpers are deliberately not imported here:
    // pool code must stay clear of them (KTD10).
    const rosters: Record<string, CastawayId[]> = {
      user1: [ALICE, BOB],
      user2: [CHARLIE],
    };

    const standings = Object.entries(rosters).reduce<Record<string, number[]>>(
      (accum, [uid, roster]) => {
        accum[uid] = episodes.map((e) =>
          sum(roster.map((id) => legacy[id]?.[e.order - 1]?.total || 0)),
        );
        return accum;
      },
      {},
    );

    expect(standings).toEqual({
      user1: [3, 2, 1],
      user2: [0, 2, 0],
    });
  });
});

describe("getSeasonPointsByCastaway", () => {
  it("reproduces the per-castaway totals the hook produced", () => {
    expect(
      getSeasonPointsByCastaway(
        challenges,
        eliminations,
        events,
        episodes,
        castawayIds,
      ),
    ).toEqual(legacySurvivorPointsByEpisode());
  });

  it("scores a castaway on no roster identically to one on many rosters", () => {
    const points = getSeasonPointsByCastaway(
      challenges,
      eliminations,
      events,
      episodes,
      castawayIds,
    );

    // BOB sits on one roster in the fixture above and CHARLIE on another;
    // both earned 2. Rosters are not an input, so the scores must match.
    expect(sum(points[BOB].map((x) => x.total))).toBe(
      sum(points[CHARLIE].map((x) => x.total)),
    );

    // DANA is on no roster at all and still gets a dense, zeroed row.
    expect(points[DANA].map((x) => x.total)).toEqual([0, 0, 0]);
  });

  it("contributes zero, not undefined, for an episode with no records", () => {
    const points = getSeasonPointsByCastaway(
      challenges,
      eliminations,
      events,
      episodes,
      castawayIds,
    );

    // Episode 2 has nothing for ALICE.
    expect(points[ALICE][1]).toEqual({
      episode_num: 2,
      total: 0,
      actions: [],
    });
    expect(points[ALICE][1].total).not.toBeUndefined();
  });

  it("returns one dense row per episode, keyed by episode order", () => {
    const points = getSeasonPointsByCastaway(
      challenges,
      eliminations,
      events,
      episodes,
      castawayIds,
    );

    Object.values(points).forEach((perEpisode) => {
      expect(perEpisode).toHaveLength(episodes.length);
      expect(perEpisode.map((x) => x.episode_num)).toEqual([1, 2, 3]);
    });
  });

  it("returns an empty map when there are no castaways", () => {
    expect(
      getSeasonPointsByCastaway(challenges, eliminations, events, episodes, []),
    ).toEqual({});
  });

  it("returns an empty row per castaway when no episodes have aired", () => {
    const points = getSeasonPointsByCastaway(
      challenges,
      eliminations,
      events,
      [],
      castawayIds,
    );

    expect(points[ALICE]).toEqual([]);
    expect(Object.keys(points)).toHaveLength(castawayIds.length);
  });
});
