import { describe, expect, it } from "vitest";
import {
  CastawayId,
  Competition,
  DraftPick,
  Episode,
  Season,
  SlimUser,
  Trade,
} from "../../types";
import {
  getAcquisitionLabel,
  getAcquisitionsAtEpisode,
  getCurrentOwners,
  getDrafters,
  getEffectiveEpisode,
  getOwnedCastawaysAtEpisode,
  getOwnerAtEpisode,
  getOwnersAtEpisode,
  getOwnershipWindows,
  getRosterEpisode,
  getTradeLockEpisode,
  getUpcomingMoveLabel,
  getUpcomingMoves,
  validateTrade,
} from "../tradeUtils";

const C1 = "US0001" as CastawayId;
const C2 = "US0002" as CastawayId;
const C3 = "US0003" as CastawayId;
const C4 = "US0004" as CastawayId;

const ALICE = "uid_alice";
const BOB = "uid_bob";
const CAROL = "uid_carol";

const makePick = (castawayId: CastawayId, uid: string): DraftPick => ({
  season_id: "season_50",
  season_num: 50,
  order: 1,
  user_name: uid,
  user_uid: uid,
  castaway_id: castawayId,
  player_name: castawayId,
});

const makeTrade = (
  overrides: Partial<Trade> & Pick<Trade, "offered_by_uid" | "offered_to_uid">,
): Trade => ({
  id: `trade_${Math.random()}`,
  competition_id: "competition_test",
  season_id: "season_50",
  offered_castaway_ids: [],
  requested_castaway_ids: [],
  status: "pending",
  created_at: "2026-03-10T00:00:00.000Z",
  ...overrides,
});

const makeEpisode = (order: number, airDate?: string): Episode => ({
  id: `episode_${order}`,
  season_id: "season_50",
  season_num: 50,
  order,
  name: `Episode ${order}`,
  ...(airDate !== undefined ? { air_date: airDate } : {}),
  finale: false,
  post_merge: false,
  merge_occurs: false,
});

const makeSeason = (episodes: Episode[] = []): Season => ({
  id: "season_50",
  order: 50,
  name: "Survivor 50",
  img: "",
  players: [],
  episodes,
  castawayLookup: {},
});

const makeCompetition = (
  draftPicks: DraftPick[],
  overrides: Partial<Competition> = {},
): Competition => ({
  id: "competition_test",
  competition_name: "Test League",
  season_id: "season_50",
  season_num: 50,
  draft_id: "draft_test",
  creator_uid: ALICE,
  participant_uids: [ALICE, BOB, CAROL],
  participants: [],
  draft_picks: draftPicks,
  current_episode: null,
  finished: false,
  ...overrides,
});

// A fixed Wednesday: 2026-03-11.
const WEDNESDAY = new Date(2026, 2, 11, 12, 0, 0);

