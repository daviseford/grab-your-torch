/**
 * survivoR data radar: decides whether the upstream survivoR dataset changed
 * in a way worth an email, and renders that email.
 *
 * Fingerprint semantics (normalized, not byte-level):
 *
 * - Scope is every JSON table under survivoR's `dev/json/`, restricted to US
 *   records: rows with `version === "US"`, plus rows of version-less tables
 *   (castaway_details) whose `castaway_id` is a US id or absent. Other
 *   franchises (AU, NZ, SA, UK) are out of scope; the app only reads US data.
 * - Rows are grouped by table and season (`season` rounded, since survivoR
 *   encodes integers as floats). Rows with no season fall into the "all" group.
 * - Each row is canonicalized: keys sorted recursively, null values dropped
 *   (survivoR's NA, which an exporter may write as null or omit), numbers as
 *   JSON.parse reads them (48.0 and 48 are equal). A group's digest is the
 *   SHA-256 of its canonical rows sorted, so row order, key order, whitespace
 *   and formatting never register; any added, removed or edited value does.
 * - An upstream commit that touches nothing in scope (docs, R code, xlsx,
 *   other franchises) leaves every digest unchanged and sends nothing.
 */

import { createHash } from "crypto";

export const RADAR_STATE_VERSION = 1;
export const RADAR_SCOPE = "US";
export const ALL_SEASONS_GROUP = "all";
export const RADAR_ISSUE_TITLE = "survivoR data radar state";
export const RADAR_SUBJECT_PREFIX = "survivoR Radar";

const STATE_BEGIN = "<!-- survivor-data-radar-state:begin -->";
const STATE_END = "<!-- survivor-data-radar-state:end -->";
/** GitHub rejects issue bodies over 65,536 characters; keep headroom. */
export const MAX_ISSUE_BODY_LENGTH = 60_000;

const TABLE_NAME = /^[a-z0-9_]+$/;
const GROUP_NAME = /^(\d+|all)$/;
const DIGEST = /^[0-9a-f]{16}$/;
const US_CASTAWAY_ID = /^US/;

/** One group's fingerprint: a truncated SHA-256 and the row count. */
export interface GroupFingerprint {
  digest: string;
  rows: number;
}

/** table -> season group -> fingerprint */
export type RadarTables = Record<string, Record<string, GroupFingerprint>>;

export interface RadarState {
  version: typeof RADAR_STATE_VERSION;
  scope: typeof RADAR_SCOPE;
  /** The survivoR commit the fingerprints were read at. */
  commit: string;
  observedAt: string;
  tables: RadarTables;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Stable JSON: sorted keys, nulls dropped from objects. */
export function canonicalize(value: Json): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== null && value[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether a row belongs to the radar's US scope. */
export function isInScope(row: Record<string, Json>): boolean {
  if ("version" in row && row.version !== null) {
    return row.version === RADAR_SCOPE;
  }
  const id = row.castaway_id;
  return typeof id !== "string" || US_CASTAWAY_ID.test(id);
}

function groupOf(row: Record<string, Json>): string {
  const season = row.season;
  if (typeof season === "number" && Number.isFinite(season)) {
    return String(Math.round(season));
  }
  if (typeof season === "string" && /^\d+(\.0+)?$/.test(season)) {
    return String(Math.round(Number(season)));
  }
  return ALL_SEASONS_GROUP;
}

const sha16 = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Fingerprint one table's parsed JSON, per in-scope season group. */
export function fingerprintTable(
  table: string,
  data: unknown,
): Record<string, GroupFingerprint> {
  if (!Array.isArray(data)) {
    throw new Error(`survivoR table ${table} is not a JSON array`);
  }
  const groups = new Map<string, string[]>();
  for (const row of data) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(
        `survivoR table ${table} has a row that is not an object`,
      );
    }
    const record = row as Record<string, Json>;
    if (!isInScope(record)) continue;
    const group = groupOf(record);
    const rows = groups.get(group) ?? [];
    rows.push(canonicalize(record));
    groups.set(group, rows);
  }
  const result: Record<string, GroupFingerprint> = {};
  for (const group of [...groups.keys()].sort(compareGroups)) {
    const rows = groups.get(group)!.sort();
    result[group] = { digest: sha16(rows.join("\n")), rows: rows.length };
  }
  return result;
}

function compareGroups(a: string, b: string): number {
  if (a === ALL_SEASONS_GROUP) return b === ALL_SEASONS_GROUP ? 0 : 1;
  if (b === ALL_SEASONS_GROUP) return -1;
  return Number(a) - Number(b);
}

export type GroupChangeKind = "added" | "removed" | "changed";

