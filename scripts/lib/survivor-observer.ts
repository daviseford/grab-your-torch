/**
 * survivoR observer: the decisions behind
 * `.github/workflows/survivor-observer.yml`, kept free of I/O so each one is
 * unit tested.
 *
 * The observer imports a season sync through a pull request and publishes it
 * only after every gate below passes on the pull request's exact head commit:
 *
 * 1. Completeness: the sync run that wrote the head found every new episode
 *    complete (lib/episode-readiness.ts) at a pinned survivoR commit, and
 *    survivoR's dev/json has not changed since.
 * 2. Scope: the pull request is the bot's own sync branch and changes only
 *    that season's data directory.
 * 3. Tests: the required `ci` check ran on the head commit and passed.
 * 4. Independent review: a person listed in SURVIVOR_SYNC_REVIEWERS, with
 *    write access, approved the head commit, and nobody has requested
 *    changes since. Automation cannot supply this. With no approval the pull
 *    request waits, however long that takes.
 *
 * Anything short of that leaves the pull request open and production
 * untouched; the next run re-evaluates from scratch.
 */

export const SYNC_BRANCH_PREFIX = "auto/survivor-sync-season-";
export const BOT_LOGIN = "github-actions[bot]";
export const CI_CHECK_NAME = "ci";
export const CI_APP_SLUG = "github-actions";

export const LABEL_PUBLISH_PENDING = "observer-publish-pending";
export const LABEL_PUBLISHED = "observer-published";
export const LABEL_PUBLISH_FAILED = "observer-publish-failed";

const MARKER_BEGIN = "<!-- survivor-observer:begin -->";
const MARKER_END = "<!-- survivor-observer:end -->";
const NOTICE_PREFIX = "<!-- survivor-observer:notice ";
export const OBSERVER_MARKER_VERSION = 1;

const SHA = /^[0-9a-f]{40}$/;

/** What the sync run that produced a pull request's head saw upstream. */
export interface SyncMarker {
  version: typeof OBSERVER_MARKER_VERSION;
  season: number;
  /** survivoR commit every table was read at. */
  upstreamCommit: string;
  /** Git tree SHA of survivoR's dev/json at that commit. */
  devJsonTree: string;
  /** Episodes the import adds, with their readiness when it was written. */
  episodes: { episodeNum: number; status: string }[];
}

/** The subset of scripts/sync-season.ts's sync-result.json used here. */
export interface SyncResult {
  changed: boolean;
  /** The regenerated file matched main; see scripts/sync-season.ts. */
  unchanged?: boolean;
  seasonNum: number;
  isNewSeason: boolean;
  error?: string;
  upstreamRef?: string;
  held?: string[];
  newEpisodes?: {
    episodeNum: number;
    status: string;
    reviewNotes: string[];
    counts: Record<string, number>;
  }[];
  summary?: Record<string, number>;
  warnings?: string[];
}

export function renderMarker(marker: SyncMarker): string {
  return [MARKER_BEGIN, "```json", JSON.stringify(marker), "```", MARKER_END]
    .join("\n")
    .concat("\n");
}

/** The marker in a pull request body, or null if missing or malformed. */
export function parseMarker(
  body: string | null | undefined,
): SyncMarker | null {
  if (!body) return null;
  const start = body.indexOf(MARKER_BEGIN);
  const end = body.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end < start) return null;
  const block = body
    .slice(start + MARKER_BEGIN.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  try {
    const m = JSON.parse(block) as SyncMarker;
    if (
      m?.version !== OBSERVER_MARKER_VERSION ||
      !Number.isInteger(m.season) ||
      !SHA.test(m.upstreamCommit) ||
      !SHA.test(m.devJsonTree) ||
      !Array.isArray(m.episodes)
    ) {
      return null;
    }
    return m;
  } catch {
    return null;
  }
}

