import { describe, expect, it } from "vitest";
import type { CastawayId } from "../../types";
import { getEnhancedSurvivorPoints } from "../../utils/scoringUtils";
import { BASE_PLAYER_SCORING } from "../scoring";
import {
  SEASON_51_CASTAWAY_LOOKUP,
  SEASON_51_CHALLENGES,
  SEASON_51_ELIMINATIONS,
  SEASON_51_EPISODES,
  SEASON_51_EVENTS,
  SEASON_51_PLAYERS,
  SEASON_51_VOTE_HISTORY,
} from "../season_51";

const inEpisode = <T extends { episode_num: number }>(
  records: Record<string, T>,
  episodeNum: number,
): T[] => Object.values(records).filter((r) => r.episode_num === episodeNum);

/**
 * Season 51 episode 1 as published in doehm/survivoR@7336413. These pin the
 * bundled results to the source rows so a regeneration that drops or reshapes
 * them is caught before it reaches Firestore. Each block covers only its own
 * episode, so importing a later one leaves it standing.
 */
describe("season 51 episode 1", () => {
  it("has an aired first episode that is not a finale", () => {
    expect(SEASON_51_EPISODES[0]).toMatchObject({
      id: "episode_1",
      name: "Permanent Uncertainty",
      air_date: "2026-09-23",
      finale: false,
    });
  });

  it("credits the Savu tribe immunity win and the first boot", () => {
    expect(inEpisode(SEASON_51_CHALLENGES, 1)).toHaveLength(1);
    expect(SEASON_51_CHALLENGES.challenge_0.episode_num).toBe(1);
    expect(SEASON_51_CHALLENGES.challenge_0.variant).toBe("team_immunity");
    expect(SEASON_51_CHALLENGES.challenge_0.winning_castaways).toHaveLength(10);

    expect(inEpisode(SEASON_51_ELIMINATIONS, 1)).toEqual([
      expect.objectContaining({ castaway_id: "US0752", variant: "tribal" }),
    ]);
  });

  it("records the idol find and both shot in the dark plays", () => {
    expect(
      inEpisode(SEASON_51_EVENTS, 1).map((e) => [e.castaway_id, e.action]),
    ).toEqual([
      ["US0771", "find_idol"],
      ["US0752", "use_shot_in_the_dark_unsuccessfully"],
      ["US0763", "use_shot_in_the_dark_unsuccessfully"],
    ]);
    // Shot in the dark players cast no vote, so 10 source rows become 8 votes.
    expect(inEpisode(SEASON_51_VOTE_HISTORY, 1)).toHaveLength(8);
  });

  it("uses only known castaways and scored actions", () => {
    const castawayIds = [
      ...Object.values(SEASON_51_CHALLENGES).flatMap(
        (c) => c.winning_castaways,
      ),
      ...Object.values(SEASON_51_ELIMINATIONS).map((e) => e.castaway_id),
      ...Object.values(SEASON_51_EVENTS).map((e) => e.castaway_id),
      ...Object.values(SEASON_51_VOTE_HISTORY).flatMap((v) => [
        v.voter_castaway_id,
        v.target_castaway_id,
        v.voted_out_castaway_id,
      ]),
    ];
    for (const id of castawayIds) {
      expect(SEASON_51_CASTAWAY_LOOKUP).toHaveProperty(id);
    }

    const scoredActions = new Set(BASE_PLAYER_SCORING.map((r) => r.action));
    for (const event of Object.values(SEASON_51_EVENTS)) {
      expect(scoredActions).toContain(event.action);
    }
    for (const challenge of Object.values(SEASON_51_CHALLENGES)) {
      expect(scoredActions).toContain(challenge.variant);
    }
  });
});