export interface GroupChange {
  table: string;
  group: string;
  kind: GroupChangeKind;
  previousRows: number | null;
  rows: number | null;
}

/** Every group whose fingerprint differs between two observations. */
export function diffTables(
  previous: RadarTables,
  current: RadarTables,
): GroupChange[] {
  const changes: GroupChange[] = [];
  const tables = [
    ...new Set([...Object.keys(previous), ...Object.keys(current)]),
  ].sort();
  for (const table of tables) {
    const before = previous[table] ?? {};
    const after = current[table] ?? {};
    const groups = [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].sort(compareGroups);
    for (const group of groups) {
      const was = before[group];
      const now = after[group];
      if (was && now && was.digest === now.digest) continue;
      changes.push({
        table,
        group,
        kind: !was ? "added" : !now ? "removed" : "changed",
        previousRows: was?.rows ?? null,
        rows: now?.rows ?? null,
      });
    }
  }
  return changes;
}

export type RadarAction = "baseline" | "unchanged" | "alert";

export interface RadarDecision {
  action: RadarAction;
  reason: string;
  previousCommit: string | null;
  commit: string;
  changes: GroupChange[];
}

/**
 * - No usable previous state: record a baseline, email nothing. The first run
 *   never mails the dataset's history.
 * - Same fingerprints: nothing to send and nothing to record.
 * - Anything added, removed or changed: alert. The caller records the new
 *   state only after the email is delivered, so an undelivered alert is
 *   re-sent (with anything newer folded in) on the next run.
 */
export function decide(
  previous: RadarState | null,
  current: RadarState,
): RadarDecision {
  if (!previous) {
    return {
      action: "baseline",
      reason: "no previous radar state; recording a baseline without email",
      previousCommit: null,
      commit: current.commit,
      changes: [],
    };
  }
  const changes = diffTables(previous.tables, current.tables);
  if (!changes.length) {
    return {
      action: "unchanged",
      reason: "survivoR data in scope is unchanged",
      previousCommit: previous.commit,
      commit: current.commit,
      changes,
    };
  }
  return {
    action: "alert",
    reason: `${changes.length} table/season group(s) changed`,
    previousCommit: previous.commit,
    commit: current.commit,
    changes,
  };
}

const groupLabel = (group: string) =>
  group === ALL_SEASONS_GROUP ? "all seasons" : `Season ${group}`;

/** Seasons touched by a set of changes, newest first. */
function touchedSeasons(changes: GroupChange[]): string[] {
  return [...new Set(changes.map((change) => change.group))]
    .sort(compareGroups)
    .reverse();
}

export function renderSubject(decision: RadarDecision): string {
  const seasons = touchedSeasons(decision.changes);
  const shown = seasons.slice(0, 4).map(groupLabel).join(", ");
  const more = seasons.length > 4 ? ` and ${seasons.length - 4} more` : "";
  return `${RADAR_SUBJECT_PREFIX}: survivoR data changed (${shown}${more})`;
}

const rowsText = (rows: number | null) =>
  rows === null ? "none" : `${rows} row${rows === 1 ? "" : "s"}`;

function describeChange(change: GroupChange): string {
  switch (change.kind) {
    case "added":
      return `new, ${rowsText(change.rows)}`;
    case "removed":
      return `removed, was ${rowsText(change.previousRows)}`;
    default:
      return change.previousRows === change.rows
        ? `values edited, still ${rowsText(change.rows)}`
        : `${rowsText(change.previousRows)} to ${rowsText(change.rows)}`;
  }
}

export interface RenderLinks {
  runUrl?: string;
  issueUrl?: string;
}

export function renderBody(
  decision: RadarDecision,
  links: RenderLinks = {},
): string {
  const lines = [
    "# survivoR data changed",
    "",
    `The survivoR dataset changed in ${decision.changes.length} table/season group(s) since the last email.`,
    "",
  ];
  for (const season of touchedSeasons(decision.changes)) {
    lines.push(`## ${groupLabel(season)}`, "");
    for (const change of decision.changes.filter((c) => c.group === season)) {
      lines.push(`- \`${change.table}\`: ${describeChange(change)}`);
    }
    lines.push("");
  }
  const repo = "https://github.com/doehm/survivoR";
  lines.push("## Source", "");
  if (decision.previousCommit && decision.previousCommit !== decision.commit) {
    lines.push(
      `- Upstream diff: ${repo}/compare/${decision.previousCommit}...${decision.commit}`,
    );
  } else {
    lines.push(`- Upstream commit: ${repo}/commit/${decision.commit}`);
  }
  if (links.runUrl) lines.push(`- Workflow run: ${links.runUrl}`);
  if (links.issueUrl) lines.push(`- Radar state: ${links.issueUrl}`);
  lines.push(
    "",
    "---",
    "",
    "The survivoR sync only imports the newest season. A change to an older season, or to a table the app does not read, needs a manual look. A change is normally emailed once; if recording it fails after delivery, the next run emails it again rather than risk losing it.",
  );
  return `${lines.join("\n").trim()}\n`;
}

