import { describe, expect, it } from "vitest";
import {
  BOT_LOGIN,
  evaluateGate,
  judgePending,
  noticeComment,
  parseMarker,
  parseReviewers,
  recordedNoticeKeys,
  renderMarker,
  renderNoticeEmail,
  renderSyncPrBody,
  type GateInput,
  type SyncMarker,
  type SyncResult,
} from "../survivor-observer";

const REPO = "daviseford/grab-your-torch";
const HEAD = "1".repeat(40);
const OLD_HEAD = "2".repeat(40);
const UPSTREAM = "a".repeat(40);
const TREE = "b".repeat(40);

const marker: SyncMarker = {
  version: 1,
  season: 51,
  upstreamCommit: UPSTREAM,
  devJsonTree: TREE,
  episodes: [{ episodeNum: 2, status: "complete" }],
};

const sync: SyncResult = {
  changed: true,
  seasonNum: 51,
  isNewSeason: false,
  upstreamRef: UPSTREAM,
  newEpisodes: [
    {
      episodeNum: 2,
      status: "complete",
      reviewNotes: ["check idol finds"],
      counts: {},
    },
  ],
  summary: { episodes: 2, challenges: 4, eliminations: 2, events: 10 },
};

/** Every gate passing: a valid PR, green ci, and an approval at the head. */
function passing(overrides: Partial<GateInput> = {}): GateInput {
  return {
    repo: REPO,
    pr: {
      number: 300,
      state: "open",
      draft: false,
      baseRef: "main",
      headRef: "auto/survivor-sync-season-51",
      headSha: HEAD,
      headRepo: REPO,
      authorLogin: BOT_LOGIN,
      body: renderSyncPrBody(sync, marker),
      mergeable: true,
      url: `https://github.com/${REPO}/pull/300`,
    },
    files: ["src/data/season_51/index.ts"],
    checkRuns: [
      {
        id: 10,
        name: "ci",
        headSha: HEAD,
        status: "completed",
        conclusion: "success",
        appSlug: "github-actions",
      },
    ],
    reviews: [
      { id: 1, login: "daviseford", state: "APPROVED", commitId: HEAD },
    ],
    permissions: { daviseford: "admin" },
    allowedReviewers: ["daviseford"],
    currentDevJsonTree: TREE,
    sync,
    ...overrides,
  };
}

const withPr = (pr: Partial<GateInput["pr"]>) =>
  passing({ pr: { ...passing().pr, ...pr } });

