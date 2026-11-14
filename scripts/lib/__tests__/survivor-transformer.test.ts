import { beforeAll, describe, expect, it } from "vitest";
import { type SurvivorSeasonData, fetchSeasonData } from "../survivor-client";
import { transformPlayers, transformResults } from "../survivor-transformer";

// Integration tests using real survivoR data

describe("transformPlayers", { timeout: 60000 }, () => {
  it("transforms Season 46 castaways into Player array with castawayId", async () => {
    const data = await fetchSeasonData(46);
    const result = transformPlayers(data, 46);

    expect(result.seasonNum).toBe(46);
    expect(result.players).toHaveLength(18);
    expect(result.unmatched).toHaveLength(0);

    const player = result.players[0];
    expect(player.localName).toBeTruthy();
    expect(player.castawayId).toMatch(/^US\d+$/);
    expect(player.matchStatus).toBe("exact");
  });

  it("transforms Season 1 castaways (16 players)", async () => {
    const data = await fetchSeasonData(1);
    const result = transformPlayers(data, 1);

    expect(result.players).toHaveLength(16);

    const sonja = result.players.find((p) => p.localName.includes("Sonja"));
    expect(sonja).toBeDefined();
    expect(sonja!.localName).toBe("Sonja Christopher");
    expect(sonja!.castawayId).toMatch(/^US\d+$/);
  });

  it("transforms Season 48 castaways into 18 players with castaway IDs", async () => {
    const data = await fetchSeasonData(48);
    const result = transformPlayers(data, 48);

    expect(result.seasonNum).toBe(48);
    expect(result.players).toHaveLength(18);
    expect(result.unmatched).toHaveLength(0);

    for (const player of result.players) {
      expect(player.localName).toBeTruthy();
      expect(player.castawayId).toMatch(/^US\d+$/);
      expect(player.localName).toContain(" ");
    }
  });

  it("returning players with same name have distinct castaway_id values", async () => {
    const data = await fetchSeasonData(50);
    const result = transformPlayers(data, 50);

    const ids = result.players.map((p) => p.castawayId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("transformResults", { timeout: 60000 }, () => {
  let s46Data: SurvivorSeasonData;
  let s48Data: SurvivorSeasonData;

  beforeAll(async () => {
    [s46Data, s48Data] = await Promise.all([
      fetchSeasonData(46),
      fetchSeasonData(48),
    ]);
  });

  it("transforms Season 46 episodes", () => {
    const result = transformResults(s46Data, 46);

    expect(result.episodes).toHaveLength(13);
    expect(result.episodes[0].order).toBe(1);
    expect(result.episodes[0].title).toBeTruthy();

    const finale = result.episodes.find((e) => e.isFinale);
    expect(finale).toBeDefined();

    // Merge should be detected at episode 6 (Mergatory), not 7 (Merged)
    const mergeEp = result.episodes.find((e) => e.mergeOccurs);
    expect(mergeEp).toBeDefined();
    expect(mergeEp!.order).toBe(6);

    // Episodes 6-13 should be post-merge
    const postMerge = result.episodes.filter((e) => e.postMerge);
    expect(postMerge).toHaveLength(8);
  });

  it("transforms Season 46 challenges with winning castaway IDs", () => {
    const result = transformResults(s46Data, 46);

    expect(result.challenges.length).toBeGreaterThan(0);

    // Tribal challenges should have winning tribe set and reasonable winner counts
    const tribalChallenges = result.challenges.filter(
      (c) => c.winnerTribe !== null,
    );
    expect(tribalChallenges.length).toBeGreaterThan(0);
    for (const c of tribalChallenges) {
      expect(c.winnerCastawayIds.length).toBeGreaterThan(0);
      expect(c.winnerCastawayIds.length).toBeLessThanOrEqual(8);
    }

    // Combined challenges are split into immunity + reward (no "combined" type exists)
    const individualImmunities = result.challenges.filter(
      (c) => c.variant === "immunity",
    );
    expect(individualImmunities.length).toBeGreaterThan(0);

    const teamImmunities = result.challenges.filter(
      (c) => c.variant === "team_immunity",
    );
    expect(teamImmunities.length).toBeGreaterThan(0);

    const individualRewards = result.challenges.filter(
      (c) => c.variant === "reward",
    );
    expect(individualRewards.length).toBeGreaterThan(0);

    const teamRewards = result.challenges.filter(
      (c) => c.variant === "team_reward",
    );
    expect(teamRewards.length).toBeGreaterThan(0);
  });

  it("splits immunity challenges into individual and team variants", () => {
    const result = transformResults(s46Data, 46);

    // Pre-merge tribal immunity challenges should be team_immunity
    const teamImmunities = result.challenges.filter(
      (c) => c.variant === "team_immunity",
    );
    for (const c of teamImmunities) {
      expect(c.winnerCastawayIds.length).toBeGreaterThan(1);
    }

    // Post-merge individual immunity challenges should be immunity
    const individualImmunities = result.challenges.filter(
      (c) => c.variant === "immunity",
    );
    for (const c of individualImmunities) {
      expect(c.winnerCastawayIds.length).toBeLessThanOrEqual(2);
    }
  });

  it("splits reward challenges into individual and team variants", () => {
    const result = transformResults(s46Data, 46);

    // Pre-merge tribal reward challenges should be team_reward
    const teamRewards = result.challenges.filter(
      (c) => c.variant === "team_reward",
    );
    for (const c of teamRewards) {
      expect(c.winnerCastawayIds.length).toBeGreaterThan(1);
    }

    // Post-merge individual reward challenges should be reward
    const individualRewards = result.challenges.filter(
      (c) => c.variant === "reward",
    );
    for (const c of individualRewards) {
      expect(c.winnerCastawayIds.length).toBeLessThanOrEqual(2);
    }
  });

  it("uses castaway IDs (not names) for challenge winners and events", () => {
    const playerResult = transformPlayers(s46Data, 46);
    const result = transformResults(s46Data, 46);

    const castawayIds = new Set(playerResult.players.map((p) => p.castawayId));

    for (const chal of result.challenges) {
      for (const id of chal.winnerCastawayIds) {
        expect(castawayIds).toContain(id);
      }
    }

    for (const ev of result.events) {
      expect(castawayIds).toContain(ev.castawayId);
    }
  });

  it("transforms Season 46 eliminations with correct variants", () => {
    const result = transformResults(s46Data, 46);

    // Winner should NOT be in eliminations (17, not 18)
    expect(result.eliminations).toHaveLength(17);

    // The winner (Kenzie Petty) should not appear
    const playerResult = transformPlayers(s46Data, 46);
    const kenzie = playerResult.players.find((p) =>
      p.localName.includes("Kenzie"),
    );
    const winnerElim = result.eliminations.find(
      (e) => e.castawayId === kenzie?.castawayId,
    );
    expect(winnerElim).toBeUndefined();

    const tribals = result.eliminations.filter((e) => e.variant === "tribal");
    expect(tribals.length).toBeGreaterThan(0);

    // FTC runner-ups should be final_tribal_council
    const ftc = result.eliminations.filter(
      (e) => e.variant === "final_tribal_council",
    );
    expect(ftc.length).toBeGreaterThanOrEqual(2);

    // No fire-making eliminations should have variant "other"
    const others = result.eliminations.filter((e) => e.variant === "other");
    expect(others).toHaveLength(0);
  });

  it("transforms Season 46 events (advantages, journeys, merge, winner)", () => {
    const result = transformResults(s46Data, 46);

    expect(result.events.length).toBeGreaterThan(0);

    // S46 has journey records — players who risked should get journey_risked_vote
    const riskedVoteEvents = result.events.filter(
      (e) => e.action === "journey_risked_vote",
    );
    expect(riskedVoteEvents.length).toBeGreaterThan(0);

    // Players who won a journey game should get journey_won_game
    const wonGameEvents = result.events.filter(
      (e) => e.action === "journey_won_game",
    );
    expect(wonGameEvents.length).toBeGreaterThan(0);

    // Journey advantage winners should still get specific win actions (e.g., win_extra_vote)
    const journeyWins = result.events.filter(
      (e) =>
        e.action.startsWith("win_") &&
        e.action !== "win_survivor" &&
        riskedVoteEvents.some(
          (j) => j.castawayId === e.castawayId && j.episodeNum === e.episodeNum,
        ),
    );
    expect(journeyWins.length).toBeGreaterThan(0);

    // Players who lost their vote should get journey_lost_vote
    const lostVoteEvents = result.events.filter(
      (e) => e.action === "journey_lost_vote",
    );
    expect(lostVoteEvents.length).toBeGreaterThan(0);

    // Every journey participant should get go_on_journey (base participation)
    const goOnJourneyEvents = result.events.filter(
      (e) => e.action === "go_on_journey",
    );
    expect(goOnJourneyEvents.length).toBeGreaterThan(0);

    // S46 fire-making: exactly 1 winner should get win_fire_making
    const fireEvents = result.events.filter(
      (e) => e.action === "win_fire_making",
    );
    expect(fireEvents).toHaveLength(1);
    expect(fireEvents[0].episodeNum).toBe(13);

    // S46 has 4 beware idols
    const findBeware = result.events.filter(
      (e) => e.action === "find_beware_advantage",
    );
    expect(findBeware).toHaveLength(4);

    const acceptBeware = result.events.filter(
      (e) => e.action === "accept_beware_advantage",
    );
    expect(acceptBeware).toHaveLength(4);

    const fulfillBeware = result.events.filter(
      (e) => e.action === "fulfill_beware_advantage",
    );
    expect(fulfillBeware.length).toBeGreaterThan(0);

    // Non-idol advantages should produce specific find actions (e.g., find_extra_vote)
    const findExtraVote = result.events.filter(
      (e) => e.action === "find_extra_vote",
    );
    expect(findExtraVote.length).toBeGreaterThan(0);

    // Maria's Extra Vote play should be use_extra_vote (not use_idol)
    const useExtraVote = result.events.filter(
      (e) => e.action === "use_extra_vote",
    );
    expect(useExtraVote.length).toBeGreaterThan(0);

    // No retired generic actions should appear
    const genericActions = result.events.filter(
      (e) =>
        e.action === "find_advantage" ||
        e.action === "use_advantage" ||
        e.action === "win_advantage",
    );
    expect(genericActions).toHaveLength(0);

    // Moriah's Shot in the Dark (ep6, unsuccessful)
    const sitd = result.events.filter(
      (e) =>
        e.action === "use_shot_in_the_dark_successfully" ||
        e.action === "use_shot_in_the_dark_unsuccessfully",
    );
    expect(sitd).toHaveLength(1);
    expect(sitd[0].action).toBe("use_shot_in_the_dark_unsuccessfully");
    expect(sitd[0].episodeNum).toBe(6);

    // Merge event should be on episode 6 (not 7)
    const mergeEvents = result.events.filter((e) => e.action === "make_merge");
    expect(mergeEvents.length).toBeGreaterThan(0);
    for (const e of mergeEvents) {
      expect(e.episodeNum).toBe(6);
    }

    const winEvents = result.events.filter((e) => e.action === "win_survivor");
    expect(winEvents).toHaveLength(1);
  });

  it("handles Season 1 with no advantages (empty, not error)", async () => {
    const data = await fetchSeasonData(1);
    const result = transformResults(data, 1);

    const idolEvents = result.events.filter(
      (e) => e.action === "find_idol" || e.action === "use_idol",
    );
    expect(idolEvents).toHaveLength(0);

    // Should still have merge and winner events
    const mergeEvents = result.events.filter((e) => e.action === "make_merge");
    expect(mergeEvents.length).toBeGreaterThan(0);
  });

  it("transforms Season 22 duel challenges (Redemption Island)", async () => {
    const data = await fetchSeasonData(22);
    const result = transformResults(data, 22);

    const duelChallenges = result.challenges.filter(
      (c) => c.variant === "duel",
    );
    expect(duelChallenges.length).toBeGreaterThan(0);
    for (const d of duelChallenges) {
      expect(d.winnerCastawayIds.length).toBeGreaterThan(0);
    }

    // Duels should not appear as reward or immunity variants
    const nonDuelWrongType = result.challenges.filter(
      (c) =>
        c.variant !== "duel" &&
        (c.variant === "reward" || c.variant === "immunity"),
    );
    // S22 should have regular immunity/reward challenges too
    expect(nonDuelWrongType.length).toBeGreaterThan(0);
  });

  it("transforms Season 48 episodes", () => {
    const result = transformResults(s48Data, 48);

    expect(result.episodes.length).toBeGreaterThanOrEqual(13);
    expect(result.episodes[0].order).toBe(1);
    expect(result.episodes[0].title).toBeTruthy();
  });

  it("transforms Season 48 challenges with winning castaway IDs", () => {
    const result = transformResults(s48Data, 48);

    expect(result.challenges.length).toBeGreaterThan(0);

    const withWinners = result.challenges.filter(
      (c) => c.winnerCastawayIds.length > 0,
    );
    expect(withWinners.length).toBeGreaterThan(0);
  });

  it("all S48 challenge winner IDs and event castaway IDs exist in the player list", () => {
    const playerResult = transformPlayers(s48Data, 48);
    const result = transformResults(s48Data, 48);

    const castawayIds = new Set(playerResult.players.map((p) => p.castawayId));

    for (const chal of result.challenges) {
      for (const id of chal.winnerCastawayIds) {
        expect(castawayIds).toContain(id);
      }
    }

    for (const ev of result.events) {
      expect(castawayIds).toContain(ev.castawayId);
    }
  });

  it("treats S50 'Escaped Exile Island' journey reward as non-scoring participation only", async () => {
    const data = await fetchSeasonData(50);
    const result = transformResults(data, 50);

    // Cirie (US0179) escaped Exile Island in episode 8 — a new journey outcome
    // that grants no advantage and costs no vote. She should only get the base
    // go_on_journey participation event; no win/risk/lost-vote events.
    const cirieEp8 = result.events.filter(
      (e) => e.castawayId === "US0179" && e.episodeNum === 8,
    );

    const goOnJourney = cirieEp8.filter((e) => e.action === "go_on_journey");
    expect(goOnJourney).toHaveLength(1);

    const nonParticipationJourneyActions = cirieEp8.filter((e) =>
      ["journey_won_game", "journey_risked_vote", "journey_lost_vote"].includes(
        e.action,
      ),
    );
    expect(nonParticipationJourneyActions).toHaveLength(0);

    const winActions = cirieEp8.filter(
      (e) => e.action.startsWith("win_") && e.action !== "win_survivor",
    );
    expect(winActions).toHaveLength(0);
  });

  it("scores Mr. Beast super-beware coin-flip twist (S50 ep10) as immunity + win_idol", async () => {
    const data = await fetchSeasonData(50);
    const result = transformResults(data, 50);

    // Rick (US0560) won the Mr. Beast coin flip in S50 ep10 — gaining individual
    // immunity at this tribal AND a hidden immunity idol. survivoR encodes this
    // on Rick's vote_history row as "Steal a vote; won beast challenge" because
    // Stephenie also played a Steal a Vote on him. Both rewards should be scored
    // in ep10 (not ep11, where survivoR's advantage_movement records the Found).
    //
    // The idol is a game event, but immunity is a ChallengeWinAction scored off
    // challenges.winning_castaways — emitting it as an event produces season
    // data that fails to type-check.
    const rickEp10 = result.events.filter(
      (e) => e.castawayId === "US0560" && e.episodeNum === 10,
    );
    expect(rickEp10.map((e) => e.action).sort()).toEqual(["win_idol"]);

    const rickEp10Immunity = result.challenges.filter(
      (c) =>
        c.episodeNum === 10 &&
        c.variant === "immunity" &&
        c.winnerCastawayIds.includes("US0560"),
    );
    expect(rickEp10Immunity).toHaveLength(1);

    // The duplicate advantage_movement "Found" for the same idol (recorded in
    // ep11 by survivoR) must be suppressed so the idol isn't double-counted.
    const rickEp11FindIdol = result.events.filter(
      (e) =>
        e.castawayId === "US0560" &&
        e.episodeNum === 11 &&
        e.action === "find_idol",
    );
    expect(rickEp11FindIdol).toHaveLength(0);

    // Sanity: Rick still gets the use_idol event in ep11 from the Played row.
    const rickEp11Use = result.events.filter(
      (e) =>
        e.castawayId === "US0560" &&
        e.episodeNum === 11 &&
        e.action === "use_idol",
    );
    expect(rickEp11Use).toHaveLength(1);
  });

  it("never emits a challenge-win action as a game event", async () => {
    // Challenge wins are scored from challenges.winning_castaways and are not
    // part of GameEventAction, so emitting one as an event generates season
    // data that fails to compile. Guard every season we can transform.
    const challengeWinActions = new Set([
      "duel",
      "reward",
      "team_reward",
      "immunity",
      "team_immunity",
    ]);

    for (const seasonNum of [48, 49, 50]) {
      const result = transformResults(
        await fetchSeasonData(seasonNum),
        seasonNum,
      );
      const offenders = result.events.filter((e) =>
        challengeWinActions.has(e.action),
      );
      expect(
        offenders,
        `S${seasonNum} emitted challenge-win actions as events: ${JSON.stringify(offenders)}`,
      ).toHaveLength(0);
    }
  });

  describe("S51 advantage handovers (Gave and Holding)", () => {
    // survivoR 07ce166 recorded the Episode 3 handovers as "Received" only;
    // 2b8c3a3 added "Gave" by the giver and "Holding" rows at each vote.
    const BEFORE_GAVE = "07ce1660d8312f8e2882244c36dc24fca597998a";
    const WITH_GAVE = "2b8c3a32ed7b2b59e24105b0a89b3322eb1b1b0a";
    const episode3 = (data: SurvivorSeasonData) =>
      transformResults(data, 51)
        .events.filter((e) => e.episodeNum === 3)
        .map((e) => `${e.castawayId}:${e.action}`);

    it("scores each handover once, for the recipient only", async () => {
      const withGave = await fetchSeasonData(51, WITH_GAVE);
      const lifecycle = withGave.advantageMovement.map((m) => m.event);
      expect(lifecycle).toContain("Gave");
      expect(lifecycle).toContain("Holding");

      expect(episode3(withGave)).toEqual([
        "US0758:win_idol",
        "US0761:find_extra_vote",
        "US0757:find_extra_vote",
        "US0767:win_other_advantage",
      ]);
      // Recipient scoring is what it was before survivoR added the new rows.
      expect(episode3(withGave)).toEqual(
        episode3(await fetchSeasonData(51, BEFORE_GAVE)),
      );
    });

    it("still fails closed on an advantage event it does not know", async () => {
      const data = await fetchSeasonData(51, WITH_GAVE);
      const gave = data.advantageMovement.find((m) => m.event === "Gave")!;
      const withUnknown = {
        ...data,
        advantageMovement: [
          ...data.advantageMovement,
          { ...gave, sequence_id: 99, event: "Swapped" },
        ],
      };
      expect(() => transformResults(withUnknown, 51)).toThrow(
        'Unknown advantage event "Swapped"',
      );
    });
  });

  describe("S51 deadlock consensus", () => {
    // survivoR 00ecda0 added Episode 5, where Dina's deadlocked tie was
    // settled by the remaining voters agreeing on the boot: four
    // vote_history rows with vote_event "Deadlock consensus".
    const BEFORE_EP5 = "c0f2511f9a88e637f744ae0dda537a8d937b66d5";
    const WITH_EP5 = "00ecda002d63f63c7d5ec54660cc55f185ca5ea4";
    const events = (data: SurvivorSeasonData) =>
      transformResults(data, 51).events.map(
        (e) => `${e.episodeNum}:${e.castawayId}:${e.action}`,
      );

    let withEp5: SurvivorSeasonData;
    beforeAll(async () => {
      withEp5 = await fetchSeasonData(51, WITH_EP5);
    });

    it("scores nothing for the deadlock and keeps Episodes 1 to 4", async () => {
      const deadlock = withEp5.voteHistory.filter(
        (v) => v.vote_event === "Deadlock consensus",
      );
      expect(deadlock).toHaveLength(4);

      const all = events(withEp5);
      expect(all.filter((e) => e.startsWith("5:"))).toEqual([
        "5:US0767:find_extra_vote",
        "5:US0765:win_other_advantage",
        "5:US0765:use_extra_vote",
        "5:US0760:win_other_advantage",
        "5:US0760:use_extra_vote",
        "5:US0767:go_on_journey",
        "5:US0767:journey_risked_vote",
        "5:US0767:journey_won_game",
        "5:US0767:win_extra_vote",
      ]);
      expect(all.filter((e) => !e.startsWith("5:")).sort()).toEqual(
        events(await fetchSeasonData(51, BEFORE_EP5)).sort(),
      );
    });

    it("still fails closed on a vote event it does not know", () => {
      const row = withEp5.voteHistory.find(
        (v) => v.vote_event === "Deadlock consensus",
      )!;
      const withUnknown = {
        ...withEp5,
        voteHistory: [
          ...withEp5.voteHistory,
          { ...row, vote_event: "Deadlock compromise" },
        ],
      };
      expect(() => transformResults(withUnknown, 51)).toThrow(
        'Unknown vote_event "Deadlock compromise"',
      );
    });
  });

  describe("S51 Episode 6 summit and next-episode tribe rows", () => {
    // survivoR d2bdda6 added Episode 6: two summit attendees came back with
    // "Ribs and corn" (a meal, no advantage), and the merge's Episode 7
    // tribe_mapping rows arrived before Episode 7 itself.
    const WITH_EP5 = "00ecda002d63f63c7d5ec54660cc55f185ca5ea4";
    const WITH_EP6 = "d2bdda65fbba2887a0960fafe6a22b01e16a6c10";
    const events = (data: SurvivorSeasonData) =>
      transformResults(data, 51).events.map(
        (e) => `${e.episodeNum}:${e.castawayId}:${e.action}`,
      );

    let withEp6: SurvivorSeasonData;
    beforeAll(async () => {
      withEp6 = await fetchSeasonData(51, WITH_EP6);
    });

    it("scores the meal as journey participation only", () => {
      const meal = withEp6.journeys.filter((j) => j.reward === "Ribs and corn");
      expect(meal.map((j) => j.castaway_id).sort()).toEqual([
        "US0769",
        "US0772",
      ]);
      const ep6 = events(withEp6).filter((e) => e.startsWith("6:"));
      expect(ep6.filter((e) => e.startsWith("6:US0772:"))).toEqual([
        "6:US0772:go_on_journey",
      ]);
      expect(ep6.filter((e) => e.startsWith("6:US0769:")).sort()).toEqual([
        "6:US0769:go_on_journey",
        "6:US0769:use_shot_in_the_dark_unsuccessfully",
      ]);
    });

    it("still fails closed on a journey reward it does not know", () => {
      const row = withEp6.journeys.find((j) => j.reward === "Ribs and corn")!;
      const withUnknown = {
        ...withEp6,
        journeys: [...withEp6.journeys, { ...row, reward: "Ribs and slaw" }],
      };
      expect(() => transformResults(withUnknown, 51)).toThrow(
        'Unknown journey reward part "Ribs and slaw"',
      );
    });

    it("ignores tribe rows for an episode survivoR has not published", async () => {
      const ahead = withEp6.tribeMapping.filter((t) => t.episode === 7);
      expect(ahead.length).toBeGreaterThan(0);
      expect(ahead.every((t) => t.tribe_status === "Merged")).toBe(true);

      const all = events(withEp6);
      expect(all.filter((e) => Number(e.split(":")[0]) > 6)).toEqual([]);
      // Episodes 1 to 5 score exactly as they did before the correction.
      expect(all.filter((e) => !e.startsWith("6:")).sort()).toEqual(
        events(await fetchSeasonData(51, WITH_EP5)).sort(),
      );
    });

    it("scores the merge once its episode is published", () => {
      const ep6 = withEp6.episodes.find((e) => e.episode === 6)!;
      const withEp7 = {
        ...withEp6,
        episodes: [...withEp6.episodes, { ...ep6, episode: 7 }],
      };
      const merged = events(withEp7).filter((e) => e.endsWith(":make_merge"));
      expect(merged).toHaveLength(13);
      expect(merged.every((e) => e.startsWith("7:"))).toBe(true);
    });
  });

  describe("historical seasons at survivoR d2bdda6", () => {
    const REF = "d2bdda65fbba2887a0960fafe6a22b01e16a6c10";
    const keys = (data: SurvivorSeasonData, season: number) =>
      transformResults(data, season).events.map(
        (e) => `${e.episodeNum}:${e.castawayId}:${e.action}:${e.multiplier}`,
      );
    const withReward = (
      data: SurvivorSeasonData,
      from: string,
      to: string,
    ) => ({
      ...data,
      journeys: data.journeys.map((j) =>
        j.reward === from ? { ...j, reward: to } : j,
      ),
    });

    describe("S44 journey reward casing", () => {
      let s44: SurvivorSeasonData;
      beforeAll(async () => {
        s44 = await fetchSeasonData(44, REF);
      });

      it("scores Bank your Vote and the Sanctuary Feast as before", () => {
        // survivoR re-cased both rewards after this season was imported.
        const rewards = s44.journeys.map((j) => j.reward);
        expect(rewards).toContain("Bank your Vote");
        expect(rewards).toContain("Sanctuary Feast");

        const events = keys(s44, 44);
        expect(events.filter((e) => e.startsWith("1:US0648:"))).toEqual([
          "1:US0648:find_bank_your_vote:null", // advantage_movement, unchanged
          "1:US0648:go_on_journey:null",
          "1:US0648:journey_risked_vote:null",
          "1:US0648:journey_won_game:null",
          "1:US0648:win_other_advantage:null",
        ]);
        for (const id of ["US0645", "US0652", "US0658"]) {
          expect(
            events.filter(
              (e) => e.startsWith(`5:${id}:`) && e.includes("journey"),
            ),
          ).toEqual([`5:${id}:go_on_journey:null`]);
        }
      });

      it("scores the earlier casing identically", () => {
        const older = withReward(
          withReward(s44, "Bank your Vote", "Bank your vote"),
          "Sanctuary Feast",
          "Sanctuary feast",
        );
        expect(keys(older, 44)).toEqual(keys(s44, 44));
      });

      it("still fails closed on rewards it does not know", () => {
        expect(() =>
          transformResults(
            withReward(s44, "Bank your Vote", "Bank your Votes"),
            44,
          ),
        ).toThrow('Unknown journey reward part "Bank your Votes"');
        expect(() =>
          transformResults(
            withReward(s44, "Sanctuary Feast", "Sanctuary Banquet"),
            44,
          ),
        ).toThrow('Unknown journey reward part "Sanctuary Banquet"');
      });
    });

    describe("idol plays that nullified no votes", () => {
      const negated = (data: SurvivorSeasonData, season: number, ep: number) =>
        keys(data, season)
          .filter(
            (e) =>
              e.startsWith(`${ep}:`) && e.includes(":votes_negated_by_idol:"),
          )
          .sort();
      let s47: SurvivorSeasonData;
      beforeAll(async () => {
        s47 = await fetchSeasonData(47, REF);
      });

      it("credits only Rachel's idol at S47 Episode 13, in either row order", () => {
        // Rachel's idol cancelled 3 votes at the final six; Sue's at the final
        // five was not needed (votes_nullified 0). survivoR listed Sue's play
        // first until 07ce1660; that order once gave Sue Rachel's 3 votes.
        expect(negated(s47, 47, 13)).toEqual([
          "13:US0707:votes_negated_by_idol:3",
        ]);
        const oldOrder = {
          ...s47,
          advantageMovement: [...s47.advantageMovement].reverse(),
        };
        expect(negated(oldOrder, 47, 13)).toEqual([
          "13:US0707:votes_negated_by_idol:3",
        ]);
      });

      it("credits Parvati's two idols at S20 Episode 10 once", async () => {
        // One idol for Sandra (not needed), one for Jerri (5 votes).
        expect(negated(await fetchSeasonData(20, REF), 20, 10)).toEqual([
          "10:US0197:votes_negated_by_idol:5",
        ]);
      });

      it("credits only Davie's idol at S37 Episode 12", async () => {
        expect(negated(await fetchSeasonData(37, REF), 37, 12)).toEqual([
          "12:US0551:votes_negated_by_idol:2",
        ]);
      });

      it("still matches nullified votes when the count is missing", () => {
        const noCounts = {
          ...s47,
          advantageMovement: s47.advantageMovement.map((a) =>
            a.episode === 13 ? { ...a, votes_nullified: null } : a,
          ),
        };
        expect(negated(noCounts, 47, 13)).toEqual([
          "13:US0707:votes_negated_by_idol:3",
        ]);
      });
    });
  });

  describe("survivoR c729c775 (Update to US51E08)", () => {
    const REF = "c729c775f76ea2d57158c02907a394c6d55a49b5";
    const keys = (data: SurvivorSeasonData, season: number) =>
      transformResults(data, season).events.map(
        (e) => `${e.episodeNum}:${e.castawayId}:${e.action}`,
      );
    const shots = (data: SurvivorSeasonData, season: number, ep: number) =>
      keys(data, season).filter(
        (e) => e.startsWith(`${ep}:`) && e.includes("shot_in_the_dark"),
      );

    describe("one Shot in the Dark per castaway per tribal", () => {
      // survivoR repeats the clause on each of a castaway's vote rows at a
      // tribal (revotes, two-boot tribals); the play itself happens once.
      it.each([
        [45, 6, "US0673", "successfully", 2],
        [47, 8, "US0707", "unsuccessfully", 2],
        [48, 3, "US0727", "successfully", 4],
        [50, 8, "US0277", "unsuccessfully", 2],
      ])(
        "S%i Episode %i: %s once (%s), from %i vote rows",
        async (season, ep, id, how, rows) => {
          const data = await fetchSeasonData(season, REF);
          const repeated = data.voteHistory.filter(
            (v) =>
              v.episode === ep &&
              v.castaway_id === id &&
              /shot in the dark/i.test(v.vote_event ?? ""),
          );
          expect(repeated).toHaveLength(rows);
          expect(shots(data, season, ep)).toEqual([
            `${ep}:${id}:use_shot_in_the_dark_${how}`,
          ]);
        },
      );

      it("fails closed when the repeated rows disagree on the outcome", async () => {
        const s48 = await fetchSeasonData(48, REF);
        const rows = s48.voteHistory.filter(
          (v) => v.castaway_id === "US0727" && v.vote_event,
        );
        const conflicting = {
          ...s48,
          voteHistory: s48.voteHistory.map((v) =>
            v === rows[1] ? { ...v, vote_event_outcome: "Not safe" } : v,
          ),
        };
        expect(() => transformResults(conflicting, 48)).toThrow(
          "Conflicting Shot in the dark outcomes for US0727",
        );
      });
    });

    describe("S51 Episode 8 journey row correction", () => {
      let s51: SurvivorSeasonData;
      let row: SurvivorSeasonData["journeys"][number];
      const withRow = (patch: object) => ({
        ...s51,
        journeys: s51.journeys.map((j) => (j === row ? { ...j, ...patch } : j)),
      });
      const journeyEvents = (data: SurvivorSeasonData) =>
        keys(data, 51).filter(
          (e) => e.startsWith("8:") && e.includes("journey"),
        );
      beforeAll(async () => {
        s51 = await fetchSeasonData(51, REF);
        row = s51.journeys.find((j) => j.episode === 8)!;
      });

      it("matches the exact row survivoR published", () => {
        expect(row).toMatchObject({
          version_season: "US51",
          castaway: "Christian",
          reward: "Regained vote",
          lost_vote: true,
        });
        expect(row.castaway_id).toBeUndefined();
        expect(row.chose_to_play).toBeUndefined();
        const cristian = s51.castaways.filter((c) => c.castaway === "Cristian");
        expect(cristian.map((c) => c.castaway_id)).toEqual(["US0759"]);
        expect(s51.castaways.some((c) => /christian/i.test(c.castaway))).toBe(
          false,
        );
      });

      it("scores Cristian's regained vote like every other one", () => {
        // He lost his vote at docking and won it back (Extra Vote found via
        // advantage_movement). survivoR's other "Regained vote" rows have
        // lost_vote false and score journey participation only.
        expect(journeyEvents(s51)).toEqual(["8:US0759:go_on_journey"]);
        const regained = keys(
          withRow({
            castaway_id: undefined,
            castaway: "Cristian",
            lost_vote: false,
          }),
          51,
        );
        expect(keys(s51, 51)).toEqual(regained);
        expect(keys(s51, 51).every((e) => !e.includes("undefined"))).toBe(true);
      });

      it("fails when survivoR changes the corrected row", () => {
        for (const patch of [
          { castaway_id: "US0759" }, // id now supplied
          { lost_vote: false }, // survivoR fixed the flag
          { reward: "Extra Vote" }, // different outcome
          { chose_to_play: true }, // new field
        ]) {
          expect(() => transformResults(withRow(patch), 51)).toThrow(
            "survivoR changed the corrected journey row US51|8|Christian",
          );
        }
      });

      it("leaves every other row as published", () => {
        for (const patch of [
          { castaway: "Kristian" }, // another misspelling
          { castaway: "christian" }, // casing is not the reviewed value
          { episode: 7 }, // same name, another episode
          { version_season: "US50" }, // same name, another season key
        ]) {
          expect(() => transformResults(withRow(patch), 51)).toThrow(
            "Could not resolve",
          );
        }
        // Spelled correctly, the same facts score as published.
        expect(journeyEvents(withRow({ castaway: "Cristian" })).sort()).toEqual(
          [
            "8:US0759:go_on_journey",
            "8:US0759:journey_lost_vote",
            "8:US0759:journey_risked_vote",
          ],
        );
      });

      it("fails if the season's Cristian is not US0759", () => {
        const renamed = {
          ...s51,
          castaways: s51.castaways.map((c) =>
            c.castaway_id === "US0759"
              ? { ...c, castaway: "Cris" }
              : c.castaway_id === "US0762"
                ? { ...c, castaway: "Cristian" }
                : c,
          ),
        };
        expect(() => transformResults(renamed, 51)).toThrow(
          "resolved to US0762, expected US0759",
        );
        const missing = {
          ...s51,
          castaways: s51.castaways.map((c) =>
            c.castaway_id === "US0759" ? { ...c, castaway: "Cris" } : c,
          ),
        };
        expect(() => transformResults(missing, 51)).toThrow(
          'Could not resolve "Cristian"',
        );
      });

      it("leaves Season 50's real Christian (US0550) alone", async () => {
        const s50 = await fetchSeasonData(50, REF);
        const theirs = s50.journeys.filter((j) => j.castaway === "Christian");
        expect(theirs.map((j) => j.castaway_id)).toEqual(["US0550"]);
        const noId = {
          ...s50,
          journeys: s50.journeys.map((j) =>
            j.castaway === "Christian"
              ? { ...j, castaway_id: undefined as unknown as string }
              : j,
          ),
        };
        expect(keys(noId, 50)).toEqual(keys(s50, 50));
      });

      it("resolves a missing id from the castaway's exact name", () => {
        const known = s51.journeys.filter((j) => j.episode !== 8);
        const withoutIds = known.map((j) => ({
          ...j,
          castaway_id: undefined as unknown as string,
        }));
        expect(keys({ ...s51, journeys: withoutIds }, 51)).toEqual(
          keys({ ...s51, journeys: known }, 51),
        );
      });

      it("credits the Episode 8 Shots in the Dark once each", () => {
        // Two vote rows per voter: survivoR records each pair vote per member.
        expect(shots(s51, 51, 8).sort()).toEqual([
          "8:US0759:use_shot_in_the_dark_successfully",
          "8:US0764:use_shot_in_the_dark_unsuccessfully",
        ]);
      });
    });

    describe("historical challenge corrections", () => {
      const winners = async (season: number, ep: number, variant: string) =>
        transformResults(await fetchSeasonData(season, REF), season)
          .challenges.filter(
            (c) => c.episodeNum === ep && c.variant === variant,
          )
          .map((c) => [...c.winnerCastawayIds].sort());

      it("S38 Episode 13 duel has one winner", async () => {
        expect(await winners(38, 13, "duel")).toEqual([["US0559"]]);
      });

      it("S39 Episode 11 team reward went to US0586 and US0590", async () => {
        expect(await winners(39, 11, "team_reward")).toEqual([
          ["US0586", "US0590"],
        ]);
      });

      it("S50 Episode 1 credits US0682, not US0550, with the tribe", async () => {
        for (const variant of ["team_immunity", "team_reward"]) {
          const groups = await winners(50, 1, variant);
          expect(groups.some((g) => g.includes("US0682"))).toBe(true);
          expect(groups).not.toContainEqual(["US0550"]);
        }
      });
    });
  });
});