describe("getOwnershipWindows / getOwnerAtEpisode", () => {
  const picks = [makePick(C1, ALICE), makePick(C2, BOB)];

  it("assigns the drafter from episode 1 when there are no trades", () => {
    const windows = getOwnershipWindows(picks, []);
    expect(getOwnerAtEpisode(windows, C1, 1)).toBe(ALICE);
    expect(getOwnerAtEpisode(windows, C1, 99)).toBe(ALICE);
    expect(getOwnerAtEpisode(windows, C2, 5)).toBe(BOB);
  });

  it("moves ownership from the effective episode onward", () => {
    const trade = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 5,
    });
    const windows = getOwnershipWindows(picks, [trade]);

    // Alice keeps C1's points through episode 4
    expect(getOwnerAtEpisode(windows, C1, 4)).toBe(ALICE);
    // Bob owns C1 from episode 5 on
    expect(getOwnerAtEpisode(windows, C1, 5)).toBe(BOB);
    expect(getOwnerAtEpisode(windows, C1, 13)).toBe(BOB);
    // And C2 moves the other way
    expect(getOwnerAtEpisode(windows, C2, 4)).toBe(BOB);
    expect(getOwnerAtEpisode(windows, C2, 5)).toBe(ALICE);
  });

  it("ignores pending/rejected/canceled trades", () => {
    const pending = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "pending",
    });
    const rejected = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "rejected",
      effective_episode: 3,
    });
    const windows = getOwnershipWindows(picks, [pending, rejected]);
    expect(getOwnerAtEpisode(windows, C1, 13)).toBe(ALICE);
  });

  it("supports chained trades of the same castaway", () => {
    const first = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 3,
    });
    const second = makeTrade({
      offered_by_uid: BOB,
      offered_to_uid: CAROL,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C3],
      status: "accepted",
      effective_episode: 7,
    });
    const windows = getOwnershipWindows(
      [...picks, makePick(C3, CAROL)],
      [second, first], // unordered input is fine
    );

    expect(getOwnerAtEpisode(windows, C1, 2)).toBe(ALICE);
    expect(getOwnerAtEpisode(windows, C1, 3)).toBe(BOB);
    expect(getOwnerAtEpisode(windows, C1, 6)).toBe(BOB);
    expect(getOwnerAtEpisode(windows, C1, 7)).toBe(CAROL);
  });

  it("orders trades with equal effective episodes by resolution time", () => {
    const first = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 14,
      resolved_at: "2026-03-10T10:00:00.000Z",
    });
    const second = makeTrade({
      offered_by_uid: BOB,
      offered_to_uid: ALICE,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 14,
      resolved_at: "2026-03-10T11:00:00.000Z",
    });
    // Newest-first input (as useTrades returns) must not matter.
    const windows = getOwnershipWindows(picks, [second, first]);
    expect(getOwnerAtEpisode(windows, C1, 99)).toBe(ALICE);
    expect(getCurrentOwners(picks, [second, first])[C1]).toBe(ALICE);
  });
});

describe("getCurrentOwners", () => {
  it("reflects the latest accepted trade", () => {
    const picks = [makePick(C1, ALICE), makePick(C2, BOB)];
    const trade = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 5,
    });
    expect(getCurrentOwners(picks, [trade])).toEqual({
      [C1]: BOB,
      [C2]: ALICE,
    });
  });
});

describe("getRosterEpisode", () => {
  it("is the current episode for a watch-along", () => {
    expect(getRosterEpisode(makeCompetition([], { current_episode: 4 }))).toBe(
      4,
    );
  });

  it("floors a brand-new watch-along at episode 1 so episode-1 cutoffs display", () => {
    expect(getRosterEpisode(makeCompetition([], { current_episode: 0 }))).toBe(
      1,
    );
  });

  it("is unbounded for a live competition, which hides nothing", () => {
    expect(
      getRosterEpisode(makeCompetition([], { current_episode: null })),
    ).toBe(Infinity);
  });

  it("is unbounded for a finished competition -- nothing left to reveal", () => {
    expect(
      getRosterEpisode(
        makeCompetition([], { current_episode: 12, finished: true }),
      ),
    ).toBe(Infinity);
  });
});

describe("unreachable cutoffs (legacy trades past the last episode)", () => {
  const picks = [makePick(C1, ALICE), makePick(C2, BOB)];
  // Legacy live-mode acceptance on a 14-episode season: cutoff 15 can never
  // be revealed by a watch-along.
  const legacyTrade = makeTrade({
    offered_by_uid: ALICE,
    offered_to_uid: BOB,
    offered_castaway_ids: [C1],
    requested_castaway_ids: [C2],
    status: "accepted",
    effective_episode: 15,
  });

  it("displays the swap immediately instead of pending forever", () => {
    expect(getOwnersAtEpisode(picks, [legacyTrade], 12, 14)).toEqual({
      [C1]: BOB,
      [C2]: ALICE,
    });
    expect(getUpcomingMoves(picks, [legacyTrade], 12, 14)).toEqual({});
    expect(getAcquisitionsAtEpisode(picks, [legacyTrade], 12, 14)).toEqual({
      [C1]: { uid: BOB, fromUid: ALICE },
      [C2]: { uid: ALICE, fromUid: BOB },
    });
  });

  it("still honors a reachable cutoff when the last episode is known", () => {
    const reachable = { ...legacyTrade, effective_episode: 13 };
    expect(getOwnersAtEpisode(picks, [reachable], 12, 14)[C1]).toBe(ALICE);
    expect(getUpcomingMoves(picks, [reachable], 12, 14)[C1]).toEqual({
      fromUid: ALICE,
      toUid: BOB,
      landsNextEpisode: true,
    });
  });
});

