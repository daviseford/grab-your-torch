import { describe, expect, it } from "vitest";
import type { SlimUser } from "../../types";
import {
  isRepeatTurn,
  shouldNudgePropBets,
  turnAlertAction,
  turnAlertKey,
  turnAlertMessage,
  type TurnAlertDraft,
} from "../draftAttention";

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

const pick = (
  order: number,
  user: SlimUser,
): TurnAlertDraft["draft_picks"][number] => ({
  season_id: "season_1",
  season_num: 1,
  order,
  user_uid: user.uid,
  user_name: user.displayName ?? user.uid,
  castaway_id: "US9901",
  player_name: "Test Player 1",
});

const makeDraft = (
  overrides: Partial<TurnAlertDraft> = {},
): TurnAlertDraft => ({
  id: "draft_x",
  started: true,
  finished: false,
  current_pick_number: 3,
  total_players: 8,
  current_picker: userA,
  participants: [userA, userB],
  draft_picks: [pick(1, userA), pick(2, userB)],
  ...overrides,
});

describe("turnAlertKey", () => {
  it("returns the draft and pick identity for the viewer on the clock", () => {
    expect(turnAlertKey(makeDraft(), userA.uid)).toBe("draft_x:3");
  });

  it("gives a different key per pick, so consecutive snake turns re-alert", () => {
    const onPick3 = makeDraft({ current_pick_number: 3 });
    const onPick4 = makeDraft({
      current_pick_number: 4,
      draft_picks: [pick(1, userA), pick(2, userB), pick(3, userA)],
    });
    const key3 = turnAlertKey(onPick3, userA.uid);
    const key4 = turnAlertKey(onPick4, userA.uid);
    expect(key3).toBe("draft_x:3");
    expect(key4).toBe("draft_x:4");
    expect(key3).not.toBe(key4);
  });

  it("returns null for a spectator who is not a participant", () => {
    expect(turnAlertKey(makeDraft(), "user_spectator")).toBeNull();
  });

  it("returns null for a participant who is not on the clock", () => {
    expect(turnAlertKey(makeDraft(), userB.uid)).toBeNull();
  });

  it("returns null once the draft is finished", () => {
    expect(turnAlertKey(makeDraft({ finished: true }), userA.uid)).toBeNull();
  });

  it("returns null before the draft starts", () => {
    expect(turnAlertKey(makeDraft({ started: false }), userA.uid)).toBeNull();
  });

  it("returns null when the picker is not in participants", () => {
    expect(
      turnAlertKey(makeDraft({ participants: [userB] }), userA.uid),
    ).toBeNull();
  });

  it("returns null for out-of-range pick numbers", () => {
    expect(
      turnAlertKey(makeDraft({ current_pick_number: 0 }), userA.uid),
    ).toBeNull();
    expect(
      turnAlertKey(makeDraft({ current_pick_number: 9 }), userA.uid),
    ).toBeNull();
  });

  it("returns null for a signed-out viewer or a missing draft", () => {
    expect(turnAlertKey(makeDraft(), undefined)).toBeNull();
    expect(turnAlertKey(undefined, userA.uid)).toBeNull();
  });
});

describe("isRepeatTurn", () => {
  it("is true when the viewer also made the previous pick", () => {
    const draft = makeDraft({
      current_pick_number: 4,
      draft_picks: [pick(1, userA), pick(2, userB), pick(3, userA)],
    });
    expect(isRepeatTurn(draft, userA.uid)).toBe(true);
  });

  it("is false when someone else made the previous pick", () => {
    expect(isRepeatTurn(makeDraft(), userA.uid)).toBe(false);
  });

  it("is false on the first pick and for missing input", () => {
    expect(
      isRepeatTurn(
        makeDraft({ current_pick_number: 1, draft_picks: [] }),
        userA.uid,
      ),
    ).toBe(false);
    expect(isRepeatTurn(undefined, userA.uid)).toBe(false);
    expect(isRepeatTurn(makeDraft(), undefined)).toBe(false);
  });
});

describe("turnAlertMessage", () => {
  it("returns the exact copy for fresh and snake turns, with no em-dashes", () => {
    expect(turnAlertMessage(false)).toBe(
      "Pick a castaway from the cast below.",
    );
    expect(turnAlertMessage(true)).toBe("Snake turn: you pick again.");
    expect(turnAlertMessage(false)).not.toContain("—");
    expect(turnAlertMessage(true)).not.toContain("—");
  });
});

describe("turnAlertAction", () => {
  it("does nothing when there is no turn", () => {
    expect(
      turnAlertAction({ key: null, alertedKey: null, hidden: false }),
    ).toBe("none");
  });

  it("does nothing for a pick this tab already alerted (reconnect, re-render)", () => {
    expect(
      turnAlertAction({
        key: "draft_x:3",
        alertedKey: "draft_x:3",
        hidden: false,
      }),
    ).toBe("none");
  });

  it("defers a new turn while the tab is hidden", () => {
    expect(
      turnAlertAction({ key: "draft_x:3", alertedKey: null, hidden: true }),
    ).toBe("defer");
  });

  it("alerts for a new turn while the tab is visible", () => {
    expect(
      turnAlertAction({ key: "draft_x:3", alertedKey: null, hidden: false }),
    ).toBe("alert");
  });

  it("alerts again for the next pick after a previous alert", () => {
    expect(
      turnAlertAction({
        key: "draft_x:4",
        alertedKey: "draft_x:3",
        hidden: false,
      }),
    ).toBe("alert");
  });
});

describe("shouldNudgePropBets", () => {
  const eligible = {
    phase: "prop-bets",
    sawDrafting: true,
    alreadyNudged: false,
    isParticipant: true,
    hasSubmittedPropBets: false,
    narrow: true,
  };

  it("is true for a mobile participant who watched the draft finish live", () => {
    expect(shouldNudgePropBets(eligible)).toBe(true);
  });

  it("is false outside the prop-bets phase", () => {
    expect(shouldNudgePropBets({ ...eligible, phase: "drafting" })).toBe(false);
    expect(shouldNudgePropBets({ ...eligible, phase: "completed" })).toBe(
      false,
    );
  });

  it("is false on a late load that never saw drafting this visit", () => {
    expect(shouldNudgePropBets({ ...eligible, sawDrafting: false })).toBe(
      false,
    );
  });

  it("is false once the nudge already happened", () => {
    expect(shouldNudgePropBets({ ...eligible, alreadyNudged: true })).toBe(
      false,
    );
  });

  it("is false for spectators and non-participants", () => {
    expect(shouldNudgePropBets({ ...eligible, isParticipant: false })).toBe(
      false,
    );
  });

  it("is false when prop bets are already submitted", () => {
    expect(
      shouldNudgePropBets({ ...eligible, hasSubmittedPropBets: true }),
    ).toBe(false);
  });

  it("is false on wide viewports", () => {
    expect(shouldNudgePropBets({ ...eligible, narrow: false })).toBe(false);
  });
});
