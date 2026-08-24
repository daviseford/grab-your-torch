import { describe, expect, it } from "vitest";
import { getActivePropBetKeys, PropBetsQuestions } from "../../data/propbets";
import {
  CastawayId,
  Challenge,
  Competition,
  Elimination,
  GameEvent,
} from "../../types";
import { getPropBetScoresForUser } from "../propBetUtils";

// --- Factories ---

const makeElimination = (
  id: string,
  episodeNum: number,
  castawayId: CastawayId,
  order: number,
  variant: Elimination["variant"] = "tribal",
): Elimination => ({
  id: `elimination_${id}`,
  season_id: "season_46",
  season_num: 46,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  castaway_id: castawayId,
  order,
  variant,
});

const makeEvent = (
  id: string,
  episodeNum: number,
  castawayId: CastawayId,
  action: GameEvent["action"],
): GameEvent => ({
  id: `event_${id}`,
  season_id: "season_46",
  season_num: 46,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  action,
  multiplier: null,
  castaway_id: castawayId,
});

const makeChallenge = (
  id: string,
  episodeNum: number,
  winningCastaways: CastawayId[],
  variant: Challenge["variant"] = "immunity",
): Challenge => ({
  id: `challenge_${id}`,
  season_id: "season_46",
  season_num: 46,
  episode_id: `episode_${episodeNum}`,
  episode_num: episodeNum,
  order: 1,
  variant,
  winning_castaways: winningCastaways,
});

// Test castaway IDs
const ALICE = "US0001" as CastawayId;
const BOB = "US0002" as CastawayId;
const CHARLIE = "US0003" as CastawayId;

const baseCompetition: Competition = {
  id: "competition_test",
  competition_name: "Test",
  season_id: "season_46",
  season_num: 46,
  draft_id: "draft_test",
  creator_uid: "user1",
  participant_uids: ["user1"],
  participants: [
    { uid: "user1", displayName: "Player One", email: null, isAdmin: false },
  ],
  draft_picks: [],
  prop_bets: [
    {
      id: "propbet_user1",
      user_name: "Player One",
      user_uid: "user1",
      values: {
        propbet_first_vote: BOB,
        propbet_winner: ALICE,
        propbet_ftc: ALICE,
        propbet_idols: ALICE,
        propbet_immunities: ALICE,
        propbet_medical_evac: "No",
      },
    },
  ],
  current_episode: null,
  finished: false,
};

const noEvents: Record<string, GameEvent> = {};
const noElims: Record<string, Elimination> = {};
const noChallenges: Record<string, Challenge> = {};
const postMergeEpisodes = new Set<number>([8, 9, 10, 11, 12, 13]);

const getStatus = (
  key: keyof typeof PropBetsQuestions,
  overrides?: {
    events?: Record<string, GameEvent>;
    eliminations?: Record<string, Elimination>;
    challenges?: Record<string, Challenge>;
    postMergeEpisodes?: Set<number>;
    hasFinaleOccurred?: boolean;
    competition?: Competition;
  },
) => {
  const competition = overrides?.competition ?? baseCompetition;
  const result = getPropBetScoresForUser(
    "user1",
    overrides?.events ?? noEvents,
    overrides?.eliminations ?? noElims,
    overrides?.challenges ?? noChallenges,
    overrides?.postMergeEpisodes ?? postMergeEpisodes,
    overrides?.hasFinaleOccurred ?? false,
    getActivePropBetKeys(competition.prop_bets),
    competition,
  );
  return result[key];
};

// --- Tests ---

