import fs from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  BOT_LOGIN,
  LABEL_PUBLISH_PENDING,
  noticeComment,
  renderSyncPrBody,
  type SyncResult,
} from "../lib/survivor-observer";
import { readUpstream, runGate, type GithubIo } from "../survivor-observer";

const REPO = "daviseford/grab-your-torch";
const UPSTREAM = "a".repeat(40);
const TREE = "b".repeat(40);
const HEAD = "1".repeat(40);

const sync: SyncResult = {
  changed: true,
  seasonNum: 51,
  isNewSeason: false,
  upstreamRef: UPSTREAM,
  newEpisodes: [
    { episodeNum: 2, status: "complete", reviewNotes: [], counts: {} },
  ],
};

const body = renderSyncPrBody(sync, {
  version: 1,
  season: 51,
  upstreamCommit: UPSTREAM,
  devJsonTree: TREE,
  episodes: [{ episodeNum: 2, status: "complete" }],
});

const pull = (overrides: object = {}) => ({
  number: 300,
  state: "open",
  draft: false,
  html_url: `https://github.com/${REPO}/pull/300`,
  body,
  mergeable: true,
  user: { login: BOT_LOGIN },
  base: { ref: "main" },
  head: {
    ref: "auto/survivor-sync-season-51",
    sha: HEAD,
    repo: { full_name: REPO },
  },
  ...overrides,
});

interface FakeState {
  reviews?: unknown[];
  comments?: unknown[];
  checkRuns?: unknown[];
  pending?: unknown[];
  pulls?: Record<number, unknown>;
}

/** A fake GitHub. Every path the gate reads must be listed here. */
function fakeIo(state: FakeState = {}): Pick<GithubIo, "get"> & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    get: async (apiPath) => {
      calls.push(apiPath);
      const p = apiPath.replace(/[?&]per_page=100&page=\d+$/, "");
      if (p === "/repos/doehm/survivoR/commits/master")
        return { sha: UPSTREAM };
      if (p === `/repos/doehm/survivoR/contents/dev?ref=${UPSTREAM}`) {
        return [
          { name: "json", type: "dir", sha: TREE },
          { name: "xlsx", type: "dir", sha: "c".repeat(40) },
        ];
      }
      if (p === `/repos/${REPO}/pulls?state=open&base=main`) {
        return [
          pull(),
          pull({
            number: 301,
            head: { ref: "feat/something", sha: HEAD, repo: null },
          }),
        ];
      }
      const single = p.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/);
      if (single) return state.pulls?.[Number(single[1])] ?? pull();
      if (p === `/repos/${REPO}/pulls/300/files`) {
        return [{ filename: "src/data/season_51/index.ts" }];
      }
      if (p === `/repos/${REPO}/commits/${HEAD}/check-runs?check_name=ci`) {
        return {
          check_runs: state.checkRuns ?? [
            {
              id: 1,
              name: "ci",
              head_sha: HEAD,
              status: "completed",
              conclusion: "success",
              app: { slug: "github-actions" },
            },
          ],
        };
      }
      if (p === `/repos/${REPO}/pulls/300/reviews`) return state.reviews ?? [];
      if (p === `/repos/${REPO}/collaborators/daviseford/permission`) {
        return { permission: "admin" };
      }
      if (p === `/repos/${REPO}/issues/300/comments`) {
        return state.comments ?? [];
      }
      if (
        p ===
        `/repos/${REPO}/issues?state=closed&labels=${LABEL_PUBLISH_PENDING}&sort=created&direction=asc`
      ) {
        return state.pending ?? [];
      }
      throw new Error(`unexpected GET ${apiPath}`);
    },
  };
}

describe("readUpstream", () => {
  it("resolves master and the dev/json tree", async () => {
    expect(await readUpstream(fakeIo())).toEqual({
      commit: UPSTREAM,
      devJsonTree: TREE,
    });
  });

  it("refuses a bad commit or a missing dev/json", async () => {
    await expect(
      readUpstream({ get: async () => ({ sha: "nope" }) }),
    ).rejects.toThrow(/Could not resolve/);
    await expect(
      readUpstream({
        get: async (p) => (p.includes("/commits/") ? { sha: UPSTREAM } : []),
      }),
    ).rejects.toThrow(/no dev\/json/);
  });
});