/** The pull request body for a sync, with the marker the gate reads. */
export function renderSyncPrBody(
  result: SyncResult,
  marker: SyncMarker,
  links: { runUrl?: string } = {},
): string {
  const s = result.summary ?? {};
  const episodes = result.newEpisodes ?? [];
  const lines = [
    ...(result.isNewSeason
      ? []
      : [
          `> [!CAUTION]`,
          `> **${MANUAL_MERGE_WARNING}** Approve it instead. The survivoR observer merges it and publishes it to Firestore. A merge from the GitHub button redeploys the site with this data while Firestore keeps the old data; the observer then emails an alert and does not publish it.`,
          "",
        ]),
    "## Automated survivoR data sync",
    "",
    `Season ${result.seasonNum}, read from survivoR at [\`${marker.upstreamCommit.slice(0, 7)}\`](https://github.com/doehm/survivoR/commit/${marker.upstreamCommit}).`,
    "",
    episodes.length
      ? `Adds ${episodes.map((e) => `Episode ${e.episodeNum}`).join(", ")}. Every scoring table that can be checked has consistent rows for ${episodes.length === 1 ? "it" : "them"}.`
      : "Updates episodes already in the app (a survivoR correction or a transformer change).",
    "",
    result.isNewSeason
      ? "**New season bootstrap.** The observer never merges or publishes this. Review it, backfill images and bios with `yarn new-season " +
        `${result.seasonNum} --force\`, and merge it by hand.`
      : "**Nothing is published yet.** The survivoR observer merges this and pushes it to Firestore only after the `ci` check passes on the latest commit and a listed reviewer approves that same commit. A new commit needs a new approval.",
    "",
    "### Counts in the season file",
    "",
    `- Episodes: ${s.episodes ?? "?"}`,
    `- Challenges: ${s.challenges ?? "?"}`,
    `- Eliminations: ${s.eliminations ?? "?"}`,
    `- Events: ${s.events ?? "?"}`,
    "",
  ];
  const notes = episodes.flatMap((e) =>
    e.reviewNotes.map((n) => `- Episode ${e.episodeNum}: ${n}`),
  );
  lines.push(
    "### Before approving",
    "",
    "Advantage finds and journeys cannot be proven complete from survivoR's data: an episode can legitimately have none. Check them against the broadcast.",
    "",
    ...(notes.length ? notes : ["- No notes."]),
    "",
  );
  if (result.warnings?.length) {
    lines.push("### Warnings", "", ...result.warnings.map((w) => `- ${w}`), "");
  }
  lines.push(
    "---",
    "",
    `*Opened by the [survivoR observer](${links.runUrl ?? "../actions"}). Do not edit the block below; the observer reads it.*`,
    "",
    renderMarker(marker),
  );
  return lines.join("\n");
}

export interface PullRequest {
  number: number;
  state: string;
  draft: boolean;
  baseRef: string;
  headRef: string;
  headSha: string;
  headRepo: string;
  authorLogin: string;
  body: string | null;
  mergeable: boolean | null;
  url: string;
}

export interface CheckRun {
  id: number;
  name: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  appSlug: string | null;
}

export interface Review {
  id: number;
  login: string;
  state: string;
  commitId: string;
}

export interface GateInput {
  repo: string;
  pr: PullRequest;
  files: string[];
  checkRuns: CheckRun[];
  reviews: Review[];
  /** login -> repository permission ("admin", "maintain", "write", ...) */
  permissions: Record<string, string>;
  allowedReviewers: string[];
  /** survivoR dev/json tree SHA right now. */
  currentDevJsonTree: string;
  /** This run's sync outcome; the gate never merges past a failed or held sync. */
  sync: SyncResult;
}

export type GateAction =
  | "merge"
  | "wait"
  | "dispatch-ci"
  | "blocked"
  | "stale"
  | "obsolete"
  | "ignore";

export interface Notice {
  /** Unique per pull request head and kind; recorded as a PR comment. */
  key: string;
  subject: string;
  body: string;
}

export interface GateDecision {
  pr: number;
  season: number | null;
  headSha: string;
  action: GateAction;
  reasons: string[];
  notice?: Notice;
}

export function seasonOfBranch(headRef: string): number | null {
  if (!headRef.startsWith(SYNC_BRANCH_PREFIX)) return null;
  const n = Number(headRef.slice(SYNC_BRANCH_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse SURVIVOR_SYNC_REVIEWERS: logins separated by commas or spaces. */
export function parseReviewers(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^@/, ""))
        .filter((s) => /^[A-Za-z0-9-]+$/.test(s)),
    ),
  ];
}

const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);

/** The newest review per reviewer, ignoring plain comments. */
function latestReviews(reviews: Review[]): Map<string, Review> {
  const latest = new Map<string, Review>();
  for (const r of [...reviews].sort((a, b) => a.id - b.id)) {
    if (r.state === "COMMENTED" || r.state === "PENDING") continue;
    latest.set(r.login.toLowerCase(), r);
  }
  return latest;
}

