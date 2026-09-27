import { describe, expect, it } from "vitest";
import { BASE_PLAYER_SCORING } from "../scoring";
import {
  SEASON_51_CASTAWAY_LOOKUP,
  SEASON_51_CHALLENGES,
  SEASON_51_ELIMINATIONS,
  SEASON_51_EPISODES,
  SEASON_51_EVENTS,
  SEASON_51_VOTE_HISTORY,
} from "../season_51";

/**
 * Season 51 episode 1 as published in doehm/survivoR@7336413. These pin the
 * bundled results to the source rows so a regeneration that drops or reshapes
 * them is caught before it reaches Firestore.
 */
describe("season 51 episode 1", () => {
  it("has one aired episode that is not a finale", () => {
    expect(SEASON_51_EPISODES).toHaveLength(1);
    expect(SEASON_51_EPISODES[0]).toMatchObject({
      id: "episode_1",
      name: "Permanent Uncertainty",
      air_date: "2026-09-23",
      finale: false,
    });
  });

  it("credits the Savu tribe immunity win and the first boot", () => {
    expect(Object.values(SEASON_51_CHALLENGES)).toHaveLength(1);
    expect(SEASON_51_CHALLENGES.challenge_0.variant).toBe("team_immunity");
    expect(SEASON_51_CHALLENGES.challenge_0.winning_castaways).toHaveLength(10);

    expect(Object.values(SEASON_51_ELIMINATIONS)).toEqual([
      expect.objectContaining({ castaway_id: "US0752", variant: "tribal" }),
    ]);
  });

  it("records the idol find and both shot in the dark plays", () => {
    expect(
      Object.values(SEASON_51_EVENTS).map((e) => [e.castaway_id, e.action]),
    ).toEqual([
      ["US0771", "find_idol"],
      ["US0752", "use_shot_in_the_dark_unsuccessfully"],
      ["US0763", "use_shot_in_the_dark_unsuccessfully"],
    ]);
    // Shot in the dark players cast no vote, so 10 source rows become 8 votes.
    expect(Object.values(SEASON_51_VOTE_HISTORY)).toHaveLength(8);
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
    expect(scoredActions).toContain(SEASON_51_CHALLENGES.challenge_0.variant);
  });
});