describe("runGate", () => {
  const approved = {
    id: 5,
    user: { login: "daviseford" },
    state: "APPROVED",
    commit_id: HEAD,
  };

  it("asks for review once, then stays quiet", async () => {
    const first = await runGate(fakeIo(), {
      repo: REPO,
      sync,
      reviewers: ["daviseford"],
    });
    expect(first.decisions).toHaveLength(1);
    expect(first.decisions[0].action).toBe("wait");
    expect(first.notices.map((n) => n.key)).toEqual([`review:${HEAD}`]);

    const again = await runGate(
      fakeIo({
        comments: [
          { body: noticeComment(first.notices[0]), user: { login: BOT_LOGIN } },
        ],
      }),
      { repo: REPO, sync, reviewers: ["daviseford"] },
    );
    expect(again.notices).toEqual([]);
  });

  it("does not trust a notice comment written by a person", async () => {
    const first = await runGate(fakeIo(), {
      repo: REPO,
      sync,
      reviewers: ["daviseford"],
    });
    const forged = await runGate(
      fakeIo({
        comments: [
          {
            body: noticeComment(first.notices[0]),
            user: { login: "someone" },
          },
        ],
      }),
      { repo: REPO, sync, reviewers: ["daviseford"] },
    );
    expect(forged.notices).toHaveLength(1);
  });

  it("merges an approved head and checks the approver's access", async () => {
    const io = fakeIo({ reviews: [approved] });
    const report = await runGate(io, {
      repo: REPO,
      sync,
      reviewers: ["daviseford"],
    });
    expect(report.decisions[0].action).toBe("merge");
    expect(report.notices.map((n) => n.key)).toEqual([`publishing:${HEAD}`]);
    expect(io.calls).toContain(
      `/repos/${REPO}/collaborators/daviseford/permission`,
    );
  });

  it("does not look up approvers who are not listed", async () => {
    const io = fakeIo({
      reviews: [{ ...approved, user: { login: "drive-by" } }],
    });
    const report = await runGate(io, {
      repo: REPO,
      sync,
      reviewers: ["daviseford"],
    });
    expect(report.decisions[0].action).toBe("wait");
    expect(io.calls.some((c) => c.includes("/permission"))).toBe(false);
  });

  it("lists merged pull requests still waiting to publish", async () => {
    const report = await runGate(
      fakeIo({
        pending: [
          { number: 290, pull_request: {} },
          { number: 291 }, // an issue, not a pull request
          { number: 292, pull_request: {} },
        ],
        pulls: {
          290: pull({
            number: 290,
            state: "closed",
            merged_at: "2026-10-01T00:00:00Z",
            merge_commit_sha: "e".repeat(40),
          }),
          292: pull({ number: 292, state: "closed", merged_at: null }),
        },
      }),
      { repo: REPO, sync, reviewers: ["daviseford"] },
    );
    expect(report.publish).toEqual([
      { pr: 290, season: 51, mergeSha: "e".repeat(40) },
    ]);
  });
});

/*
 * Wiring assertions are anchored to the step that consumes each value, so
 * deleting or inverting a guard turns a test red (see the radar tests).
 */
const readWorkflow = (name: string) =>
  fs.readFileSync(
    fileURLToPath(new URL(`../../.github/workflows/${name}`, import.meta.url)),
    "utf8",
  );

function stepOf(workflow: string) {
  return (name: string) => {
    const start = workflow.indexOf(`- name: ${name}`);
    expect(start, `step "${name}"`).toBeGreaterThan(-1);
    const next = workflow.indexOf("\n      - ", start + 1);
    return workflow.slice(start, next === -1 ? undefined : next);
  };
}

function jobOf(workflow: string, name: string) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `job "${name}"`).toBeGreaterThan(-1);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return workflow.slice(start, next === -1 ? undefined : start + 1 + next);
}