/** The newest `ci` check from GitHub Actions on the head commit. */
function latestCi(checkRuns: CheckRun[], headSha: string): CheckRun | null {
  const runs = checkRuns
    .filter(
      (c) =>
        c.name === CI_CHECK_NAME &&
        c.headSha === headSha &&
        c.appSlug === CI_APP_SLUG,
    )
    .sort((a, b) => b.id - a.id);
  return runs[0] ?? null;
}

export function evaluateGate(input: GateInput): GateDecision {
  const { pr, sync } = input;
  const season = seasonOfBranch(pr.headRef);
  const decision = (
    action: GateAction,
    reasons: string[],
    notice?: Notice,
  ): GateDecision => ({
    pr: pr.number,
    season,
    headSha: pr.headSha,
    action,
    reasons,
    ...(notice ? { notice } : {}),
  });

  // Only the bot's own episode sync branch is ever merged by automation. A
  // new-season bootstrap (auto/survivor-new-season-N) always needs a person.
  if (
    season === null ||
    pr.state !== "open" ||
    pr.baseRef !== "main" ||
    pr.headRepo !== input.repo ||
    pr.authorLogin !== BOT_LOGIN
  ) {
    return decision("ignore", ["not an observer sync pull request"]);
  }
  if (pr.draft) return decision("wait", ["pull request is a draft"]);
  if (!SHA.test(pr.headSha)) {
    return decision("blocked", ["pull request head is not a commit SHA"]);
  }

  // This run's sync must agree that the pull request is the current import.
  if (sync.error) {
    return decision(
      "blocked",
      [`this run's sync failed: ${sync.error}`],
      blockedNotice(
        pr,
        "sync",
        `The survivoR sync failed, so nothing will merge until it succeeds: ${sync.error}`,
      ),
    );
  }
  if (sync.seasonNum !== season) {
    return decision("ignore", [
      `this run synced season ${sync.seasonNum}, not ${season}`,
    ]);
  }
  if (sync.held?.length) {
    return decision(
      "stale",
      ["survivoR has a newer, unfinished episode; holding", ...sync.held],
      {
        key: `held:${pr.headSha}`,
        subject: `survivoR Observer: Season ${season} is on hold (PR #${pr.number})`,
        body: [
          `# Season ${season} is on hold`,
          "",
          "survivoR has started a newer episode but not finished it, so nothing will merge or publish until it does:",
          "",
          ...sync.held.map((h) => `- ${h}`),
          "",
          `- Pull request: ${pr.url}`,
          "",
        ].join("\n"),
      },
    );
  }
  // Close only on a positive comparison. A transient empty read (no
  // castaways, say) also reports changed: false, and must not close a pull
  // request someone may be reviewing.
  if (!sync.changed) {
    return sync.unchanged && sync.upstreamRef
      ? decision("obsolete", [
          "main already matches survivoR; this pull request is no longer needed",
        ])
      : decision("wait", [
          "this run's sync read nothing to compare; leaving the pull request open",
        ]);
  }

  const marker = parseMarker(pr.body);
  if (!marker || marker.season !== season) {
    return decision("stale", ["no valid observer marker in the description"]);
  }
  if (marker.devJsonTree !== input.currentDevJsonTree) {
    return decision("stale", [
      "survivoR's dev/json changed since this commit was generated",
    ]);
  }
  if (marker.upstreamCommit !== sync.upstreamRef) {
    return decision("stale", [
      "the description was written from a different survivoR commit",
    ]);
  }
  const unfinished = marker.episodes.filter((e) => e.status !== "complete");
  if (unfinished.length) {
    return decision("blocked", [
      `episode(s) ${unfinished.map((e) => e.episodeNum).join(", ")} were not complete`,
    ]);
  }

  const dataDir = `src/data/season_${season}/`;
  const outside = input.files.filter((f) => !f.startsWith(dataDir));
  if (!input.files.length || outside.length) {
    return decision(
      "blocked",
      [
        input.files.length
          ? `changes files outside ${dataDir}: ${outside.join(", ")}`
          : "changes no files",
      ],
      blockedNotice(pr, "scope", `It changes files outside ${dataDir}.`),
    );
  }
  if (pr.mergeable === false) {
    return decision("stale", ["pull request conflicts with main"]);
  }

  const ci = latestCi(input.checkRuns, pr.headSha);
  if (!ci) {
    return decision("dispatch-ci", ["no ci check on the head commit yet"]);
  }
  if (ci.status !== "completed") {
    return decision("wait", [`ci is ${ci.status}`]);
  }
  if (ci.conclusion !== "success") {
    return decision(
      "blocked",
      [`ci concluded ${ci.conclusion ?? "without a result"}`],
      blockedNotice(
        pr,
        "ci",
        `The ci check on the latest commit concluded "${ci.conclusion}". Nothing was published.`,
      ),
    );
  }

  const latest = latestReviews(input.reviews);
  const objections = [...latest.values()].filter(
    (r) => r.state === "CHANGES_REQUESTED",
  );
  if (objections.length) {
    return decision("wait", [
      `changes requested by ${objections.map((r) => r.login).join(", ")}`,
    ]);
  }
  const allowed = new Set(input.allowedReviewers.map((l) => l.toLowerCase()));
  const approval = [...latest.values()].find(
    (r) =>
      r.state === "APPROVED" &&
      r.commitId === pr.headSha &&
      allowed.has(r.login.toLowerCase()) &&
      r.login !== BOT_LOGIN &&
      WRITE_PERMISSIONS.has(input.permissions[r.login] ?? ""),
  );
  const powerless = [...latest.values()].find(
    (r) =>
      r.state === "APPROVED" &&
      r.commitId === pr.headSha &&
      allowed.has(r.login.toLowerCase()) &&
      !WRITE_PERMISSIONS.has(input.permissions[r.login] ?? ""),
  );
  if (!approval && powerless) {
    return decision(
      "blocked",
      [`${powerless.login} approved but has no write access`],
      blockedNotice(
        pr,
        "review",
        `${powerless.login} approved, but is listed in SURVIVOR_SYNC_REVIEWERS without write access to the repository, so the approval does not count.`,
      ),
    );
  }
  if (!approval) {
    const reasons = [
      input.allowedReviewers.length
        ? `waiting for an approval of ${pr.headSha.slice(0, 7)} from ${input.allowedReviewers.join(", ")}`
        : "no reviewers are configured (SURVIVOR_SYNC_REVIEWERS); nothing can merge",
    ];
    return decision("wait", reasons, reviewNotice(pr, season, marker));
  }

  return decision(
    "merge",
    [`approved by ${approval.login} at ${pr.headSha.slice(0, 7)}; ci passed`],
    {
      key: `publishing:${pr.headSha}`,
      subject: `survivoR Observer: publishing Season ${season} (PR #${pr.number})`,
      body: [
        `# Publishing Season ${season}`,
        "",
        `PR #${pr.number} passed every gate on commit \`${pr.headSha}\`: complete episodes, ci, and an approval from ${approval.login}. The observer is merging it and then pushing Season ${season} to Firestore.`,
        "",
        `- Pull request: ${pr.url}`,
        "",
        "A second email follows with the result.",
        "",
      ].join("\n"),
    },
  );
}

