import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RADAR_ISSUE_TITLE, renderIssueBody } from "../lib/survivor-radar";
import {
  findManagedIssue,
  runObserve,
  runRecord,
  type GithubWriter,
  type RadarIo,
} from "../survivor-radar";

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const REPO = "daviseford/grab-your-torch";

const S51_EP1 = { version: "US", season: 51, episode: 1, title: "One" };
const S51_EP2 = { version: "US", season: 51, episode: 2, title: "Two" };

/** A fake survivoR + GitHub: `tables` per commit, `issues` for the repo. */
function fakeIo(
  commit: string,
  tables: Record<string, unknown[]>,
  issues: unknown[] = [],
): RadarIo {
  return {
    githubGet: async (apiPath) => {
      if (apiPath === "/repos/doehm/survivoR/commits/master") {
        return { sha: commit };
      }
      if (apiPath.startsWith("/repos/doehm/survivoR/contents/dev/json")) {
        expect(apiPath).toContain(`ref=${commit}`);
        return [
          ...Object.keys(tables).map((t) => ({
            name: `${t}.json`,
            type: "file",
          })),
          { name: "README.md", type: "file" },
        ];
      }
      if (apiPath.startsWith(`/repos/${REPO}/issues`)) return issues;
      throw new Error(`unexpected GET ${apiPath}`);
    },
    fetchRaw: async (atCommit, filePath) => {
      expect(atCommit).toBe(commit);
      const table = path.basename(filePath, ".json");
      return JSON.stringify(tables[table]);
    },
  };
}

const managedIssue = (body: string, overrides: object = {}) => ({
  number: 7,
  html_url: `https://github.com/${REPO}/issues/7`,
  title: RADAR_ISSUE_TITLE,
  body,
  user: { login: "github-actions[bot]" },
  ...overrides,
});

describe("survivor radar commands", () => {
  let out: string;
  beforeEach(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), "survivor-radar-"));
  });
  afterEach(() => fs.rmSync(out, { recursive: true, force: true }));

  const read = (name: string) => fs.readFileSync(path.join(out, name), "utf8");
  const exists = (name: string) => fs.existsSync(path.join(out, name));

  /** Run observe at COMMIT_A, then return the issue body `record` would write. */
  async function baselineBody(tables: Record<string, unknown[]>) {
    await runObserve(fakeIo(COMMIT_A, tables), { out, repo: REPO });
    let written = "";
    await runRecord(
      {
        createIssue: async (_repo, _title, body) => ((written = body), "url"),
        updateIssue: async () => {
          throw new Error("no issue yet");
        },
      },
      { out, repo: REPO },
    );
    return written;
  }

  it("baselines on the first run with no email text, and creates the issue", async () => {
    const decision = await runObserve(
      fakeIo(COMMIT_A, { episodes: [S51_EP1] }),
      {
        out,
        repo: REPO,
      },
    );
    expect(decision.action).toBe("baseline");
    expect(exists("subject.txt")).toBe(false);
    expect(exists("body.md")).toBe(false);
    expect(JSON.parse(read("issue.json"))).toBeNull();

    const calls: string[] = [];
    const writer: GithubWriter = {
      createIssue: async (repo, title) => (
        calls.push(`create ${repo} ${title}`),
        "u"
      ),
      updateIssue: async () => (calls.push("update"), "u"),
    };
    await runRecord(writer, { out, repo: REPO });
    expect(calls).toEqual([`create ${REPO} ${RADAR_ISSUE_TITLE}`]);
  });

  it("stays silent on a re-run of the same data at a newer commit", async () => {
    const body = await baselineBody({ episodes: [S51_EP1] });
    const decision = await runObserve(
      fakeIo(COMMIT_B, { episodes: [S51_EP1] }, [managedIssue(body)]),
      { out, repo: REPO },
    );
    expect(decision.action).toBe("unchanged");
    expect(exists("subject.txt")).toBe(false);
  });

  it("alerts on a new episode and updates the existing issue", async () => {
    const body = await baselineBody({ episodes: [S51_EP1] });
    const decision = await runObserve(
      fakeIo(COMMIT_B, { episodes: [S51_EP1, S51_EP2] }, [managedIssue(body)]),
      { out, repo: REPO, runUrl: "https://run" },
    );
    expect(decision.action).toBe("alert");
    expect(read("subject.txt")).toContain("Season 51");
    expect(read("body.md")).toContain("`episodes`: 1 row to 2 rows");
    expect(read("body.md")).toContain(`issues/7`);

    const calls: string[] = [];
    await runRecord(
      {
        createIssue: async () => (calls.push("create"), "u"),
        updateIssue: async (_repo, n, newBody) => {
          calls.push(`update ${n}`);
          expect(newBody).toContain(COMMIT_B);
          return "u";
        },
      },
      { out, repo: REPO },
    );
    expect(calls).toEqual(["update 7"]);
  });

  it("clears stale email text when a re-run decides not to alert", async () => {
    fs.writeFileSync(path.join(out, "subject.txt"), "stale");
    fs.writeFileSync(path.join(out, "body.md"), "stale");
    await runObserve(fakeIo(COMMIT_A, { episodes: [S51_EP1] }), {
      out,
      repo: REPO,
    });
    expect(exists("subject.txt")).toBe(false);
    expect(exists("body.md")).toBe(false);
  });

  it("ignores look-alike issues not created by the workflow bot", async () => {
    const io = fakeIo(COMMIT_A, {}, [
      managedIssue("x", { user: { login: "someone" } }),
      managedIssue("x", { pull_request: {} }),
      managedIssue("x", { title: "other" }),
    ]);
    expect(await findManagedIssue(io, REPO)).toBeNull();
  });

  it("reads past a full page of other issues to find the managed one", async () => {
    const others = Array.from({ length: 100 }, (_, i) =>
      managedIssue("x", { number: i + 100, title: `issue ${i}` }),
    );
    const pages: string[] = [];
    const found = await findManagedIssue(
      {
        githubGet: async (apiPath) => {
          pages.push(apiPath);
          return apiPath.endsWith("page=1") ? others : [managedIssue("state")];
        },
      },
      REPO,
    );
    expect(found).toMatchObject({ number: 7, body: "state" });
    expect(pages).toHaveLength(2);
    expect(pages[0]).not.toContain("creator=");
  });

  it("refuses an empty upstream listing instead of reporting every table removed", async () => {
    await expect(
      runObserve(fakeIo(COMMIT_A, {}), { out, repo: REPO }),
    ).rejects.toThrow(/lists no JSON tables/);
    expect(exists("decision.json")).toBe(false);
  });

  it("compares against a local state file when given one", async () => {
    const stateFile = path.join(out, "prev.json");
    await runObserve(fakeIo(COMMIT_A, { episodes: [S51_EP1] }), {
      out,
      stateFile,
    });
    fs.copyFileSync(path.join(out, "next-state.json"), stateFile);
    const decision = await runObserve(
      fakeIo(COMMIT_B, { episodes: [S51_EP1, S51_EP2] }),
      { out, stateFile },
    );
    expect(decision.action).toBe("alert");
    // The issue body stays parseable for the same state.
    expect(renderIssueBody(JSON.parse(read("next-state.json")))).toContain(
      COMMIT_B,
    );
  });
});