describe("survivor-observer workflow", () => {
  const workflow = readWorkflow("survivor-observer.yml");
  const step = stepOf(workflow);

  it("ticks every 30 minutes with one daily full run, and never on PRs", () => {
    expect(workflow).toMatch(
      /schedule:\s*\n\s*- cron: "7,37 \* \* \* \*"\s*\n\s*- cron: "0 14 \* \* \*"/,
    );
    expect(workflow).not.toMatch(/^\s*pull_request/m);
    expect(workflow).not.toMatch(/workflow_run/);
    expect(step("Decide whether anything needs a full run")).toContain(
      '[ "$SCHEDULE" != "0 14 * * *" ] || full "daily full run"',
    );
  });

  it("runs on a schedule only when the variable says shadow or live", () => {
    expect(jobOf(workflow, "tick")).toMatch(
      /if: >-\s*\n\s*github\.event_name == 'workflow_dispatch' \|\|\s*\n\s*vars\.SURVIVOR_OBSERVER == 'live' \|\|\s*\n\s*vars\.SURVIVOR_OBSERVER == 'shadow'/,
    );
    const mode = step("Resolve mode");
    expect(mode).toContain('if [ "$OBSERVER" != "live" ]; then');
    expect(mode).toContain("mode=shadow");
    expect(workflow).toMatch(/dry_run:[\s\S]{0,200}default: true/);
  });

  it("fails closed on missing configuration before observing", () => {
    const check = step("Check configuration");
    for (const name of [
      "SMTP_USERNAME",
      "SMTP_PASSWORD",
      "SURVIVOR_RADAR_EMAIL_TO",
      "SURVIVOR_SYNC_REVIEWERS",
      "FIREBASE_ADMIN_SERVICE_ACCOUNT",
    ]) {
      expect(check).toContain(`[ -n "$${name}" ]`);
    }
    expect(check).toContain("exit 1");
    expect(workflow.indexOf("- name: Check configuration")).toBeLessThan(
      workflow.indexOf("- name: Decide whether anything needs a full run"),
    );
  });

  it("takes the fast path only when nothing could have changed", () => {
    const fast = step("Decide whether anything needs a full run");
    // Any API failure means a full run, never a skip.
    expect(fast.match(/\|\| full "/g)!.length).toBeGreaterThanOrEqual(8);
    expect(fast).toContain('full "survivoR dev/json changed"');
    expect(fast).toContain('full "a merged sync is waiting to publish"');
    expect(fast).toContain("has no ci check on its head");
    expect(fast).toContain("has an approval on its head");
    expect(fast).toContain("has a ci result nobody was told about");
    expect(fast).toContain('"survivoR data radar state"');
    expect(jobOf(workflow, "observe")).toContain(
      "if: needs.tick.outputs.full == 'true'",
    );
  });

  it("pins one survivoR commit for the radar and the sync", () => {
    expect(step("Observe survivoR")).toContain('--commit "$COMMIT"');
    expect(step("Sync newest season")).toContain(
      'yarn tsx scripts/sync-season.ts --no-push --ref "$COMMIT"',
    );
  });

  it("keeps the radar's delivery and state rules", () => {
    for (const name of ["Send radar email", "Retry radar email"]) {
      const send = step(name);
      expect(send).toContain(
        "uses: dawidd6/action-send-mail@2cea9617b09d79a095af21254fbcb7ae95903dde",
      );
      expect(send).toContain("env.LIVE == 'true'");
      expect(send).toContain("steps.observe.outputs.action == 'alert'");
    }
    const record = step("Record radar state");
    expect(record).toContain("env.LIVE == 'true'");
    expect(record).toContain("steps.observe.outputs.action == 'baseline'");
    expect(record).toContain(
      "(steps.observe.outputs.action == 'unchanged' && steps.observe.outputs.advanced == 'true')",
    );
    expect(record).toMatch(
      /steps\.observe\.outputs\.action == 'alert' &&\s*\n?\s*\(steps\.email\.outcome == 'success' \|\| steps\.email_retry\.outcome == 'success'\)/,
    );
    expect(workflow).not.toMatch(/action-send-mail@v\d/);
  });

  it("never writes Firestore from the observe job", () => {
    const observe = jobOf(workflow, "observe");
    expect(observe).not.toContain("FIREBASE_ADMIN_SERVICE_ACCOUNT");
    expect(observe).not.toContain("publish-season");
    expect(observe).not.toMatch(/sync-season\.ts(?! --no-push)/);
  });

  it("opens pull requests but never merges them outside the gate", () => {
    const pr = step("Open or update the sync pull request");
    expect(pr).toContain("env.LIVE == 'true'");
    expect(pr).not.toContain("gh pr merge");
    expect(workflow.match(/gh pr merge/g)).toHaveLength(1);
    const merge = step("Merge approved sync pull requests");
    expect(merge).toContain("env.LIVE == 'true'");
    expect(merge).toContain('select(.action == "merge")');
    expect(merge).toContain('--match-head-commit "$sha"');
    expect(merge).toContain('[ "$DELIVERED" != "true" ]');
    // Label before merging, so a merge is never left untracked.
    expect(merge.indexOf("--add-label observer-publish-pending")).toBeLessThan(
      merge.indexOf("gh pr merge"),
    );
  });

  it("records notices only after delivery, and merges only after notifying", () => {
    expect(step("Record delivered notices")).toMatch(
      /steps\.notice\.outcome == 'success' \|\| steps\.notice_retry\.outcome == 'success'/,
    );
    expect(step("Merge approved sync pull requests")).toMatch(
      /steps\.gate\.outputs\.has_notice != 'true' \|\| steps\.notice\.outcome == 'success' \|\| steps\.notice_retry\.outcome == 'success'/,
    );
    expect(workflow.indexOf("- name: Retry observer email")).toBeLessThan(
      workflow.indexOf("- name: Merge approved sync pull requests"),
    );
  });

  it("publishes only from main, only in live mode, then redeploys and recomputes", () => {
    const publish = jobOf(workflow, "publish");
    expect(publish).toContain("needs.tick.outputs.mode == 'live'");
    expect(publish).toContain("ref: main");
    expect(publish).toContain('git merge-base --is-ancestor "$merge_sha" HEAD');
    expect(step("Publish to Firestore")).toContain(
      'yarn tsx scripts/publish-season.ts "$season"',
    );
    const downstream = step("Redeploy hosting and recompute standings");
    expect(downstream).toContain("if: steps.firestore.outcome == 'success'");
    expect(downstream).toContain("gh workflow run firebase-hosting-merge.yml");
    expect(downstream).toContain(
      'gh workflow run recompute-pool-standings.yml --ref main -f pool="$season"',
    );
    const labels = step("Record the publish result");
    expect(labels).toContain("--add-label observer-published");
    expect(labels).toContain("--add-label observer-publish-failed");
    expect(publish.indexOf("- name: Record the publish result")).toBeLessThan(
      publish.indexOf("- name: Send the result email"),
    );
  });

  it("never exposes a token to dependency install scripts", () => {
    for (const job of ["observe", "publish"]) {
      const text = jobOf(workflow, job);
      const head = text.slice(0, text.indexOf("steps:"));
      expect(head).not.toMatch(/GH_TOKEN|GITHUB_TOKEN/);
    }
  });

  it("never cancels a run mid-delivery or mid-publish", () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s*group: survivor-observer\s*\n\s*cancel-in-progress: false/,
    );
  });
});