function reviewNotice(
  pr: PullRequest,
  season: number,
  marker: SyncMarker,
): Notice {
  const eps = marker.episodes.map((e) => e.episodeNum);
  return {
    key: `review:${pr.headSha}`,
    subject: `survivoR Observer: Season ${season}${eps.length ? ` Episode ${eps.join(", ")}` : ""} is ready for review (PR #${pr.number})`,
    body: [
      `# Season ${season} is ready for review`,
      "",
      `survivoR has finished ${eps.length ? `Episode ${eps.join(", ")}` : "a correction"}, and the ci check passed on commit \`${pr.headSha}\`.`,
      "",
      `- Pull request: ${pr.url}`,
      "",
      "Approve that pull request on GitHub to publish it. The next observer run merges it and pushes it to Firestore. Nothing is published until then.",
      "",
    ].join("\n"),
  };
}

function blockedNotice(pr: PullRequest, kind: string, detail: string): Notice {
  return {
    key: `blocked-${kind}:${pr.headSha}`,
    subject: `survivoR Observer: PR #${pr.number} is blocked`,
    body: [
      `# PR #${pr.number} is blocked`,
      "",
      detail,
      "",
      `- Pull request: ${pr.url}`,
      "",
    ].join("\n"),
  };
}

/** The hidden comment that records a delivered notice on a pull request. */
export function noticeComment(notice: Notice): string {
  return `${NOTICE_PREFIX}${notice.key} -->\n${notice.subject}`;
}

