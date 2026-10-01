/**
 * survivoR observer CLI, run by .github/workflows/survivor-observer.yml.
 *
 * Usage:
 *   yarn survivor-observer upstream --out <dir>
 *   yarn survivor-observer pr-body --result <file> --out <dir>
 *   yarn survivor-observer gate --result <file> --out <dir>
 *   yarn survivor-observer record-notices --out <dir>
 *   yarn survivor-observer publish-targets --out <dir>
 *
 * `upstream` resolves survivoR master to a commit and the git tree of its
 * dev/json, and writes upstream.json. The sync then reads every table at
 * that commit, so one run sees one consistent snapshot.
 *
 * `pr-body` renders the sync pull request description, with the marker the
 * gate later reads, from sync-result.json and upstream.json.
 *
 * `gate` evaluates every open observer sync pull request against
 * lib/survivor-observer.ts and writes gate.json, plus notice-subject.txt and
 * notice-body.md when there is something new to email. It also lists merged
 * pull requests still labelled for publishing. It changes nothing.
 *
 * `record-notices` records the notices of gate.json as pull request
 * comments. The workflow runs it only after the notice email was delivered,
 * so a notice is re-sent until it is (the same rule as the radar's state).
 *
 * `publish-targets` lists merged pull requests labelled for publishing and
 * judges each (lib/survivor-observer.ts judgePending): only one the observer
 * merged, after recording its "publishing" notice, may be published.
 *
 * GitHub access uses GITHUB_TOKEN and GITHUB_REPOSITORY.
 */

import fs from "fs";
import path from "path";
import {
  BOT_LOGIN,
  LABEL_PUBLISH_PENDING,
  OBSERVER_MARKER_VERSION,
  SYNC_BRANCH_PREFIX,
  evaluateGate,
  judgePending,
  noticeComment,
  parseReviewers,
  recordedNoticeKeys,
  renderNoticeEmail,
  renderSyncPrBody,
  type CheckRun,
  type GateDecision,
  type Notice,
  type PendingVerdict,
  type PullRequest,
  type Review,
  type SyncResult,
} from "./lib/survivor-observer.js";
import { isDirectRun } from "./survivor-radar.js";

const UPSTREAM = "doehm/survivoR";

export interface Upstream {
  commit: string;
  devJsonTree: string;
}

export interface GithubIo {
  get: (apiPath: string) => Promise<unknown>;
  post: (apiPath: string, body: unknown) => Promise<unknown>;
}

/** survivoR master's commit and the git tree SHA of its dev/json. */
export async function readUpstream(
  io: Pick<GithubIo, "get">,
  ref = "master",
): Promise<Upstream> {
  const head = (await io.get(`/repos/${UPSTREAM}/commits/${ref}`)) as {
    sha?: string;
  };
  if (!head.sha || !/^[0-9a-f]{40}$/.test(head.sha)) {
    throw new Error(`Could not resolve survivoR ${ref} to a commit`);
  }
  const listing = (await io.get(
    `/repos/${UPSTREAM}/contents/dev?ref=${head.sha}`,
  )) as { name: string; type: string; sha: string }[];
  const json = Array.isArray(listing)
    ? listing.find((e) => e.name === "json" && e.type === "dir")
    : undefined;
  if (!json?.sha || !/^[0-9a-f]{40}$/.test(json.sha)) {
    throw new Error("survivoR has no dev/json directory at that commit");
  }
  return { commit: head.sha, devJsonTree: json.sha };
}

async function listAll<T>(io: Pick<GithubIo, "get">, apiPath: string) {
  const out: T[] = [];
  const sep = apiPath.includes("?") ? "&" : "?";
  for (let page = 1; page <= 20; page++) {
    const rows = (await io.get(`${apiPath}${sep}per_page=100&page=${page}`)) as
      | T[]
      | { check_runs: T[] };
    const items = Array.isArray(rows) ? rows : rows.check_runs;
    if (!Array.isArray(items)) throw new Error(`${apiPath} is not a list`);
    out.push(...items);
    if (items.length < 100) return out;
  }
  throw new Error(`${apiPath} has more than 20 pages`);
}

interface ApiPull {
  number: number;
  state: string;
  draft: boolean;
  html_url: string;
  body: string | null;
  mergeable?: boolean | null;
  merge_commit_sha?: string | null;
  merged_at?: string | null;
  merged_by?: { login: string } | null;
  user: { login: string };
  base: { ref: string };
  head: { ref: string; sha: string; repo: { full_name: string } | null };
}

function toPullRequest(p: ApiPull): PullRequest {
  return {
    number: p.number,
    state: p.state,
    draft: p.draft,
    baseRef: p.base.ref,
    headRef: p.head.ref,
    headSha: p.head.sha,
    headRepo: p.head.repo?.full_name ?? "",
    authorLogin: p.user.login,
    body: p.body,
    mergeable: p.mergeable ?? null,
    url: p.html_url,
  };
}

