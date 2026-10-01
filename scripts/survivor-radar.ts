/**
 * survivoR data radar: email when the upstream survivoR dataset changes.
 *
 * Usage:
 *   yarn survivor-radar observe --out <dir> [--state-file <file>] [--commit <sha>]
 *   yarn survivor-radar record --out <dir>
 *
 * `observe` reads every table in survivoR's dev/json at the current master
 * commit, fingerprints the US records (see scripts/lib/survivor-radar.ts),
 * compares them with the state stored in the managed GitHub issue, and writes
 * decision.json, next-state.json, issue.json and, for an alert, subject.txt
 * and body.md into <dir>. It never writes anywhere else.
 *
 * `record` writes next-state.json into the managed issue (creating it on the
 * first baseline). The workflow runs it only for a baseline, or after the
 * alert email was delivered, so the state never moves past an unsent change.
 *
 * GitHub access uses GITHUB_TOKEN and GITHUB_REPOSITORY. Locally, pass
 * --state-file to compare against a state file instead of the issue.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import {
  RADAR_ISSUE_TITLE,
  RADAR_SCOPE,
  RADAR_STATE_VERSION,
  decide,
  fingerprintTable,
  isTableName,
  parseIssueBody,
  renderBody,
  renderIssueBody,
  renderSubject,
  type RadarState,
  type RadarTables,
} from "./lib/survivor-radar.js";

const UPSTREAM = "doehm/survivoR";
const UPSTREAM_BRANCH = "master";
const UPSTREAM_DIR = "dev/json";
const BOT_LOGIN = "github-actions[bot]";

export interface ManagedIssue {
  number: number;
  url: string;
  body: string | null;
}

export interface RadarIo {
  /** GET a GitHub REST path (e.g. `/repos/o/r/commits/x`) and parse JSON. */
  githubGet: (apiPath: string) => Promise<unknown>;
  /** Raw file text from survivoR at a commit. */
  fetchRaw: (commit: string, filePath: string) => Promise<string>;
}

/**
 * Resolve survivoR master (or a pinned commit) to a commit, then fingerprint
 * every table there. The survivoR observer pins the commit its sync reads, so
 * the radar state never records a commit the sync has not seen.
 */
export async function observeUpstream(
  io: RadarIo,
  now: Date = new Date(),
  ref: string = UPSTREAM_BRANCH,
): Promise<RadarState> {
  const head = (await io.githubGet(`/repos/${UPSTREAM}/commits/${ref}`)) as {
    sha?: string;
  };
  if (!head.sha || !/^[0-9a-f]{40}$/.test(head.sha)) {
    throw new Error(`Could not resolve the survivoR ${ref} commit`);
  }
  if (ref !== UPSTREAM_BRANCH && head.sha !== ref) {
    throw new Error(`survivoR resolved ${ref} to a different commit`);
  }
  const listing = (await io.githubGet(
    `/repos/${UPSTREAM}/contents/${UPSTREAM_DIR}?ref=${head.sha}`,
  )) as { name: string; type: string }[];
  if (!Array.isArray(listing)) {
    throw new Error("survivoR dev/json listing is not an array");
  }
  const tables = listing
    .filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/, ""))
    .sort();
  if (!tables.length) {
    // An empty listing is far likelier an upstream reorganisation or a bad
    // response than a dataset that vanished; refuse rather than alert.
    throw new Error("survivoR dev/json lists no JSON tables");
  }
  const fingerprints: RadarTables = {};
  for (const table of tables) {
    if (!isTableName(table)) {
      throw new Error(`Unexpected survivoR table name: ${table}`);
    }
    const text = await io.fetchRaw(head.sha, `${UPSTREAM_DIR}/${table}.json`);
    fingerprints[table] = fingerprintTable(table, JSON.parse(text));
  }
  return {
    version: RADAR_STATE_VERSION,
    scope: RADAR_SCOPE,
    commit: head.sha,
    observedAt: now.toISOString(),
    tables: fingerprints,
  };
}

const MAX_ISSUE_PAGES = 100;

/**
 * The bot-created issue with the radar title, oldest first if several.
 * Filters by author client-side and reads every page: a missed issue would
 * look like "no state" and silently re-baseline past a change, so running
 * out of pages throws instead of returning null.
 */
export async function findManagedIssue(
  io: Pick<RadarIo, "githubGet">,
  repo: string,
): Promise<ManagedIssue | null> {
  for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
    const issues = (await io.githubGet(
      `/repos/${repo}/issues?state=all&per_page=100&sort=created&direction=asc&page=${page}`,
    )) as {
      number: number;
      html_url: string;
      title: string;
      body: string | null;
      pull_request?: unknown;
      user?: { login?: string };
    }[];
    if (!Array.isArray(issues)) {
      throw new Error(`Issue listing for ${repo} is not an array`);
    }
    const match = issues.find(
      (issue) =>
        !issue.pull_request &&
        issue.title === RADAR_ISSUE_TITLE &&
        issue.user?.login === BOT_LOGIN,
    );
    if (match) {
      return { number: match.number, url: match.html_url, body: match.body };
    }
    if (issues.length < 100) return null;
  }
  throw new Error(
    `No radar issue in the first ${MAX_ISSUE_PAGES} pages of ${repo} issues`,
  );
}

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(file, "utf8")) as T;