/** Notice keys already recorded in a pull request's comments. */
export function recordedNoticeKeys(comments: string[]): Set<string> {
  const keys = new Set<string>();
  for (const c of comments) {
    const start = c.indexOf(NOTICE_PREFIX);
    if (start === -1) continue;
    const end = c.indexOf(" -->", start);
    if (end !== -1) keys.add(c.slice(start + NOTICE_PREFIX.length, end));
  }
  return keys;
}

/** One email for every notice not yet delivered. */
export function renderNoticeEmail(
  notices: Notice[],
  runUrl?: string,
): { subject: string; body: string } | null {
  if (!notices.length) return null;
  const subject =
    notices.length === 1
      ? notices[0].subject
      : `survivoR Observer: ${notices.length} updates`;
  const body = [
    ...notices.map((n) => n.body),
    ...(runUrl ? [`Workflow run: ${runUrl}`, ""] : []),
  ].join("\n");
  return { subject, body };
}

/** A closed pull request carrying the publish-pending label. */
export interface PendingPull {
  number: number;
  headRef: string;
  headSha: string;
  mergedAt: string | null;
  mergeSha: string | null;
  mergedBy: string | null;
}

export type PendingVerdict =
  | { kind: "publish"; pr: number; season: number; mergeSha: string }
  | { kind: "unlabel"; pr: number; reason: string }
  | { kind: "reject"; pr: number; reason: string };

/**
 * Whether a labelled pull request may be published. A label alone is not
 * enough, since anyone with triage access can add one: the observer must have
 * merged it, after recording its "publishing" notice for the exact head it
 * merged. A closed pull request that never merged just loses the label.
 */
export function judgePending(
  p: PendingPull,
  botComments: string[],
): PendingVerdict {
  const season = seasonOfBranch(p.headRef);
  if (!p.mergedAt || !p.mergeSha) {
    return { kind: "unlabel", pr: p.number, reason: "closed without merging" };
  }
  if (season === null) {
    return { kind: "reject", pr: p.number, reason: "not a sync branch" };
  }
  if (p.mergedBy !== BOT_LOGIN) {
    return {
      kind: "reject",
      pr: p.number,
      reason: `merged by ${p.mergedBy ?? "unknown"}, not by the observer`,
    };
  }
  if (!recordedNoticeKeys(botComments).has(`publishing:${p.headSha}`)) {
    return {
      kind: "reject",
      pr: p.number,
      reason: "no recorded publishing notice for the merged head",
    };
  }
  return { kind: "publish", pr: p.number, season, mergeSha: p.mergeSha };
}

export const MANUAL_MERGE_WARNING = "Do not merge this pull request by hand.";

/** A merged pull request, as the hand-merge check needs it. */
export interface MergedPull extends PendingPull {
  body: string | null;
  labels: string[];
}

/**
 * Whether an observer sync pull request was merged around the gate: it
 * carries the observer's marker, has no observer label yet, and was not
 * merged by the observer after recording its publishing notice. Such a merge
 * puts the data on the site but not in Firestore. It is reported, never
 * published: nobody approved it through the gate.
 */
export function isHandMerged(p: MergedPull, botComments: string[]): boolean {
  if (!p.mergedAt || seasonOfBranch(p.headRef) === null) return false;
  if (!parseMarker(p.body)) return false;
  if (p.labels.some((l) => l.startsWith("observer-"))) return false;
  return judgePending(p, botComments).kind !== "publish";
}

export function handMergedNotice(p: MergedPull, url: string): Notice {
  const season = seasonOfBranch(p.headRef);
  return {
    key: `hand-merged:${p.headSha}`,
    subject: `survivoR Observer: PR #${p.number} was merged by hand and is NOT published`,
    body: [
      `# PR #${p.number} was merged outside the observer`,
      "",
      `Season ${season} sync PR #${p.number} was merged by ${p.mergedBy ?? "someone"}, not by the observer after its gate. Its data is on \`main\`, so the site shows it after the next deploy, but Firestore still has the previous data. The observer will not publish it, because it did not pass the review gate.`,
      "",
      `- Pull request: ${url}`,
      "",
      `If this data is correct, publish it by hand from an up-to-date \`main\` with \`yarn tsx scripts/publish-season.ts ${season}\`. If it is not, revert the merge.`,
      "",
    ].join("\n"),
  };
}