/**
 * Season 51 episode 2 as published in doehm/survivoR@6b2bcdc: Toka (the ten
 * castaways below) won the reward challenge "Five Blind Mice" (challenge_id 2)
 * and the immunity challenge "Hartford Whalers" (3); Ana Sani was voted out
 * 6 to 4 over Eric Macksoud; Jelly found a hidden immunity idol on day 4.
 * survivoR has no journey for the episode.
 */
describe("season 51 episode 2", () => {
  const TOKA = [
    "US0754",
    "US0756",
    "US0757",
    "US0760",
    "US0761",
    "US0763",
    "US0765",
    "US0767",
    "US0768",
    "US0770",
  ];

  it("is the second aired episode, not a finale and not the merge", () => {
    expect(SEASON_51_EPISODES.length).toBeGreaterThanOrEqual(2);
    expect(SEASON_51_EPISODES[1]).toMatchObject({
      id: "episode_2",
      order: 2,
      name: "Weaponized Honesty",
      air_date: "2026-09-30",
      finale: false,
      merge_occurs: false,
    });
  });

  it("credits Toka's reward and immunity wins and the second boot", () => {
    const challenges = inEpisode(SEASON_51_CHALLENGES, 2);
    expect(challenges.map((c) => c.variant)).toEqual([
      "team_reward",
      "team_immunity",
    ]);
    for (const c of challenges) {
      expect([...c.winning_castaways].sort()).toEqual(TOKA);
    }
    expect(inEpisode(SEASON_51_ELIMINATIONS, 2)).toEqual([
      expect.objectContaining({
        castaway_id: "US0755",
        order: 2,
        variant: "tribal",
      }),
    ]);
  });

  it("records Jelly's idol find and the 6 to 4 vote", () => {
    expect(
      inEpisode(SEASON_51_EVENTS, 2).map((e) => [e.castaway_id, e.action]),
    ).toEqual([["US0756", "find_idol"]]);

    const votes = inEpisode(SEASON_51_VOTE_HISTORY, 2);
    expect(votes).toHaveLength(10);
    const tally = new Map<string, number>();
    for (const v of votes) {
      expect(v.voted_out_castaway_id).toBe("US0755");
      tally.set(
        v.target_castaway_id,
        (tally.get(v.target_castaway_id) ?? 0) + 1,
      );
    }
    expect(Object.fromEntries(tally)).toEqual({ US0755: 6, US0762: 4 });
  });

  it("scores the episode under the existing rules", () => {
    const totals = Object.fromEntries(
      SEASON_51_PLAYERS.map((p) => [
        p.castaway_id,
        getEnhancedSurvivorPoints(
          Object.values(SEASON_51_CHALLENGES),
          Object.values(SEASON_51_ELIMINATIONS),
          Object.values(SEASON_51_EVENTS),
          2,
          p.castaway_id as CastawayId,
        ).total,
      ]),
    );
    const points = (action: string) =>
      BASE_PLAYER_SCORING.find((r) => r.action === action)!.fixed_value!;

    for (const id of TOKA) {
      expect(totals[id]).toBe(
        points("team_reward") +
          points("team_immunity") +
          (id === "US0756" ? points("find_idol") : 0),
      );
    }
    // An eliminated castaway earns the episode number.
    expect(totals.US0755).toBe(2);
    expect(totals.US0752).toBe(0);
    const savuStillIn = SEASON_51_PLAYERS.map((p) => p.castaway_id).filter(
      (id) => !TOKA.includes(id) && id !== "US0755" && id !== "US0752",
    );
    expect(savuStillIn).toHaveLength(9);
    for (const id of savuStillIn) expect(totals[id]).toBe(0);
  });
});

/**
 * Season 51 episode 3 as published in doehm/survivoR@2b8c3a3, imported under
 * the one waiver in scripts/lib/episode-readiness.ts: survivoR has no
 * challenge_description row for its challenge (4), so nothing confirms it was
 * the episode's only one. Savu (the seven castaways below) won the combined
 * immunity and reward challenge; Rob Antonson quit on day 6; Patt Cannaday was
 * voted out 6 to 5 over Danny Kilby; Carter Krull received Rob's idol; Devin
 * Way and Brady Booker found extra votes, and Brady gave his to Maggie Nestor.
 * survivoR has no journey for the episode.
 */