describe("cutover from the old sync and radar", () => {
  it("the old sync stands down when live, and never publishes or merges", () => {
    const sync = readWorkflow("sync-survivor-data.yml");
    expect(sync).toContain("if: vars.SURVIVOR_OBSERVER != 'live'");
    // It checks out main, so only main may start it on a workflow edit.
    expect(sync).toMatch(/push:\s*\n\s*branches: \[main\]\s*\n\s*paths:/);
    expect(sync).toContain("yarn tsx scripts/sync-season.ts --no-push");
    expect(sync).not.toContain("gh pr merge");
    expect(sync).not.toContain("FIREBASE_ADMIN_SERVICE_ACCOUNT");
  });

  it("the old radar stands down when live", () => {
    const radar = readWorkflow("survivor-data-radar.yml");
    expect(radar).toMatch(/if: >-\s*\n\s*vars\.SURVIVOR_OBSERVER != 'live' &&/);
  });

  it("ci can be dispatched onto a sync branch and runs its full checks there", () => {
    const ci = readWorkflow("ci.yml");
    expect(ci).toMatch(/^ {2}workflow_dispatch:/m);
    expect(ci).not.toContain("github.event_name == 'push' ||");
    expect(ci.match(/github\.event_name != 'pull_request' \|\|/g)).toHaveLength(
      3,
    );
  });

  it("the standings recompute accepts a season from the observer", () => {
    const standings = readWorkflow("recompute-pool-standings.yml");
    expect(standings).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*pool:/);
  });
});