describe("getOwnersAtEpisode", () => {
  const picks = [makePick(C1, ALICE), makePick(C2, BOB)];
  const trade = makeTrade({
    offered_by_uid: ALICE,
    offered_to_uid: BOB,
    offered_castaway_ids: [C1],
    requested_castaway_ids: [C2],
    status: "accepted",
    effective_episode: 5,
  });

  it("keeps the previous owner before the cutoff", () => {
    expect(getOwnersAtEpisode(picks, [trade], 4)).toEqual({
      [C1]: ALICE,
      [C2]: BOB,
    });
  });

  it("moves ownership from the cutoff episode on", () => {
    expect(getOwnersAtEpisode(picks, [trade], 5)).toEqual({
      [C1]: BOB,
      [C2]: ALICE,
    });
  });
});

describe("getUpcomingMoves", () => {
  const picks = [makePick(C1, ALICE), makePick(C2, BOB), makePick(C3, CAROL)];
  const trade = makeTrade({
    offered_by_uid: ALICE,
    offered_to_uid: BOB,
    offered_castaway_ids: [C1],
    requested_castaway_ids: [C2],
    status: "accepted",
    effective_episode: 5,
  });

  it("flags both sides of a trade whose cutoff is still ahead", () => {
    expect(getUpcomingMoves(picks, [trade], 4)).toEqual({
      [C1]: { fromUid: ALICE, toUid: BOB, landsNextEpisode: true },
      [C2]: { fromUid: BOB, toUid: ALICE, landsNextEpisode: true },
    });
  });

  it("clears once the competition reaches the cutoff", () => {
    expect(getUpcomingMoves(picks, [trade], 5)).toEqual({});
  });

  it("ignores pending trades", () => {
    expect(
      getUpcomingMoves(picks, [{ ...trade, status: "pending" }], 4),
    ).toEqual({});
  });

  it("does not promise next episode for a cutoff further out", () => {
    // Legacy trades can carry a cutoff past current_episode + 1 (see
    // StatusBadge); the indicator still shows, with softened wording.
    expect(getUpcomingMoves(picks, [trade], 2)[C1]).toEqual({
      fromUid: ALICE,
      toUid: BOB,
      landsNextEpisode: false,
    });
  });

  it("points at the next hop when a castaway is promised onward", () => {
    const bobToCarol = makeTrade({
      offered_by_uid: BOB,
      offered_to_uid: CAROL,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [],
      status: "accepted",
      effective_episode: 6,
    });

    expect(getUpcomingMoves(picks, [trade, bobToCarol], 4)[C1]).toEqual({
      fromUid: ALICE,
      toUid: BOB,
      landsNextEpisode: true,
    });
  });

  it("nets out two trades sharing a cutoff episode", () => {
    const backToAlice = makeTrade({
      offered_by_uid: BOB,
      offered_to_uid: ALICE,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [],
      status: "accepted",
      effective_episode: 5,
      resolved_at: "2026-03-11T00:00:00.000Z",
    });

    expect(
      getUpcomingMoves(picks, [trade, backToAlice], 4)[C1],
    ).toBeUndefined();
  });
});

describe("getAcquisitionsAtEpisode", () => {
  const picks = [makePick(C1, ALICE), makePick(C2, BOB)];
  const trade = makeTrade({
    offered_by_uid: ALICE,
    offered_to_uid: BOB,
    offered_castaway_ids: [C1],
    requested_castaway_ids: [C2],
    status: "accepted",
    effective_episode: 5,
  });

  it("shows nothing acquired before the cutoff", () => {
    expect(getAcquisitionsAtEpisode(picks, [trade], 4)).toEqual({});
  });

  it("marks the acquisition when the swap lands", () => {
    expect(getAcquisitionsAtEpisode(picks, [trade], 5)).toEqual({
      [C1]: { uid: BOB, fromUid: ALICE },
      [C2]: { uid: ALICE, fromUid: BOB },
    });
  });
});