/** Compact state encoding: `{table: {group: "digest:rows"}}`. */
interface EncodedState {
  version: number;
  scope: string;
  commit: string;
  observedAt: string;
  tables: Record<string, Record<string, string>>;
}

export function renderIssueBody(state: RadarState): string {
  const encoded: EncodedState = {
    version: state.version,
    scope: state.scope,
    commit: state.commit,
    observedAt: state.observedAt,
    tables: Object.fromEntries(
      Object.entries(state.tables).map(([table, groups]) => [
        table,
        Object.fromEntries(
          Object.entries(groups).map(([group, fp]) => [
            group,
            `${fp.digest}:${fp.rows}`,
          ]),
        ),
      ]),
    ),
  };
  const body = [
    "Managed by `.github/workflows/survivor-observer.yml` (and `survivor-data-radar.yml` until the observer replaces it). Do not edit.",
    "",
    "This issue stores the survivoR data fingerprints the radar last emailed about (or the first baseline). Closing it is harmless. Editing or deleting the state block makes the radar fail until it is restored; to start over from a fresh baseline, retitle or delete this issue. See `docs/survivor-data-radar.md`.",
    "",
    `- survivoR commit: \`${state.commit}\``,
    `- Observed: ${state.observedAt}`,
    `- Tables: ${Object.keys(state.tables).length}`,
    "",
    STATE_BEGIN,
    "```json",
    JSON.stringify(encoded),
    "```",
    STATE_END,
    "",
  ].join("\n");
  if (body.length > MAX_ISSUE_BODY_LENGTH) {
    throw new Error(
      `Radar state is ${body.length} characters, over the ${MAX_ISSUE_BODY_LENGTH} issue body budget`,
    );
  }
  return body;
}

/**
 * Read the state back out of an existing managed issue body. Only the
 * absence of the issue itself means "no state yet". Once the issue exists, a
 * missing, malformed, or other-version/scope block throws: re-baselining
 * there would silently drop every change since the last recorded state.
 * Re-baselining on purpose means retitling or deleting the issue.
 */
export function parseIssueBody(body: string | null | undefined): RadarState {
  if (!body) {
    throw new Error("Radar state issue exists but has an empty body");
  }
  const start = body.indexOf(STATE_BEGIN);
  const end = body.indexOf(STATE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Radar state issue exists but has no state block");
  }
  const block = body
    .slice(start + STATE_BEGIN.length, end)
    .trim()
    .replace(/^```json\s*/, "")
    .replace(/\s*```$/, "");
  let encoded: EncodedState;
  try {
    encoded = JSON.parse(block) as EncodedState;
  } catch {
    throw new Error("Radar state block is not valid JSON");
  }
  if (
    encoded?.version !== RADAR_STATE_VERSION ||
    encoded.scope !== RADAR_SCOPE
  ) {
    throw new Error(
      `Radar state block is version ${String(encoded?.version)} scope ${String(encoded?.scope)}, expected ${RADAR_STATE_VERSION} ${RADAR_SCOPE}`,
    );
  }
  if (
    typeof encoded.commit !== "string" ||
    !/^[0-9a-f]{40}$/.test(encoded.commit)
  ) {
    throw new Error("Radar state block has no valid survivoR commit");
  }
  const tables: RadarTables = {};
  for (const [table, groups] of Object.entries(encoded.tables ?? {})) {
    if (!TABLE_NAME.test(table)) {
      throw new Error(`Radar state block has an invalid table name: ${table}`);
    }
    tables[table] = {};
    for (const [group, value] of Object.entries(groups)) {
      const [digest, rows] = String(value).split(":");
      if (
        !GROUP_NAME.test(group) ||
        !DIGEST.test(digest) ||
        !/^\d+$/.test(rows ?? "")
      ) {
        throw new Error(
          `Radar state block has an invalid entry: ${table}/${group}`,
        );
      }
      tables[table][group] = { digest, rows: Number(rows) };
    }
  }
  return {
    version: RADAR_STATE_VERSION,
    scope: RADAR_SCOPE,
    commit: encoded.commit,
    observedAt: String(encoded.observedAt),
    tables,
  };
}

export function isTableName(name: string): boolean {
  return TABLE_NAME.test(name);
}
