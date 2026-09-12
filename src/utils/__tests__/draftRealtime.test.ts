import { describe, expect, it } from "vitest";
import type { SlimUser } from "../../types";
import {
  buildParticipantMap,
  buildPickOrderUidMap,
  buildTurnsMap,
  normalizeDraft,
  planDraftPicks,
  snakePickIndex,
  snakePickNumber,
} from "../draftRealtime";

const userA = {
  uid: "user_a",
  email: "a@example.com",
  displayName: "A",
  isAdmin: false,
} satisfies SlimUser;

const userB = {
  uid: "user_b",
  email: "b@example.com",
  displayName: "B",
  isAdmin: false,
} satisfies SlimUser;

const userC = {
  uid: "user_c",
  email: "c@example.com",
  displayName: "C",
  isAdmin: false,
} satisfies SlimUser;

describe("planDraftPicks", () => {
  it("splits an even cast with nothing left over", () => {
    expect(planDraftPicks(18, 3)).toEqual({
      totalPicks: 18,
      picksEach: 6,
      undrafted: 0,
    });
  });

  it("leaves the remainder undrafted when the cast does not divide evenly", () => {
    expect(planDraftPicks(21, 2)).toEqual({
      totalPicks: 20,
      picksEach: 10,
      undrafted: 1,
    });
    expect(planDraftPicks(21, 4)).toEqual({
      totalPicks: 20,
      picksEach: 5,
      undrafted: 1,
    });
    expect(planDraftPicks(18, 4)).toEqual({
      totalPicks: 16,
      picksEach: 4,
      undrafted: 2,
    });
  });

  it("plans nothing without participants", () => {
    expect(planDraftPicks(21, 0)).toEqual({
      totalPicks: 0,
      picksEach: 0,
      undrafted: 21,
    });
  });
});

describe("draftRealtime", () => {
  it("builds deterministic turn assignments that snake", () => {
    expect(buildTurnsMap([userA, userB], 5)).toEqual({
      "1": "user_a",
      "2": "user_b",
      "3": "user_b",
      "4": "user_a",
      "5": "user_a",
    });
  });

  it("snakes three participants across rounds", () => {
    expect(buildTurnsMap([userA, userB, userC], 6)).toEqual({
      "1": "user_a",
      "2": "user_b",
      "3": "user_c",
      "4": "user_c",
      "5": "user_b",
      "6": "user_a",
    });
  });

  it("normalizes realtime drafts into UI drafts", () => {
    const draft = normalizeDraft({
      id: "draft_test",
      season_id: "season_1",
      season_num: 1,
      competiton_id: "competition_test",
      creator_uid: userA.uid,
      total_players: 4,
      participants: buildParticipantMap([userA, userB]),
      pick_order_uids: buildPickOrderUidMap([userA, userB]),
      turns: buildTurnsMap([userA, userB], 4),
      draft_picks: {
        "1": {
          season_id: "season_1",
          season_num: 1,
          order: 1,
          user_uid: userA.uid,
          user_name: "A",
          castaway_id: "US0001",
          player_name: "Player 1",
        },
      },
      prop_bets: {
        [userB.uid]: {
          id: "propbet_1",
          user_uid: userB.uid,
          user_name: "B",
          values: {
            propbet_first_vote: "US0001",
            propbet_ftc: "US0002",
            propbet_idols: "US0003",
            propbet_immunities: "US0004",
            propbet_medical_evac: "No",
            propbet_winner: "US0005",
          },
        },
      },
      state: {
        started: true,
        finished: false,
        current_pick_number: 2,
      },
    });

    expect(draft).toBeDefined();
    expect(draft?.participants.map((participant) => participant.uid)).toEqual([
      userA.uid,
      userB.uid,
    ]);
    expect(draft?.pick_order.map((participant) => participant.uid)).toEqual([
      userA.uid,
      userB.uid,
    ]);
    expect(draft?.current_picker?.uid).toBe(userB.uid);
    expect(draft?.draft_picks).toHaveLength(1);
    expect(draft?.prop_bets).toHaveLength(1);
  });
});

describe("snake ordering", () => {
  it("runs odd rounds down the order and even rounds back up it", () => {
    const columns = [1, 2, 3, 4, 5, 6].map((pick) => snakePickIndex(pick, 3));
    expect(columns).toEqual([0, 1, 2, 2, 1, 0]);
  });

  it("keeps a solo participant on every pick", () => {
    expect(snakePickIndex(1, 1)).toBe(0);
    expect(snakePickIndex(2, 1)).toBe(0);
  });

  it("inverts cleanly, so board cells and turns agree", () => {
    for (let pick = 1; pick <= 12; pick++) {
      const roundIndex = Math.floor((pick - 1) / 4);
      const columnIndex = snakePickIndex(pick, 4);
      expect(snakePickNumber(roundIndex, columnIndex, 4)).toBe(pick);
    }
  });
});