/*
 * Wiring assertions are anchored to the step that consumes each value, so
 * deleting or inverting a guard turns a test red. A bare toContain against the
 * whole file would stay green on a mention anywhere (see the AoS Rules Radar
 * learning on decorative workflow assertions).
 */
describe("survivor-data-radar workflow", () => {
  const workflow = fs.readFileSync(
    fileURLToPath(
      new URL(
        "../../.github/workflows/survivor-data-radar.yml",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const step = (name: string) => {
    const start = workflow.indexOf(`- name: ${name}`);
    expect(start, `step "${name}"`).toBeGreaterThan(-1);
    const next = workflow.indexOf("\n      - ", start + 1);
    return workflow.slice(start, next === -1 ? undefined : next);
  };

  it("adds no schedule and follows the existing sync on main", () => {
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).toMatch(
      /workflow_run:\s*\n\s*workflows: \["Sync survivoR data"\]\s*\n\s*types: \[completed\]\s*\n\s*branches: \[main\]/,
    );
    expect(workflow).not.toMatch(/^\s*pull_request/m);
  });

  it("only runs the trigger once activated", () => {
    expect(workflow).toMatch(
      /if: >-\s*\n\s*github\.event_name == 'workflow_dispatch' \|\|\s*\n\s*vars\.SURVIVOR_DATA_RADAR == 'enabled'/,
    );
  });

  it("fails closed on missing email configuration before observing", () => {
    const check = step("Check email configuration");
    expect(check).toContain("if: env.LIVE == 'true'");
    expect(check).toContain("exit 1");
    for (const name of [
      "SMTP_USERNAME",
      "SMTP_PASSWORD",
      "SURVIVOR_RADAR_EMAIL_TO",
    ]) {
      expect(check).toContain(`[ -n "$${name}" ]`);
    }
    expect(workflow.indexOf("- name: Check email configuration")).toBeLessThan(
      workflow.indexOf("- name: Observe survivoR"),
    );
  });

  it("sends through a pinned action, with one retry", () => {
    for (const name of ["Send radar email", "Retry radar email"]) {
      const send = step(name);
      expect(send).toContain(
        "uses: dawidd6/action-send-mail@2cea9617b09d79a095af21254fbcb7ae95903dde",
      );
      expect(send).toContain("to: ${{ vars.SURVIVOR_RADAR_EMAIL_TO }}");
      expect(send).toContain("steps.observe.outputs.action == 'alert'");
      expect(send).toContain("env.LIVE == 'true'");
    }
    expect(step("Retry radar email")).toContain(
      "steps.email.outcome == 'failure'",
    );
    expect(workflow).not.toMatch(/action-send-mail@v\d/);
  });

  it("records state only for a baseline or a delivered email", () => {
    const record = step("Record radar state");
    expect(record).toContain("env.LIVE == 'true'");
    expect(record).toContain("steps.observe.outputs.action == 'baseline'");
    expect(record).toMatch(
      /steps\.observe\.outputs\.action == 'alert' &&\s*\n?\s*\(steps\.email\.outcome == 'success' \|\| steps\.email_retry\.outcome == 'success'\)/,
    );
    expect(record).toContain("yarn survivor-radar record");
    expect(workflow.indexOf("- name: Record radar state")).toBeGreaterThan(
      workflow.indexOf("- name: Retry radar email"),
    );
  });

  it("goes red when the email could not be delivered", () => {
    const fail = step("Fail on undelivered email");
    expect(fail).toContain("steps.email.outcome != 'success'");
    expect(fail).toContain("steps.email_retry.outcome != 'success'");
    expect(fail).toContain("exit 1");
  });

  it("is a dry run by default when dispatched by hand", () => {
    expect(workflow).toMatch(/dry_run:[\s\S]{0,200}default: true/);
    expect(workflow).toContain(
      "LIVE: ${{ github.event_name == 'workflow_run' || inputs.dry_run == false }}",
    );
  });

  it("never cancels a run mid-delivery", () => {
    expect(workflow).toMatch(
      /concurrency:\s*\n\s*group: survivor-data-radar\s*\n\s*cancel-in-progress: false/,
    );
  });
});