describe("getPropBetScoresForUser", () => {
  describe("propbet_first_vote", () => {
    it("returns pending when no eliminations exist", () => {
      const answer = getStatus("propbet_first_vote");
      expect(answer.status).toBe("pending");
      expect(answer.points_awarded).toBe(0);
    });

    it("returns definitive_correct when pick matches first elimination", () => {
      const elims = {
        e1: makeElimination("1", 1, BOB, 1),
      };
      const answer = getStatus("propbet_first_vote", { eliminations: elims });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_first_vote.point_value,
      );
    });

    it("returns definitive_incorrect when pick does not match first elimination", () => {
      const elims = {
        e1: makeElimination("1", 1, CHARLIE, 1),
      };
      const answer = getStatus("propbet_first_vote", { eliminations: elims });
      expect(answer.status).toBe("definitive_incorrect");
      expect(answer.points_awarded).toBe(0);
    });
  });

  describe("propbet_winner", () => {
    it("returns pending when player is alive and no finale", () => {
      const answer = getStatus("propbet_winner");
      expect(answer.status).toBe("pending");
    });

    it("returns definitive_incorrect when picked player is eliminated", () => {
      const elims = {
        e1: makeElimination("1", 5, ALICE, 3),
      };
      const answer = getStatus("propbet_winner", { eliminations: elims });
      expect(answer.status).toBe("definitive_incorrect");
    });

    it("returns pending when eliminated player returned to game (has later events)", () => {
      const elims = {
        e1: makeElimination("1", 3, ALICE, 2),
      };
      const events = {
        ev1: makeEvent("1", 8, ALICE, "find_idol"),
      };
      const answer = getStatus("propbet_winner", {
        eliminations: elims,
        events,
      });
      expect(answer.status).toBe("pending");
    });

    it("returns definitive_correct when win_survivor event matches pick", () => {
      const events = {
        ev1: makeEvent("1", 13, ALICE, "win_survivor"),
      };
      const answer = getStatus("propbet_winner", {
        events,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_winner.point_value,
      );
    });

    it("returns definitive_incorrect when someone else wins", () => {
      const events = {
        ev1: makeEvent("1", 13, CHARLIE, "win_survivor"),
      };
      const answer = getStatus("propbet_winner", {
        events,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_incorrect");
    });
  });

  describe("propbet_ftc", () => {
    it("returns pending when player is alive and no finale", () => {
      const answer = getStatus("propbet_ftc");
      expect(answer.status).toBe("pending");
    });

    it("returns definitive_incorrect when picked player is eliminated", () => {
      const elims = {
        e1: makeElimination("1", 5, ALICE, 3, "tribal"),
      };
      const answer = getStatus("propbet_ftc", { eliminations: elims });
      expect(answer.status).toBe("definitive_incorrect");
    });

    it("returns pending when eliminated player returned to game", () => {
      const elims = {
        e1: makeElimination("1", 3, ALICE, 2, "tribal"),
      };
      const events = {
        ev1: makeEvent("1", 8, ALICE, "find_idol"),
      };
      const answer = getStatus("propbet_ftc", { eliminations: elims, events });
      expect(answer.status).toBe("pending");
    });

    it("does not mark as incorrect when elimination variant is final_tribal_council", () => {
      const elims = {
        e1: makeElimination("1", 13, ALICE, 10, "final_tribal_council"),
      };
      const answer = getStatus("propbet_ftc", { eliminations: elims });
      expect(answer.status).not.toBe("definitive_incorrect");
    });

    it("returns definitive_correct when make_final_tribal_council event matches", () => {
      const events = {
        ev1: makeEvent("1", 13, ALICE, "make_final_tribal_council"),
      };
      const answer = getStatus("propbet_ftc", {
        events,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_ftc.point_value,
      );
    });

    it("returns definitive_incorrect when finale occurred but no FTC event for pick", () => {
      const answer = getStatus("propbet_ftc", { hasFinaleOccurred: true });
      expect(answer.status).toBe("definitive_incorrect");
    });
  });

  describe("propbet_medical_evac", () => {
    it("returns definitive_correct for Yes when evac occurred", () => {
      const comp = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              ...baseCompetition.prop_bets![0].values,
              propbet_medical_evac: "Yes",
            },
          },
        ],
      };
      const elims = {
        e1: makeElimination("1", 3, CHARLIE, 2, "medical"),
      };
      const answer = getStatus("propbet_medical_evac", {
        competition: comp,
        eliminations: elims,
      });
      expect(answer.status).toBe("definitive_correct");
    });

    it("returns definitive_incorrect for No when evac occurred", () => {
      const elims = {
        e1: makeElimination("1", 3, CHARLIE, 2, "medical"),
      };
      const answer = getStatus("propbet_medical_evac", { eliminations: elims });
      expect(answer.status).toBe("definitive_incorrect");
      expect(answer.resolved_by).toEqual({
        reason: "medical_evac",
        episode_num: 3,
        castaway_id: CHARLIE,
      });
    });

    it("reports the earliest evac when there are several", () => {
      const elims = {
        e1: makeElimination("1", 5, BOB, 2, "medical"),
        e2: makeElimination("2", 3, CHARLIE, 2, "medical"),
      };
      const answer = getStatus("propbet_medical_evac", { eliminations: elims });
      expect(answer.resolved_by?.episode_num).toBe(3);
      expect(answer.resolved_by?.castaway_id).toBe(CHARLIE);
    });

    it("returns pending for Yes when no evac and no finale", () => {
      const comp = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              ...baseCompetition.prop_bets![0].values,
              propbet_medical_evac: "Yes",
            },
          },
        ],
      };
      const answer = getStatus("propbet_medical_evac", { competition: comp });
      expect(answer.status).toBe("pending");
    });

    it("returns definitive_correct for No when no evac and finale reached", () => {
      const answer = getStatus("propbet_medical_evac", {
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
    });

    it("returns definitive_incorrect for Yes when no evac and finale reached", () => {
      const comp = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              ...baseCompetition.prop_bets![0].values,
              propbet_medical_evac: "Yes",
            },
          },
        ],
      };
      const answer = getStatus("propbet_medical_evac", {
        competition: comp,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_incorrect");
    });
  });

  describe("propbet_first_idol_found", () => {
    it("returns definitive_correct when pick matches the first idol find", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_first_idol_found: ALICE,
            },
          },
        ],
      };
      const events = {
        ev1: makeEvent("1", 2, ALICE, "find_idol"),
        ev2: makeEvent("2", 3, BOB, "find_idol"),
      };

      const answer = getStatus("propbet_first_idol_found", {
        competition: comp,
        events,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_first_idol_found.point_value,
      );
    });

    it("returns definitive_incorrect when another player finds the first idol", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_first_idol_found: ALICE,
            },
          },
        ],
      };
      const events = {
        ev1: makeEvent("1", 2, BOB, "find_idol"),
      };

      const answer = getStatus("propbet_first_idol_found", {
        competition: comp,
        events,
      });
      expect(answer.status).toBe("definitive_incorrect");
    });
  });

  describe("propbet_first_successful_idol_play", () => {
    it("returns definitive_correct when pick matches the first idol play", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_first_successful_idol_play: ALICE,
            },
          },
        ],
      };
      const events = {
        ev1: makeEvent("1", 4, ALICE, "use_idol"),
        ev2: makeEvent("2", 5, BOB, "use_idol"),
      };

      const answer = getStatus("propbet_first_successful_idol_play", {
        competition: comp,
        events,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_first_successful_idol_play.point_value,
      );
    });
  });

  describe("propbet_successful_shot_in_the_dark", () => {
    it("returns definitive_correct for Yes when someone succeeds", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_successful_shot_in_the_dark: "Yes",
            },
          },
        ],
      };
      const events = {
        ev1: makeEvent("1", 3, BOB, "use_shot_in_the_dark_successfully"),
      };

      const answer = getStatus("propbet_successful_shot_in_the_dark", {
        competition: comp,
        events,
      });
      expect(answer.status).toBe("definitive_correct");
    });

    it("returns definitive_correct for No when finale occurs with no success", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_successful_shot_in_the_dark: "No",
            },
          },
        ],
      };

      const answer = getStatus("propbet_successful_shot_in_the_dark", {
        competition: comp,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
    });
  });

  describe("propbet_idols", () => {
    it("returns pending when no idol events exist", () => {
      const answer = getStatus("propbet_idols");
      expect(answer.status).toBe("pending");
    });

    it("returns leading when picked player leads mid-season", () => {
      const events = {
        ev1: makeEvent("1", 2, ALICE, "find_idol"),
      };
      const answer = getStatus("propbet_idols", { events });
      expect(answer.status).toBe("leading");
      expect(answer.points_awarded).toBe(0);
    });

    it("returns leading when picked player tied for lead mid-season", () => {
      const events = {
        ev1: makeEvent("1", 2, ALICE, "find_idol"),
        ev2: makeEvent("2", 3, BOB, "find_idol"),
      };
      const answer = getStatus("propbet_idols", { events });
      expect(answer.status).toBe("leading");
    });

    it("returns leading when picked player eliminated but was leading", () => {
      const events = {
        ev1: makeEvent("1", 2, ALICE, "find_idol"),
      };
      const elims = {
        e1: makeElimination("1", 5, ALICE, 3),
      };
      const answer = getStatus("propbet_idols", {
        events,
        eliminations: elims,
      });
      expect(answer.status).toBe("leading");
    });

    it("returns definitive_incorrect when picked player eliminated with 0 finds and others have finds", () => {
      const events = {
        ev1: makeEvent("1", 2, BOB, "find_idol"),
      };
      const elims = {
        e1: makeElimination("1", 5, ALICE, 3),
      };
      const answer = getStatus("propbet_idols", {
        events,
        eliminations: elims,
      });
      expect(answer.status).toBe("definitive_incorrect");
    });

    it("returns pending when picked player was eliminated but returned (has events after elimination)", () => {
      const events = {
        ev1: makeEvent("1", 2, BOB, "find_idol"),
        ev2: makeEvent("2", 8, ALICE, "find_idol"),
      };
      const elims = {
        e1: makeElimination("1", 3, ALICE, 2),
      };
      const answer = getStatus("propbet_idols", {
        events,
        eliminations: elims,
      });
      // ALICE was eliminated ep 3 but found an idol ep 8 (returned to game)
      // She is tied with BOB so she should be "leading", not "definitive_incorrect"
      expect(answer.status).toBe("leading");
    });

    it("returns pending when picked player was eliminated but returned (has challenge wins after elimination)", () => {
      const events = {
        ev1: makeEvent("1", 2, BOB, "find_idol"),
      };
      const elims = {
        e1: makeElimination("1", 3, ALICE, 2),
      };
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "immunity"),
      };
      const answer = getStatus("propbet_idols", {
        events,
        eliminations: elims,
        challenges,
      });
      // ALICE was eliminated ep 3 but won a challenge ep 8 (returned to game)
      // She has 0 idol finds vs BOB's 1, but she's still active so status is "pending"
      expect(answer.status).toBe("pending");
    });

    it("returns definitive_correct at finale when picked player leads", () => {
      const events = {
        ev1: makeEvent("1", 2, ALICE, "find_idol"),
        ev2: makeEvent("2", 5, ALICE, "find_idol"),
        ev3: makeEvent("3", 7, BOB, "find_idol"),
      };
      const answer = getStatus("propbet_idols", {
        events,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_idols.point_value,
      );
    });

    it("returns definitive_incorrect at finale when picked player does not lead", () => {
      const events = {
        ev1: makeEvent("1", 2, BOB, "find_idol"),
        ev2: makeEvent("2", 5, BOB, "find_idol"),
        ev3: makeEvent("3", 7, ALICE, "find_idol"),
      };
      const answer = getStatus("propbet_idols", {
        events,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_incorrect");
    });

    it("correctly identifies leader even when picked player appears first in data", () => {
      const events = {
        ev1: makeEvent("1", 1, ALICE, "find_idol"),
        ev2: makeEvent("2", 2, BOB, "find_idol"),
        ev3: makeEvent("3", 3, BOB, "find_idol"),
      };
      const answer = getStatus("propbet_idols", { events });
      expect(answer.status).toBe("pending");
    });
  });

  describe("propbet_immunities", () => {
    it("returns pending when no immunity challenges exist", () => {
      const answer = getStatus("propbet_immunities");
      expect(answer.status).toBe("pending");
    });

    it("returns leading when picked player leads mid-season", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "immunity"),
      };
      const answer = getStatus("propbet_immunities", { challenges });
      expect(answer.status).toBe("leading");
      expect(answer.points_awarded).toBe(0);
    });

    it("returns definitive_correct at finale when picked player leads", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "immunity"),
        c2: makeChallenge("2", 9, [ALICE], "immunity"),
        c3: makeChallenge("3", 10, [BOB], "immunity"),
      };
      const answer = getStatus("propbet_immunities", {
        challenges,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_immunities.point_value,
      );
    });

    it("returns definitive_incorrect when eliminated and behind leader", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [BOB], "immunity"),
        c2: makeChallenge("2", 9, [BOB], "immunity"),
      };
      const elims = {
        e1: makeElimination("1", 4, ALICE, 2),
      };
      const answer = getStatus("propbet_immunities", {
        challenges,
        eliminations: elims,
      });
      expect(answer.status).toBe("definitive_incorrect");
    });

    it("returns pending when eliminated but returned (has events after elimination) and behind leader", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [BOB], "immunity"),
        c2: makeChallenge("2", 9, [BOB], "immunity"),
      };
      const elims = {
        e1: makeElimination("1", 4, ALICE, 2),
      };
      const events = {
        ev1: makeEvent("1", 8, ALICE, "find_idol"),
      };
      const answer = getStatus("propbet_immunities", {
        challenges,
        eliminations: elims,
        events,
      });
      // ALICE was eliminated ep 4 but has an event ep 8 (returned to game)
      // She's behind BOB but still active, so status should be "pending"
      expect(answer.status).toBe("pending");
    });

    it("returns pending when eliminated but returned (has challenge win after elimination) and behind leader", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [BOB], "immunity"),
        c2: makeChallenge("2", 9, [BOB], "immunity"),
        c3: makeChallenge("3", 10, [ALICE], "immunity"),
      };
      const elims = {
        e1: makeElimination("1", 4, ALICE, 2),
      };
      const answer = getStatus("propbet_immunities", {
        challenges,
        eliminations: elims,
      });
      // ALICE was eliminated ep 4 but won immunity ep 8 (returned to game)
      // She has 1 win vs BOB's 2, but she's still active so status is "pending"
      expect(answer.status).toBe("pending");
    });

    it("handles immunity challenge variant", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "immunity"),
      };
      const answer = getStatus("propbet_immunities", { challenges });
      expect(answer.status).toBe("leading");
    });

    it("excludes team_immunity challenges from individual immunity count", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "immunity"),
        c2: makeChallenge(
          "2",
          9,
          [BOB, CHARLIE, ALICE],
          "team_immunity" as Challenge["variant"],
        ),
      };
      const answer = getStatus("propbet_immunities", {
        challenges,
        hasFinaleOccurred: true,
      });
      // Only ALICE's individual immunity should count, not the team_immunity
      expect(answer.status).toBe("definitive_correct");
    });
  });

  describe("propbet_rewards", () => {
    it("returns definitive_correct at finale for the most post-merge reward wins", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_rewards: ALICE,
            },
          },
        ],
      };
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "reward"),
        c2: makeChallenge("2", 9, [ALICE], "reward"),
        c3: makeChallenge("3", 10, [BOB], "reward"),
        c4: makeChallenge("4", 2, [BOB, CHARLIE, ALICE], "reward"),
      };

      const answer = getStatus("propbet_rewards", {
        competition: comp,
        challenges,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.points_awarded).toBe(
        PropBetsQuestions.propbet_rewards.point_value,
      );
    });

    it("ignores pre-merge and team reward results", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_rewards: ALICE,
            },
          },
        ],
      };
      const challenges = {
        c1: makeChallenge(
          "1",
          8,
          [ALICE, BOB, CHARLIE],
          "team_reward" as Challenge["variant"],
        ),
        c2: makeChallenge("2", 2, [ALICE], "reward"),
        c3: makeChallenge("3", 8, [BOB], "reward"),
      };

      const answer = getStatus("propbet_rewards", {
        competition: comp,
        challenges,
      });
      // team_reward excluded, pre-merge excluded, only BOB's post-merge reward counts
      expect(answer.status).toBe("pending");
    });
  });

  describe("propbet_quit", () => {
    it("returns definitive_correct for Yes when someone quits", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_quit: "Yes",
            },
          },
        ],
      };
      const elims = {
        e1: makeElimination("1", 6, BOB, 4, "quitter"),
      };

      const answer = getStatus("propbet_quit", {
        competition: comp,
        eliminations: elims,
      });
      expect(answer.status).toBe("definitive_correct");
    });

    it("returns definitive_correct for No when finale occurs with no quit", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_quit: "No",
            },
          },
        ],
      };

      const answer = getStatus("propbet_quit", {
        competition: comp,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
    });
  });

  describe("resolved_by", () => {
    it("is absent while a bet is pending", () => {
      expect(getStatus("propbet_medical_evac").resolved_by).toBeUndefined();
      expect(getStatus("propbet_winner").resolved_by).toBeUndefined();
    });

    it("is absent when only the finale settled a yes/no bet", () => {
      const answer = getStatus("propbet_medical_evac", {
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.resolved_by).toBeUndefined();
    });

    it("names the first elimination for the first-out bet", () => {
      const elims = { e1: makeElimination("1", 1, ALICE, 1) };
      const answer = getStatus("propbet_first_vote", { eliminations: elims });
      expect(answer.status).toBe("definitive_incorrect");
      expect(answer.resolved_by).toEqual({
        reason: "first_elimination",
        episode_num: 1,
        castaway_id: ALICE,
      });
    });

    it("names the elimination that took the winner pick out", () => {
      const elims = { e1: makeElimination("1", 4, ALICE, 1) };
      const answer = getStatus("propbet_winner", { eliminations: elims });
      expect(answer.status).toBe("definitive_incorrect");
      expect(answer.resolved_by).toEqual({
        reason: "eliminated",
        episode_num: 4,
        castaway_id: ALICE,
      });
    });

    it("names the win_survivor event for a settled winner bet", () => {
      const events = { w: makeEvent("w", 13, ALICE, "win_survivor") };
      const answer = getStatus("propbet_winner", { events });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.resolved_by).toEqual({
        reason: "winner",
        episode_num: 13,
        castaway_id: ALICE,
      });
    });

    it("names the FTC event when the pick makes final tribal", () => {
      const events = {
        f: makeEvent("f", 13, ALICE, "make_final_tribal_council"),
      };
      const answer = getStatus("propbet_ftc", { events });
      expect(answer.resolved_by?.reason).toBe("made_ftc");
    });

    it("names the first idol find for the first-idol bet", () => {
      const comp = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              ...baseCompetition.prop_bets![0].values,
              propbet_first_idol_found: ALICE,
            },
          },
        ],
      };
      const events = {
        a: makeEvent("a", 4, BOB, "find_idol"),
        b: makeEvent("b", 2, CHARLIE, "find_idol"),
      };
      const answer = getStatus("propbet_first_idol_found", {
        competition: comp,
        events,
      });
      expect(answer.status).toBe("definitive_incorrect");
      expect(answer.resolved_by).toEqual({
        reason: "first_idol",
        episode_num: 2,
        castaway_id: CHARLIE,
      });
    });

    it("names the quit for a quit bet", () => {
      const comp = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              ...baseCompetition.prop_bets![0].values,
              propbet_quit: "Yes",
            },
          },
        ],
      };
      const elims = { e1: makeElimination("1", 6, BOB, 1, "quitter") };
      const answer = getStatus("propbet_quit", {
        competition: comp,
        eliminations: elims,
      });
      expect(answer.status).toBe("definitive_correct");
      expect(answer.resolved_by).toEqual({
        reason: "quit",
        episode_num: 6,
        castaway_id: BOB,
      });
    });
  });

  describe("points_awarded", () => {
    it("only awards points for definitive_correct status", () => {
      const elims = {
        e1: makeElimination("1", 1, BOB, 1),
      };
      const result = getPropBetScoresForUser(
        "user1",
        noEvents,
        elims,
        noChallenges,
        postMergeEpisodes,
        false,
        getActivePropBetKeys(baseCompetition.prop_bets),
        baseCompetition,
      );

      expect(result.propbet_first_vote.status).toBe("definitive_correct");
      expect(result.propbet_first_vote.points_awarded).toBeGreaterThan(0);

      expect(result.propbet_winner.points_awarded).toBe(0);
      expect(result.propbet_ftc.points_awarded).toBe(0);
      expect(result.propbet_idols.points_awarded).toBe(0);
      expect(result.propbet_immunities.points_awarded).toBe(0);
      expect(result.propbet_medical_evac.points_awarded).toBe(0);

      expect(result.total).toBe(
        PropBetsQuestions.propbet_first_vote.point_value,
      );
    });
  });

  describe("no prop bets submitted", () => {
    it("returns all pending with empty answers when user has no prop bets", () => {
      const comp = {
        ...baseCompetition,
        prop_bets: [],
      };
      const result = getPropBetScoresForUser(
        "user1",
        noEvents,
        noElims,
        noChallenges,
        postMergeEpisodes,
        false,
        getActivePropBetKeys(comp.prop_bets),
        comp,
      );
      expect(result.propbet_first_vote.status).toBe("pending");
      expect(result.propbet_first_vote.answer).toBe("");
      expect(result.total).toBe(0);
    });
  });

  describe("global prop compatibility", () => {
    it("ignores globally defined props that nobody answered in this competition", () => {
      const comp: Competition = {
        ...baseCompetition,
        prop_bets: [
          {
            ...baseCompetition.prop_bets![0],
            values: {
              propbet_winner: ALICE,
            },
          },
        ],
      };

      const events = {
        ev1: makeEvent("1", 13, ALICE, "win_survivor"),
      };

      const result = getPropBetScoresForUser(
        "user1",
        events,
        noElims,
        noChallenges,
        postMergeEpisodes,
        true,
        getActivePropBetKeys(comp.prop_bets),
        comp,
      );

      expect(result.propbet_winner.points_awarded).toBe(
        PropBetsQuestions.propbet_winner.point_value,
      );
      expect(result.propbet_ftc.points_awarded).toBe(0);
      expect(result.total).toBe(PropBetsQuestions.propbet_winner.point_value);
    });
  });

  describe("post-merge individual immunity filtering", () => {
    it("ignores pre-merge and multi-winner immunity results", () => {
      const challenges = {
        c1: makeChallenge("1", 2, [ALICE, BOB, CHARLIE], "immunity"),
        c2: makeChallenge("2", 8, [BOB], "immunity"),
      };

      const answer = getStatus("propbet_immunities", { challenges });
      expect(answer.status).toBe("pending");
    });

    it("counts post-merge individual immunity wins", () => {
      const challenges = {
        c1: makeChallenge("1", 8, [ALICE], "immunity"),
        c2: makeChallenge("2", 9, [ALICE], "immunity"),
        c3: makeChallenge("3", 10, [BOB], "immunity"),
      };

      const answer = getStatus("propbet_immunities", {
        challenges,
        hasFinaleOccurred: true,
      });
      expect(answer.status).toBe("definitive_correct");
    });
  });
});