describe("evaluateGate", () => {
  it("merges only when every gate passes, with a publishing notice", () => {
    const d = evaluateGate(passing());
    expect(d.action).toBe("merge");
    expect(d.headSha).toBe(HEAD);
    expect(d.notice?.key).toBe(`publishing:${HEAD}`);
  });

  describe("identity", () => {
    it.each([
      ["a new-season bootstrap", { headRef: "auto/survivor-new-season-52" }],
      ["a person's branch", { authorLogin: "daviseford" }],
      ["a fork", { headRepo: "someone/fork" }],
      ["another base", { baseRef: "stage" }],
      ["a closed pull request", { state: "closed" }],
    ])("never merges %s", (_, pr) => {
      expect(evaluateGate(withPr(pr)).action).toBe("ignore");
    });

    it("waits on a draft", () => {
      expect(evaluateGate(withPr({ draft: true })).action).toBe("wait");
    });
  });

  describe("completeness", () => {
    it("holds while survivoR has an unfinished newer episode", () => {
      const d = evaluateGate(
        passing({
          sync: { ...sync, changed: false, held: ["Episode 3: no rows"] },
        }),
      );
      expect(d.action).toBe("stale");
      expect(d.notice?.key).toBe(`held:${HEAD}`);
      expect(d.notice?.body).toContain("Episode 3: no rows");
    });

    it("blocks when this run's sync failed", () => {
      const d = evaluateGate(passing({ sync: { ...sync, error: "boom" } }));
      expect(d.action).toBe("blocked");
      expect(d.notice?.key).toBe(`blocked-sync:${HEAD}`);
    });

    it("is stale once survivoR's dev/json moves on", () => {
      const d = evaluateGate(passing({ currentDevJsonTree: "c".repeat(40) }));
      expect(d.action).toBe("stale");
    });

    it("is stale when the description came from another survivoR commit", () => {
      const d = evaluateGate(
        passing({ sync: { ...sync, upstreamRef: "d".repeat(40) } }),
      );
      expect(d.action).toBe("stale");
    });

    it("is stale without a valid marker", () => {
      expect(evaluateGate(withPr({ body: "edited by hand" })).action).toBe(
        "stale",
      );
      const other = renderMarker({ ...marker, season: 50 });
      expect(evaluateGate(withPr({ body: other })).action).toBe("stale");
    });

    it("blocks an episode the marker records as unfinished", () => {
      const body = renderMarker({
        ...marker,
        episodes: [{ episodeNum: 2, status: "partial" }],
      });
      expect(evaluateGate(withPr({ body })).action).toBe("blocked");
    });

    it("closes a pull request main already matches", () => {
      const d = evaluateGate(
        passing({ sync: { ...sync, changed: false, unchanged: true } }),
      );
      expect(d.action).toBe("obsolete");
    });

    it("never closes on a sync that compared nothing", () => {
      // e.g. a transient empty castaways read: changed false, no comparison.
      const d = evaluateGate(
        passing({
          sync: {
            changed: false,
            seasonNum: 51,
            isNewSeason: false,
            warnings: ["No castaways found in survivoR for season 51"],
          },
        }),
      );
      expect(d.action).toBe("wait");
    });

    it("ignores a pull request for a season this run did not sync", () => {
      const d = evaluateGate(passing({ sync: { ...sync, seasonNum: 52 } }));
      expect(d.action).toBe("ignore");
    });
  });

  describe("scope", () => {
    it("blocks a change outside the season's data directory", () => {
      const d = evaluateGate(
        passing({
          files: ["src/data/season_51/index.ts", ".github/workflows/ci.yml"],
        }),
      );
      expect(d.action).toBe("blocked");
      expect(d.reasons[0]).toContain(".github/workflows/ci.yml");
      expect(d.notice?.key).toBe(`blocked-scope:${HEAD}`);
    });

    it("blocks another season's files and an empty change", () => {
      expect(
        evaluateGate(passing({ files: ["src/data/season_50/index.ts"] }))
          .action,
      ).toBe("blocked");
      expect(evaluateGate(passing({ files: [] })).action).toBe("blocked");
    });

    it("is stale on a conflict with main", () => {
      expect(evaluateGate(withPr({ mergeable: false })).action).toBe("stale");
    });
  });

  describe("tests", () => {
    it("dispatches ci when the head has none", () => {
      expect(evaluateGate(passing({ checkRuns: [] })).action).toBe(
        "dispatch-ci",
      );
    });

    it("ignores ci on another commit or from another app", () => {
      const base = passing().checkRuns[0];
      for (const run of [
        { ...base, headSha: OLD_HEAD },
        { ...base, appSlug: "some-app" },
        { ...base, name: "ci-lite" },
      ]) {
        expect(evaluateGate(passing({ checkRuns: [run] })).action).toBe(
          "dispatch-ci",
        );
      }
    });

    it("waits for a running ci and blocks a failed one", () => {
      const base = passing().checkRuns[0];
      expect(
        evaluateGate(
          passing({
            checkRuns: [{ ...base, status: "in_progress", conclusion: null }],
          }),
        ).action,
      ).toBe("wait");
      const failed = evaluateGate(
        passing({ checkRuns: [{ ...base, conclusion: "failure" }] }),
      );
      expect(failed.action).toBe("blocked");
      expect(failed.notice?.key).toBe(`blocked-ci:${HEAD}`);
    });

    it("reads the newest ci run on the head", () => {
      const base = passing().checkRuns[0];
      const d = evaluateGate(
        passing({
          checkRuns: [
            { ...base, id: 11, conclusion: "failure" },
            { ...base, id: 12, conclusion: "success" },
          ],
        }),
      );
      expect(d.action).toBe("merge");
    });
  });

  describe("independent review", () => {
    it("waits, with a review notice, when nobody has approved", () => {
      const d = evaluateGate(passing({ reviews: [] }));
      expect(d.action).toBe("wait");
      expect(d.notice?.key).toBe(`review:${HEAD}`);
      expect(d.notice?.subject).toContain("Episode 2");
    });

    it("needs the approval on the exact head commit", () => {
      const d = evaluateGate(
        passing({
          reviews: [
            {
              id: 1,
              login: "daviseford",
              state: "APPROVED",
              commitId: OLD_HEAD,
            },
          ],
        }),
      );
      expect(d.action).toBe("wait");
    });

    it("needs a listed reviewer with write access", () => {
      expect(evaluateGate(passing({ allowedReviewers: [] })).action).toBe(
        "wait",
      );
      expect(
        evaluateGate(passing({ allowedReviewers: [] })).reasons[0],
      ).toMatch(/no reviewers are configured/);
      expect(
        evaluateGate(passing({ allowedReviewers: ["someone-else"] })).action,
      ).toBe("wait");
      expect(
        evaluateGate(passing({ permissions: { daviseford: "read" } })).action,
      ).toBe("blocked");
    });

    it("blocks, with a notice, an approval from a listed reviewer without write access", () => {
      const d = evaluateGate(passing({ permissions: { daviseford: "read" } }));
      expect(d.action).toBe("blocked");
      expect(d.notice?.key).toBe(`blocked-review:${HEAD}`);
    });

    it("never counts the bot's own approval", () => {
      const d = evaluateGate(
        passing({
          reviews: [
            { id: 1, login: BOT_LOGIN, state: "APPROVED", commitId: HEAD },
          ],
          allowedReviewers: [BOT_LOGIN],
          permissions: { [BOT_LOGIN]: "write" },
        }),
      );
      expect(d.action).toBe("wait");
    });

    it("waits while anyone's latest review requests changes", () => {
      const approved = passing().reviews[0];
      const d = evaluateGate(
        passing({
          reviews: [
            approved,
            {
              id: 2,
              login: "teammate",
              state: "CHANGES_REQUESTED",
              commitId: HEAD,
            },
          ],
        }),
      );
      expect(d.action).toBe("wait");
      expect(d.reasons[0]).toContain("teammate");
    });

    it("uses each reviewer's latest review, ignoring comments", () => {
      const d = evaluateGate(
        passing({
          reviews: [
            {
              id: 1,
              login: "daviseford",
              state: "CHANGES_REQUESTED",
              commitId: HEAD,
            },
            { id: 2, login: "daviseford", state: "APPROVED", commitId: HEAD },
            { id: 3, login: "daviseford", state: "COMMENTED", commitId: HEAD },
          ],
        }),
      );
      expect(d.action).toBe("merge");
      const dismissed = evaluateGate(
        passing({
          reviews: [
            { id: 1, login: "daviseford", state: "APPROVED", commitId: HEAD },
            { id: 2, login: "daviseford", state: "DISMISSED", commitId: HEAD },
          ],
        }),
      );
      expect(dismissed.action).toBe("wait");
    });

    it("matches reviewer logins case-insensitively", () => {
      expect(
        evaluateGate(passing({ allowedReviewers: ["DavisEford"] })).action,
      ).toBe("merge");
    });
  });
});