describe("getDrafters / getAcquisitionsAtEpisode after every trade", () => {
  const picks = [makePick(C1, ALICE), makePick(C2, BOB)];
  const aliceToBob = makeTrade({
    offered_by_uid: ALICE,
    offered_to_uid: BOB,
    offered_castaway_ids: [C1],
    requested_castaway_ids: [C2],
    status: "accepted",
    effective_episode: 5,
  });

  it("keeps draft history intact after a trade", () => {
    expect(getDrafters(picks)).toEqual({ [C1]: ALICE, [C2]: BOB });
    expect(getCurrentOwners(picks, [aliceToBob])).toEqual({
      [C1]: BOB,
      [C2]: ALICE,
    });
  });

  it("reports nothing acquired when no trade has been accepted", () => {
    expect(getAcquisitionsAtEpisode(picks, [], Infinity)).toEqual({});
    expect(
      getAcquisitionsAtEpisode(
        picks,
        [{ ...aliceToBob, status: "pending" }],
        Infinity,
      ),
    ).toEqual({});
  });

  it("names the current owner and who they came from", () => {
    expect(getAcquisitionsAtEpisode(picks, [aliceToBob], Infinity)).toEqual({
      [C1]: { uid: BOB, fromUid: ALICE },
      [C2]: { uid: ALICE, fromUid: BOB },
    });
  });

  it("drops a castaway traded back to their drafter", () => {
    const backToAlice = makeTrade({
      offered_by_uid: BOB,
      offered_to_uid: ALICE,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [],
      status: "accepted",
      effective_episode: 8,
    });
    const acquisitions = getAcquisitionsAtEpisode(
      picks,
      [aliceToBob, backToAlice],
      Infinity,
    );

    expect(acquisitions[C1]).toBeUndefined();
    expect(acquisitions[C2]).toEqual({ uid: ALICE, fromUid: BOB });
  });

  it("credits the most recent owner when a castaway changes hands twice", () => {
    const bobToCarol = makeTrade({
      offered_by_uid: BOB,
      offered_to_uid: CAROL,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [],
      status: "accepted",
      effective_episode: 9,
    });

    expect(
      getAcquisitionsAtEpisode(picks, [aliceToBob, bobToCarol], Infinity)[C1],
    ).toEqual({
      uid: CAROL,
      fromUid: BOB,
    });
  });
});

describe("getUpcomingMoveLabel", () => {
  const participants: SlimUser[] = [
    {
      uid: ALICE,
      displayName: "Alice",
      email: "alice@example.com",
      isAdmin: false,
    },
    { uid: BOB, displayName: "Bob", email: "bob@example.com", isAdmin: false },
  ];

  it("names both sides and the relative timing", () => {
    expect(
      getUpcomingMoveLabel(
        { fromUid: ALICE, toUid: BOB, landsNextEpisode: true },
        participants,
      ),
    ).toBe("Traded from Alice to Bob. Takes effect next episode");
  });

  it("softens the timing when the cutoff is further out", () => {
    expect(
      getUpcomingMoveLabel(
        { fromUid: ALICE, toUid: BOB, landsNextEpisode: false },
        participants,
      ),
    ).toBe("Traded from Alice to Bob. Takes effect in an upcoming episode");
  });

  it("says nothing about episode numbers, which would leak season progress", () => {
    expect(
      getUpcomingMoveLabel(
        { fromUid: ALICE, toUid: BOB, landsNextEpisode: true },
        participants,
      ),
    ).not.toMatch(/\d/);
  });
});

