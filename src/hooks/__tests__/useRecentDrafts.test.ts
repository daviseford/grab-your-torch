import { describe, expect, it } from "vitest";
import type { Draft, SlimUser } from "../../types";
import type { RecentDraftRecord } from "../../utils/recentDrafts";
import { buildRecentDraftForUser } from "../useRecentDrafts";

const user = (uid: string): SlimUser => ({
  uid,
  email: `${uid}@example.com`,
  displayName: uid,
  isAdmin: false,
});

const USER_A = user("uid_a");
const USER_B = user("uid_b");

const record: RecentDraftRecord = {
  draftId: "draft_1",
  seasonId: "season_48",
  seasonNum: 48,
  visitedAt: 100,
};

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: "draft_1",
  season_id: "season_48",
  season_num: 48,
  competiton_id: "competition_1",
  creator_uid: USER_A.uid,
  participants: [USER_A],
  total_players: 18,
  current_pick_number: 0,
  current_picker: null,
  pick_order: [],
  draft_picks: [],
  prop_bets: [],
  started: false,
  finished: false,
  ...overrides,
});

describe("buildRecentDraftForUser", () => {
  it("does not expose a stored draft to a different signed-in user", () => {
    expect(
      buildRecentDraftForUser(draft(), record, USER_B.uid),
    ).toBeUndefined();
  });

  it("does not expose finished or deleted drafts", () => {
    expect(
      buildRecentDraftForUser(draft({ finished: true }), record, USER_A.uid),
    ).toBeUndefined();
    expect(
      buildRecentDraftForUser(undefined, record, USER_A.uid),
    ).toBeUndefined();
  });

  it("returns lobby status and the resume URL for a participant", () => {
    expect(buildRecentDraftForUser(draft(), record, USER_A.uid)).toMatchObject({
      url: "/seasons/season_48/draft/draft_1",
      status: "lobby",
      visitedAt: 100,
    });
  });

  it("distinguishes the current user's turn from another participant's", () => {
    expect(
      buildRecentDraftForUser(
        draft({ started: true, current_picker: USER_A }),
        record,
        USER_A.uid,
      )?.status,
    ).toBe("your-turn");
    expect(
      buildRecentDraftForUser(
        draft({
          started: true,
          participants: [USER_A, USER_B],
          current_picker: USER_B,
        }),
        record,
        USER_A.uid,
      )?.status,
    ).toBe("in-progress");
  });
});