export interface GateReport {
  upstream: Upstream;
  decisions: GateDecision[];
  /** Notices not yet recorded on their pull request, to email now. */
  notices: (Notice & { pr: number })[];
  /** Every closed pull request labelled for publishing, judged. */
  pending: PendingVerdict[];
  /** The pending ones the observer itself merged, oldest first. */
  publish: { pr: number; season: number; mergeSha: string }[];
}

export async function runGate(
  io: Pick<GithubIo, "get">,
  options: { repo: string; sync: SyncResult; reviewers: string[] },
): Promise<GateReport> {
  const { repo } = options;
  const upstream = await readUpstream(io);
  const open = (
    await listAll<ApiPull>(io, `/repos/${repo}/pulls?state=open&base=main`)
  ).filter((p) => p.head.ref.startsWith(SYNC_BRANCH_PREFIX));

  const decisions: GateDecision[] = [];
  const notices: GateReport["notices"] = [];
  for (const summary of open) {
    // The list endpoint omits `mergeable`; the single-PR endpoint has it.
    const full = (await io.get(
      `/repos/${repo}/pulls/${summary.number}`,
    )) as ApiPull;
    const pr = toPullRequest(full);
    const files = (
      await listAll<{ filename: string }>(
        io,
        `/repos/${repo}/pulls/${pr.number}/files`,
      )
    ).map((f) => f.filename);
    const checkRuns = (
      await listAll<{
        id: number;
        name: string;
        head_sha: string;
        status: string;
        conclusion: string | null;
        app: { slug: string } | null;
      }>(io, `/repos/${repo}/commits/${pr.headSha}/check-runs?check_name=ci`)
    ).map(
      (c): CheckRun => ({
        id: c.id,
        name: c.name,
        headSha: c.head_sha,
        status: c.status,
        conclusion: c.conclusion,
        appSlug: c.app?.slug ?? null,
      }),
    );
    const reviews = (
      await listAll<{
        id: number;
        user: { login: string } | null;
        state: string;
        commit_id: string;
      }>(io, `/repos/${repo}/pulls/${pr.number}/reviews`)
    ).map(
      (r): Review => ({
        id: r.id,
        login: r.user?.login ?? "",
        state: r.state,
        commitId: r.commit_id,
      }),
    );
    const permissions: Record<string, string> = {};
    for (const login of new Set(
      reviews
        .filter((r) => r.state === "APPROVED" && r.login)
        .map((r) => r.login),
    )) {
      if (
        !options.reviewers.some((l) => l.toLowerCase() === login.toLowerCase())
      )
        continue;
      const p = (await io.get(
        `/repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
      )) as { permission?: string };
      permissions[login] = p.permission ?? "";
    }
    const decision = evaluateGate({
      repo,
      pr,
      files,
      checkRuns,
      reviews,
      permissions,
      allowedReviewers: options.reviewers,
      currentDevJsonTree: upstream.devJsonTree,
      sync: options.sync,
    });
    decisions.push(decision);
    if (decision.notice) {
      const comments = await botComments(io, repo, pr.number);
      if (!recordedNoticeKeys(comments).has(decision.notice.key)) {
        notices.push({ ...decision.notice, pr: pr.number });
      }
    }
  }

  const pending = await readPending(io, repo);
  return {
    upstream,
    decisions,
    notices,
    pending,
    publish: publishable(pending),
  };
}

async function botComments(
  io: Pick<GithubIo, "get">,
  repo: string,
  pr: number,
): Promise<string[]> {
  return (
    await listAll<{ body: string; user: { login: string } | null }>(
      io,
      `/repos/${repo}/issues/${pr}/comments`,
    )
  )
    .filter((c) => c.user?.login === BOT_LOGIN)
    .map((c) => c.body);
}

/** Every closed pull request labelled for publishing, judged for provenance. */
export async function readPending(
  io: Pick<GithubIo, "get">,
  repo: string,
): Promise<PendingVerdict[]> {
  const labelled = (
    await listAll<{ number: number; pull_request?: unknown }>(
      io,
      `/repos/${repo}/issues?state=closed&labels=${LABEL_PUBLISH_PENDING}&sort=created&direction=asc`,
    )
  ).filter((i) => i.pull_request);
  const verdicts: PendingVerdict[] = [];
  for (const issue of labelled) {
    const p = (await io.get(`/repos/${repo}/pulls/${issue.number}`)) as ApiPull;
    verdicts.push(
      judgePending(
        {
          number: p.number,
          headRef: p.head.ref,
          headSha: p.head.sha,
          mergedAt: p.merged_at ?? null,
          mergeSha: p.merge_commit_sha ?? null,
          mergedBy: p.merged_by?.login ?? null,
        },
        await botComments(io, repo, p.number),
      ),
    );
  }
  return verdicts;
}

const publishable = (verdicts: PendingVerdict[]): GateReport["publish"] =>
  verdicts.flatMap((v) =>
    v.kind === "publish"
      ? [{ pr: v.pr, season: v.season, mergeSha: v.mergeSha }]
      : [],
  );

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(file, "utf8")) as T;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "grab-your-torch-survivor-observer",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function request(method: string, apiPath: string, body?: unknown) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: githubHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `GitHub ${method} ${apiPath}: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

const liveIo: GithubIo = {
  get: (apiPath) => request("GET", apiPath),
  post: (apiPath, body) => request("POST", apiPath, body),
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const out = argValue(args, "--out");
  if (!out) {
    throw new Error(
      "Usage: survivor-observer upstream|pr-body|gate|record-notices --out <dir> [--result <file>]",
    );
  }
  fs.mkdirSync(out, { recursive: true });
  const repo = process.env.GITHUB_REPOSITORY;

  if (command === "upstream") {
    const upstream = await readUpstream(liveIo);
    fs.writeFileSync(
      path.join(out, "upstream.json"),
      `${JSON.stringify(upstream)}\n`,
    );
    console.log(`survivoR commit ${upstream.commit}`);
    console.log(`dev/json tree ${upstream.devJsonTree}`);
    return;
  }

  if (command === "pr-body") {
    const result = readJson<SyncResult>(argValue(args, "--result") ?? "");
    const upstream = readJson<Upstream>(path.join(out, "upstream.json"));
    if (result.upstreamRef !== upstream.commit) {
      throw new Error(
        "sync-result.json was not read at upstream.json's commit",
      );
    }
    const body = renderSyncPrBody(
      result,
      {
        version: OBSERVER_MARKER_VERSION,
        season: result.seasonNum,
        upstreamCommit: upstream.commit,
        devJsonTree: upstream.devJsonTree,
        episodes: (result.newEpisodes ?? []).map((e) => ({
          episodeNum: e.episodeNum,
          status: e.status,
        })),
      },
      { runUrl: process.env.RUN_URL },
    );
    fs.writeFileSync(path.join(out, "pr-body.md"), body);
    return;
  }

  if (command === "gate") {
    if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
    const resultFile = argValue(args, "--result");
    const sync: SyncResult =
      resultFile && fs.existsSync(resultFile)
        ? readJson<SyncResult>(resultFile)
        : {
            changed: false,
            seasonNum: 0,
            isNewSeason: false,
            error: "sync-result.json not found",
          };
    const report = await runGate(liveIo, {
      repo,
      sync,
      reviewers: parseReviewers(process.env.SURVIVOR_SYNC_REVIEWERS),
    });
    fs.writeFileSync(
      path.join(out, "gate.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    for (const name of ["notice-subject.txt", "notice-body.md"]) {
      fs.rmSync(path.join(out, name), { force: true });
    }
    const email = renderNoticeEmail(report.notices, process.env.RUN_URL);
    if (email) {
      fs.writeFileSync(
        path.join(out, "notice-subject.txt"),
        `${email.subject}\n`,
      );
      fs.writeFileSync(path.join(out, "notice-body.md"), email.body);
    }
    for (const d of report.decisions) {
      console.log(`PR #${d.pr} (${d.headSha.slice(0, 7)}): ${d.action}`);
      for (const r of d.reasons) console.log(`  - ${r}`);
    }
    for (const p of report.publish) {
      console.log(`Publish pending: PR #${p.pr}, season ${p.season}`);
    }
    return;
  }

  if (command === "publish-targets") {
    if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
    const pending = await readPending(liveIo, repo);
    fs.writeFileSync(
      path.join(out, "publish-targets.json"),
      `${JSON.stringify({ pending, publish: publishable(pending) }, null, 2)}
`,
    );
    for (const v of pending) {
      console.log(
        `PR #${v.pr}: ${v.kind}${"reason" in v ? ` (${v.reason})` : ""}`,
      );
    }
    return;
  }

  if (command === "record-notices") {
    if (!repo) throw new Error("GITHUB_REPOSITORY is not set");
    const report = readJson<GateReport>(path.join(out, "gate.json"));
    for (const notice of report.notices) {
      await liveIo.post(`/repos/${repo}/issues/${notice.pr}/comments`, {
        body: noticeComment(notice),
      });
      console.log(`Recorded ${notice.key} on PR #${notice.pr}`);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("survivoR observer failed:", err);
      process.exit(1);
    });
}