describe("getAcquisitionLabel", () => {
  const participants: SlimUser[] = [
    {
      uid: ALICE,
      displayName: "Alice",
      email: "alice@example.com",
      isAdmin: false,
    },
    { uid: BOB, displayName: "Bob", email: "bob@example.com", isAdmin: false },
    { uid: CAROL, displayName: "", email: "carol@example.com", isAdmin: false },
  ];

  it("names only the previous owner when they also drafted the castaway", () => {
    expect(
      getAcquisitionLabel({ uid: BOB, fromUid: ALICE }, ALICE, participants),
    ).toBe("Acquired from Alice in a trade");
  });

  it("names the drafter too when the castaway has changed hands twice", () => {
    expect(
      getAcquisitionLabel({ uid: CAROL, fromUid: BOB }, ALICE, participants),
    ).toBe("Acquired from Bob · drafted by Alice");
  });

  it("keeps drafter provenance when distinct participants share a display name", () => {
    const namesakes = participants.map((participant) =>
      participant.uid === ALICE || participant.uid === BOB
        ? { ...participant, displayName: "Alex" }
        : participant,
    );

    expect(
      getAcquisitionLabel({ uid: CAROL, fromUid: BOB }, ALICE, namesakes),
    ).toBe("Acquired from Alex · drafted by Alex");
  });

  it("falls back to email when a participant has no display name", () => {
    expect(
      getAcquisitionLabel({ uid: ALICE, fromUid: CAROL }, CAROL, participants),
    ).toBe("Acquired from carol@example.com in a trade");
  });

  it("says nothing about episodes, which would leak season progress", () => {
    expect(
      getAcquisitionLabel({ uid: BOB, fromUid: ALICE }, ALICE, participants),
    ).not.toMatch(/\d/);
  });
});

describe("getOwnedCastawaysAtEpisode", () => {
  it("returns per-episode rosters honoring the cutoff", () => {
    const picks = [makePick(C1, ALICE), makePick(C2, BOB), makePick(C3, BOB)];
    const trade = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C2],
      status: "accepted",
      effective_episode: 4,
    });

    expect(getOwnedCastawaysAtEpisode(picks, [trade], ALICE, 3)).toEqual([C1]);
    expect(getOwnedCastawaysAtEpisode(picks, [trade], ALICE, 4)).toEqual([C2]);
    expect(getOwnedCastawaysAtEpisode(picks, [trade], BOB, 3)).toEqual([
      C2,
      C3,
    ]);
    expect(getOwnedCastawaysAtEpisode(picks, [trade], BOB, 4)).toEqual([
      C1,
      C3,
    ]);
  });
});

describe("getTradeLockEpisode", () => {
  const season = makeSeason([
    makeEpisode(1, "2026-02-25"),
    makeEpisode(2, "2026-03-04"),
    makeEpisode(3, "2026-03-12"), // airs Thursday
  ]);

  // Episode 3 airs Thursday 2026-03-12. A live competition (null) sees
  // everything as it arrives, so any air date closes trading.
  const LIVE = null;

  it("is open the day before an episode airs", () => {
    expect(getTradeLockEpisode(season, LIVE, WEDNESDAY)).toBeNull();
  });

  it("locks a live competition on the air date", () => {
    const thursday = new Date(2026, 2, 12, 8, 0, 0);
    expect(getTradeLockEpisode(season, LIVE, thursday)?.order).toBe(3);
  });

  it("never locks without air dates", () => {
    expect(
      getTradeLockEpisode(makeSeason([makeEpisode(1)]), LIVE, WEDNESDAY),
    ).toBeNull();
  });

  // The lock must key off the broadcast day, not the viewer's local day --
  // otherwise two participants in the same league disagree about whether
  // trading is open at the very same instant.
  it("uses the broadcast day, not the runner's local day", () => {
    // 2026-03-13T04:00Z is still 2026-03-12 (9pm) in America/Los_Angeles,
    // but already 2026-03-13 anywhere at or east of UTC.
    const lateNightPacific = new Date("2026-03-13T04:00:00Z");
    expect(getTradeLockEpisode(season, LIVE, lateNightPacific)?.order).toBe(3);
  });

  it("reopens once the broadcast day is over", () => {
    // 2026-03-13T08:00Z is 2026-03-13 (1am) in America/Los_Angeles.
    const afterPacificMidnight = new Date("2026-03-13T08:00:00Z");
    expect(getTradeLockEpisode(season, LIVE, afterPacificMidnight)).toBeNull();
  });

  describe("watch-along", () => {
    const thursday = new Date(2026, 2, 12, 8, 0, 0);

    it("locks when tonight's episode is the group's next reveal", () => {
      // On episode 2, about to reveal 3 -- and 3 airs tonight.
      expect(getTradeLockEpisode(season, 2, thursday)?.order).toBe(3);
    });

    it("keeps trading open for a group behind the broadcast", () => {
      // On episode 1 while episode 3 airs tonight: nothing they are about to
      // watch is at stake, so there is no hindsight to guard against.
      expect(getTradeLockEpisode(season, 1, thursday)).toBeNull();
    });

    it("keeps trading open for a brand-new competition", () => {
      expect(getTradeLockEpisode(season, 0, thursday)).toBeNull();
    });

    it("keeps trading open once the group has passed tonight's episode", () => {
      expect(getTradeLockEpisode(season, 3, thursday)).toBeNull();
    });
  });
});