describe("season 51 episode 3", () => {
  const SAVU = [
    "US0753",
    "US0759",
    "US0762",
    "US0764",
    "US0766",
    "US0769",
    "US0772",
  ];

  it("is the third aired episode, not a finale and not the merge", () => {
    expect(SEASON_51_EPISODES[2]).toMatchObject({
      id: "episode_3",
      order: 3,
      name: "What I'm Smellin' Is Stinky",
      air_date: "2026-10-07",
      finale: false,
      merge_occurs: false,
    });
  });

  it("credits Savu's immunity and reward win, the quit and the boot", () => {
    const challenges = inEpisode(SEASON_51_CHALLENGES, 3);
    expect(challenges.map((c) => c.variant)).toEqual([
      "team_immunity",
      "team_reward",
    ]);
    for (const c of challenges) {
      expect([...c.winning_castaways].sort()).toEqual(SAVU);
    }
    expect(
      inEpisode(SEASON_51_ELIMINATIONS, 3).map((e) => [
        e.castaway_id,
        e.order,
        e.variant,
      ]),
    ).toEqual([
      ["US0771", 3, "quitter"],
      ["US0770", 4, "tribal"],
    ]);
  });

  it("records the advantage events and the 6 to 5 vote", () => {
    expect(
      inEpisode(SEASON_51_EVENTS, 3).map((e) => [e.castaway_id, e.action]),
    ).toEqual([
      ["US0758", "win_idol"],
      ["US0761", "find_extra_vote"],
      ["US0757", "find_extra_vote"],
      ["US0767", "win_other_advantage"],
    ]);

    const votes = inEpisode(SEASON_51_VOTE_HISTORY, 3);
    expect(votes).toHaveLength(11);
    const tally = new Map<string, number>();
    for (const v of votes) {
      expect(v.voted_out_castaway_id).toBe("US0770");
      expect(v.nullified).toBe(false);
      tally.set(
        v.target_castaway_id,
        (tally.get(v.target_castaway_id) ?? 0) + 1,
      );
    }
    expect(Object.fromEntries(tally)).toEqual({ US0770: 6, US0760: 5 });
  });

  it("scores the episode under the existing rules", () => {
    const totals = Object.fromEntries(
      SEASON_51_PLAYERS.map((p) => [
        p.castaway_id,
        getEnhancedSurvivorPoints(
          Object.values(SEASON_51_CHALLENGES),
          Object.values(SEASON_51_ELIMINATIONS),
          Object.values(SEASON_51_EVENTS),
          3,
          p.castaway_id as CastawayId,
        ).total,
      ]),
    );
    const points = (action: string) =>
      BASE_PLAYER_SCORING.find((r) => r.action === action)!.fixed_value!;

    for (const id of SAVU) {
      expect(totals[id]).toBe(points("team_immunity") + points("team_reward"));
    }
    expect(totals.US0758).toBe(points("win_idol"));
    expect(totals.US0761).toBe(points("find_extra_vote"));
    expect(totals.US0757).toBe(points("find_extra_vote"));
    expect(totals.US0767).toBe(points("win_other_advantage"));
    // The quit comes first; the boot is the episode's second elimination.
    expect(totals.US0771).toBe(3 + points("quitter"));
    expect(totals.US0770).toBe(3.5);

    const scored = new Set([
      ...SAVU,
      "US0758",
      "US0761",
      "US0757",
      "US0767",
      "US0771",
      "US0770",
    ]);
    const others = SEASON_51_PLAYERS.map((p) => p.castaway_id).filter(
      (id) => !scored.has(id),
    );
    expect(others).toHaveLength(8);
    for (const id of others) expect(totals[id]).toBe(0);
  });
});