describe("marker", () => {
  it("round-trips through a pull request body", () => {
    expect(parseMarker(renderSyncPrBody(sync, marker))).toEqual(marker);
  });

  it("rejects malformed or foreign markers", () => {
    expect(parseMarker(null)).toBeNull();
    expect(parseMarker("no marker")).toBeNull();
    const body = renderMarker(marker);
    expect(parseMarker(body.replace(UPSTREAM, "nope"))).toBeNull();
    expect(parseMarker(body.replace('"version":1', '"version":2'))).toBeNull();
    expect(parseMarker(body.replace("{", "{{"))).toBeNull();
  });
});

describe("renderSyncPrBody", () => {
  it("says nothing is published and carries the reviewer notes", () => {
    const body = renderSyncPrBody(sync, marker);
    expect(body).toContain("Nothing is published yet");
    expect(body).toContain("Episode 2: check idol finds");
    expect(body).toContain("Adds Episode 2");
    expect(body).not.toContain("—");
  });

  it("tells a bootstrap apart: never merged automatically", () => {
    const body = renderSyncPrBody({ ...sync, isNewSeason: true }, marker);
    expect(body).toContain("never merges or publishes this");
  });
});

describe("notices", () => {
  it("records and recognises a delivered notice by key", () => {
    const notice = evaluateGate(passing({ reviews: [] })).notice!;
    const comment = noticeComment(notice);
    expect(recordedNoticeKeys([comment, "unrelated"])).toEqual(
      new Set([notice.key]),
    );
    // The fast path in the workflow finds a told head by its SHA.
    expect(comment).toContain(HEAD);
  });

  it("renders one email for several notices, and none for none", () => {
    expect(renderNoticeEmail([])).toBeNull();
    const a = evaluateGate(passing({ reviews: [] })).notice!;
    const b = evaluateGate(passing()).notice!;
    expect(renderNoticeEmail([a])?.subject).toBe(a.subject);
    const both = renderNoticeEmail([a, b], "https://run");
    expect(both?.subject).toBe("survivoR Observer: 2 updates");
    expect(both?.body).toContain("https://run");
  });
});

describe("parseReviewers", () => {
  it("accepts commas, spaces and @, and drops junk", () => {
    expect(parseReviewers(" @daviseford, teammate  bad/name ")).toEqual([
      "daviseford",
      "teammate",
    ]);
    expect(parseReviewers(undefined)).toEqual([]);
  });
});

describe("judgePending", () => {
  const merged = {
    number: 300,
    headRef: "auto/survivor-sync-season-51",
    headSha: HEAD,
    mergedAt: "2026-10-02T00:00:00Z",
    mergeSha: "e".repeat(40),
    mergedBy: BOT_LOGIN,
  };
  const recorded = [
    noticeComment({ key: `publishing:${HEAD}`, subject: "s", body: "b" }),
  ];

  it("publishes only what the observer merged after its publishing notice", () => {
    expect(judgePending(merged, recorded)).toEqual({
      kind: "publish",
      pr: 300,
      season: 51,
      mergeSha: "e".repeat(40),
    });
  });

  it("refuses a hand-labelled or hand-merged pull request", () => {
    expect(judgePending(merged, []).kind).toBe("reject");
    expect(
      judgePending(merged, [
        noticeComment({
          key: `publishing:${OLD_HEAD}`,
          subject: "s",
          body: "b",
        }),
      ]).kind,
    ).toBe("reject");
    expect(
      judgePending({ ...merged, mergedBy: "daviseford" }, recorded).kind,
    ).toBe("reject");
    expect(
      judgePending({ ...merged, headRef: "feat/other" }, recorded).kind,
    ).toBe("reject");
  });

  it("drops the label from a pull request that never merged", () => {
    expect(
      judgePending({ ...merged, mergedAt: null, mergeSha: null }, recorded)
        .kind,
    ).toBe("unlabel");
  });
});