describe("getEffectiveEpisode", () => {
  const noScoringData = { challenges: {}, eliminations: {}, events: {} };

  it("is episode 1 for a watch-along that has revealed nothing yet", () => {
    expect(
      getEffectiveEpisode({
        competition: makeCompetition([], { current_episode: 0 }),
        ...noScoringData,
      }),
    ).toBe(1);
  });

  it("is the next episode to reveal for a watch-along in progress", () => {
    expect(
      getEffectiveEpisode({
        competition: makeCompetition([], { current_episode: 4 }),
        ...noScoringData,
      }),
    ).toBe(5);
  });

  it("ignores how far the season's data runs ahead of the group", () => {
    // The season is fully scored, but a group on episode 2 trades for episode 3.
    expect(
      getEffectiveEpisode({
        competition: makeCompetition([], { current_episode: 2 }),
        challenges: {
          c1: { episode_num: 14 } as never,
        },
        eliminations: {},
        events: {},
      }),
    ).toBe(3);
  });

  it("falls back to the first unscored episode for a live competition", () => {
    expect(
      getEffectiveEpisode({
        competition: makeCompetition([], { current_episode: null }),
        challenges: { c1: { episode_num: 6 } as never },
        eliminations: {},
        events: {},
      }),
    ).toBe(7);
  });
});

describe("validateTrade", () => {
  const picks = [
    makePick(C1, ALICE),
    makePick(C2, ALICE),
    makePick(C3, BOB),
    makePick(C4, BOB),
  ];
  const competition = makeCompetition(picks);
  const season = makeSeason([makeEpisode(3, "2026-03-12")]);

  const baseInput = {
    competition,
    season,
    existingTrades: [] as Trade[],
    eliminatedCastawayIds: [] as CastawayId[],
    offeredByUid: ALICE,
    offeredToUid: BOB,
    offeredCastawayIds: [C1],
    requestedCastawayIds: [C3],
    today: WEDNESDAY,
  };

  it("accepts a valid trade", () => {
    expect(validateTrade(baseInput)).toEqual({ valid: true });
  });

  it("rejects trades in a finished competition", () => {
    const result = validateTrade({
      ...baseInput,
      competition: makeCompetition(picks, { finished: true }),
    });
    expect(result).toEqual({
      valid: false,
      reason: "This competition has finished.",
    });
  });

  it("rejects when locked on an air date", () => {
    const result = validateTrade({
      ...baseInput,
      today: new Date(2026, 2, 12, 10, 0, 0),
    });
    expect(result.valid).toBe(false);
  });

  it("rejects trading with yourself", () => {
    expect(validateTrade({ ...baseInput, offeredToUid: ALICE }).valid).toBe(
      false,
    );
  });

  it("rejects empty sides", () => {
    expect(
      validateTrade({ ...baseInput, requestedCastawayIds: [] }).valid,
    ).toBe(false);
  });

  it("rejects offering a player you no longer own", () => {
    const priorTrade = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: BOB,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [C3],
      status: "accepted",
      effective_episode: 5,
    });
    const result = validateTrade({
      ...baseInput,
      existingTrades: [priorTrade],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects eliminated players", () => {
    const result = validateTrade({
      ...baseInput,
      eliminatedCastawayIds: [C3],
    });
    expect(result).toEqual({
      valid: false,
      reason: "Eliminated players cannot be traded.",
    });
  });

  it("rejects players already in another pending trade", () => {
    const pending = makeTrade({
      offered_by_uid: ALICE,
      offered_to_uid: CAROL,
      offered_castaway_ids: [C1],
      requested_castaway_ids: [],
    });
    const result = validateTrade({
      ...baseInput,
      existingTrades: [pending],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects the same player on both sides", () => {
    expect(
      validateTrade({ ...baseInput, requestedCastawayIds: [C1] }).valid,
    ).toBe(false);
  });
});