const writeFile = (dir: string, name: string, content: string) =>
  fs.writeFileSync(path.join(dir, name), content);

export interface ObserveOptions {
  out: string;
  repo?: string;
  stateFile?: string;
  runUrl?: string;
  /** Read survivoR at this commit instead of master. */
  commit?: string;
}

/** Observe, decide, and write the decision artifacts into `out`. */
export async function runObserve(io: RadarIo, options: ObserveOptions) {
  fs.mkdirSync(options.out, { recursive: true });
  // A rerun reuses the directory: clear the alert text so a stale email can
  // never be mailed beside a newer non-alert decision.
  for (const name of ["subject.txt", "body.md"]) {
    fs.rmSync(path.join(options.out, name), { force: true });
  }

  let issue: ManagedIssue | null = null;
  let previous: RadarState | null;
  if (options.stateFile) {
    previous = fs.existsSync(options.stateFile)
      ? readJson<RadarState>(options.stateFile)
      : null;
  } else {
    if (!options.repo) throw new Error("GITHUB_REPOSITORY is not set");
    issue = await findManagedIssue(io, options.repo);
    // Only a missing issue baselines; an existing one must parse.
    previous = issue ? parseIssueBody(issue.body) : null;
  }

  const current = await observeUpstream(io, new Date(), options.commit);
  const decision = decide(previous, current);

  writeFile(
    options.out,
    "decision.json",
    `${JSON.stringify(decision, null, 2)}\n`,
  );
  writeFile(options.out, "next-state.json", `${JSON.stringify(current)}\n`);
  writeFile(
    options.out,
    "issue.json",
    `${JSON.stringify(issue && { number: issue.number, url: issue.url })}\n`,
  );
  if (decision.action === "alert") {
    writeFile(options.out, "subject.txt", `${renderSubject(decision)}\n`);
    writeFile(
      options.out,
      "body.md",
      renderBody(decision, { runUrl: options.runUrl, issueUrl: issue?.url }),
    );
  }
  return decision;
}

export interface GithubWriter {
  createIssue: (repo: string, title: string, body: string) => Promise<string>;
  updateIssue: (
    repo: string,
    issueNumber: number,
    body: string,
  ) => Promise<string>;
}

/** Write next-state.json into the managed issue. */
export async function runRecord(
  writer: GithubWriter,
  options: { out: string; repo?: string },
): Promise<string> {
  if (!options.repo) throw new Error("GITHUB_REPOSITORY is not set");
  const state = readJson<RadarState>(path.join(options.out, "next-state.json"));
  const issue = readJson<{ number: number } | null>(
    path.join(options.out, "issue.json"),
  );
  const body = renderIssueBody(state);
  return issue
    ? writer.updateIssue(options.repo, issue.number, body)
    : writer.createIssue(options.repo, RADAR_ISSUE_TITLE, body);
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "grab-your-torch-survivor-radar",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function githubRequest(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<unknown> {
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

const liveIo: RadarIo = {
  githubGet: (apiPath) => githubRequest("GET", apiPath),
  fetchRaw: async (commit, filePath) => {
    const url = `https://raw.githubusercontent.com/${UPSTREAM}/${commit}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${res.status} ${res.statusText}`,
      );
    }
    return res.text();
  },
};

const liveWriter: GithubWriter = {
  createIssue: async (repo, title, body) => {
    const issue = (await githubRequest("POST", `/repos/${repo}/issues`, {
      title,
      body,
    })) as { html_url: string };
    return issue.html_url;
  },
  updateIssue: async (repo, issueNumber, body) => {
    const issue = (await githubRequest(
      "PATCH",
      `/repos/${repo}/issues/${issueNumber}`,
      { body },
    )) as { html_url: string };
    return issue.html_url;
  },
};

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const out = argValue(args, "--out");
  if (!out || (command !== "observe" && command !== "record")) {
    throw new Error(
      "Usage: survivor-radar observe --out <dir> [--state-file <file>] [--commit <sha>] | record --out <dir>",
    );
  }
  const repo = process.env.GITHUB_REPOSITORY;
  if (command === "observe") {
    const decision = await runObserve(liveIo, {
      out,
      repo,
      stateFile: argValue(args, "--state-file"),
      commit: argValue(args, "--commit"),
      runUrl: process.env.RUN_URL,
    });
    console.log(`Radar decision: ${decision.action} (${decision.reason})`);
    console.log(`survivoR commit: ${decision.commit}`);
    for (const change of decision.changes) {
      console.log(`  ${change.kind}: ${change.table} / ${change.group}`);
    }
  } else {
    const url = await runRecord(liveWriter, { out, repo });
    console.log(`Radar state recorded: ${url}`);
  }
}

/** See scripts/recompute-castaway-adp.ts for why this uses pathToFileURL. */
export const isDirectRun = (
  moduleUrl: string,
  entryPath: string | undefined,
): boolean => !!entryPath && moduleUrl === pathToFileURL(entryPath).href;

if (isDirectRun(import.meta.url, process.argv[1])) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("survivoR radar failed:", err);
      process.exit(1);
    });
}
