import { describe, expect, it } from "vitest";
import type { SlimUser } from "../../types";
import {
  buildParticipantMap,
  buildPickOrderUidMap,
  buildTurnsMap,
  normalizeDraft,
  planDraftPicks,
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
  it("builds deterministic turn assignments", () => {
    expect(buildTurnsMap([userA, userB], 5)).toEqual({
      "1": "user_a",
      "2": "user_b",
      "3": "user_a",
      "4": "user_b",
      "5": "user_a",
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
