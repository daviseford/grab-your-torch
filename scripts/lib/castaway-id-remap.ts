/**
 * Remap a season's castaway ids from provisional values to survivoR's
 * published ids, across every stored document that references them.
 *
 * Season 51 was drafted on provisional ids (US0752 to US0772, predicted
 * before survivoR published). survivoR then published the same id range in a
 * different order, so the remap is a PERMUTATION of one id range: US0754 is
 * Ana Sani in the committed file and Thien An Nguyen upstream. Every function
 * here is built around three consequences:
 *
 * 1. A value is remapped with one lookup in the old-to-new map, never by
 *    chaining replacements. Sequential find-and-replace (US0754 -> US0755,
 *    then US0755 -> US0757, ...) would move one person several times.
 * 2. Applying the remap twice is not a no-op; it moves everyone again. And an
 *    id alone cannot say which side of the remap it is on, because both sides
 *    use the same range. So "already remapped" is never inferred from ids: a
 *    document is marked applied in the same atomic write that remaps it (a
 *    ledger entry in the same Firestore transaction, or a marker inside the
 *    same RTDB node). "Unmarked" does not mean "provisional", though: users
 *    keep creating drafts, competitions and trades on survivoR's ids once the
 *    season document flips. So the cutover records a census of every document
 *    that exists when it begins, and only census documents are ever remapped.
 *    Anything created later is classified from its names, its parent draft or
 *    competition and its rosters, marked when the evidence is clear, and
 *    reported otherwise. Every census document is marked, even one with
 *    nothing to change (an empty draft), so later writes into it read as
 *    survivoR's.
 * 3. Where the schema stores a name next to the id (draft picks, pool picks,
 *    season players), the name is cross-checked against both casts, and a
 *    named pick moves only when its name proves it is provisional. That
 *    catches a document edited with the other side's ids, and lets a pick
 *    taken mid-cutover be repaired by name, which ids alone could never prove.
 *
 * The mapping itself is committed (`scripts/castaway-id-remaps/`), pinned to
 * a survivoR commit and hashed, so every dry run, write and rollback uses the
 * exact mapping that was reviewed.
 *
 * Everything here is pure except `applyCastawayIdRemap` and
 * `rollbackCastawayIdRemap`, which go through the small `RemapStore`
 * interface; the Firebase store is exercised against the emulators in
 * `rules-tests/castaway-id-remap.emulator.test.ts`.
 */

import { createHash } from "crypto";
import { isDeepStrictEqual } from "util";

/* ------------------------------------------------------------------ *
 * Identity mapping
 * ------------------------------------------------------------------ */

/** A castaway as committed in the app's season file. */
export type CommittedCastaway = {
  castaway_id: string;
  full_name: string;
  /** Short name, e.g. "Jelly". */
  castaway: string;
};

/** A castaway as published by survivoR. */
export type UpstreamCastaway = {
  castaway_id: string;
  /** `castaways.full_name`. */
  full_name: string;
  /** `castaways.castaway` (short name). */
  castaway: string;
  /** `castaway_details.full_name`, which can differ from `castaways.full_name`. */
  details_full_name?: string;
};

export type CastawayIdMatchRule =
  | "full_name"
  | "details_full_name"
  | "short_name_and_surname";

export type CastawayIdMapping = {
  from: string;
  to: string;
  from_name: string;
  /** survivoR's `castaways.full_name`. */
  to_name: string;
  /** survivoR's `castaways.castaway` (short name). */
  to_castaway: string;
  matched_by: CastawayIdMatchRule;
};

export type CastawayIdMappingPlan = {
  mappings: CastawayIdMapping[];
  /** Mappings whose id actually changes. */
  changed: CastawayIdMapping[];
  errors: string[];
  /** Stable hash of the full mapping, recorded with every applied change. */
  mapping_hash: string;
};

/**
 * The committed, reviewed mapping for one season. Written once by
 * `--generate-mapping`, checked in, and read by every later run.
 */
export type CastawayIdMappingFile = {
  season_num: number;
  upstream: { repo: "doehm/survivoR"; commit: string; tables: string[] };
  mapping_hash: string;
  mappings: CastawayIdMapping[];
};

const normalize = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

const surname = (fullName: string): string => {
  const parts = normalize(fullName).split(" ");
  return parts[parts.length - 1] ?? "";
};

/** Hash over everything a remap writes: ids, names and short names. */
export const mappingHash = (mappings: readonly CastawayIdMapping[]): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...mappings]
          .sort((a, b) => a.from.localeCompare(b.from))
          .map((m) => [m.from, m.to, m.from_name, m.to_name, m.to_castaway]),
      ),
    )
    .digest("hex")
    .slice(0, 16);

/**
 * Match every committed castaway to exactly one upstream castaway.
 *
 * Rules are tried in order and a rule only counts when it yields exactly one
 * candidate. The third rule exists for nicknames: the app committed "Jelly
 * Loblack" from the wiki, survivoR publishes "Angelica Loblack" with the short
 * name "Jelly".
 *
 * Any unmatched, ambiguous, or doubly-claimed castaway is an error, and a plan
 * with errors must not be applied.
 */
export function planCastawayIdMapping(
  committed: readonly CommittedCastaway[],
  upstream: readonly UpstreamCastaway[],
): CastawayIdMappingPlan {
  const errors: string[] = [];
  const mappings: CastawayIdMapping[] = [];

  if (committed.length !== upstream.length) {
    errors.push(
      `Cast size differs: ${committed.length} committed, ${upstream.length} upstream`,
    );
  }
  for (const [label, list] of [
    ["committed", committed],
    ["upstream", upstream],
  ] as const) {
    const ids = new Set(list.map((c) => c.castaway_id));
    if (ids.size !== list.length) errors.push(`Duplicate ${label} castaway_id`);
  }

  const rules: [
    CastawayIdMatchRule,
    (c: CommittedCastaway, u: UpstreamCastaway) => boolean,
  ][] = [
    ["full_name", (c, u) => normalize(c.full_name) === normalize(u.full_name)],
    [
      "details_full_name",
      (c, u) =>
        u.details_full_name !== undefined &&
        normalize(c.full_name) === normalize(u.details_full_name),
    ],
    [
      "short_name_and_surname",
      (c, u) =>
        normalize(c.full_name) ===
        normalize(`${u.castaway} ${surname(u.full_name)}`),
    ],
  ];

  const claimedBy = new Map<string, string>();
  for (const c of committed) {
    let match: { u: UpstreamCastaway; rule: CastawayIdMatchRule } | undefined;
    let ambiguous = false;
    for (const [rule, test] of rules) {
      const candidates = upstream.filter((u) => test(c, u));
      if (candidates.length > 1) {
        errors.push(
          `"${c.full_name}" (${c.castaway_id}) is ambiguous by ${rule}: ${candidates.map((u) => u.castaway_id).join(", ")}`,
        );
        ambiguous = true;
        break;
      }
      if (candidates.length === 1) {
        match = { u: candidates[0], rule };
        break;
      }
    }
    if (!match) {
      if (!ambiguous) {
        errors.push(
          `"${c.full_name}" (${c.castaway_id}) matches no upstream castaway`,
        );
      }
      continue;
    }
    const prior = claimedBy.get(match.u.castaway_id);
    if (prior) {
      errors.push(
        `Upstream ${match.u.castaway_id} (${match.u.full_name}) is claimed by both ${prior} and ${c.castaway_id}`,
      );
      continue;
    }
    claimedBy.set(match.u.castaway_id, c.castaway_id);
    mappings.push({
      from: c.castaway_id,
      to: match.u.castaway_id,
      from_name: c.full_name,
      to_name: match.u.full_name,
      to_castaway: match.u.castaway,
      matched_by: match.rule,
    });
  }

  for (const u of upstream) {
    if (!claimedBy.has(u.castaway_id)) {
      errors.push(
        `Upstream ${u.castaway_id} (${u.full_name}) matches no committed castaway`,
      );
    }
  }

  mappings.sort((a, b) => a.from.localeCompare(b.from));
  return {
    mappings,
    changed: mappings.filter((m) => m.from !== m.to),
    errors,
    mapping_hash: mappingHash(mappings),
  };
}

/**
 * Check a committed mapping file: internally consistent, hash intact, a
 * bijection on one id set, and (when given) identical to what the pinned
 * upstream and the provisional cast produce today.
 */
export function verifyMappingFile(
  file: CastawayIdMappingFile,
  rederived?: CastawayIdMappingPlan,
): string[] {
  const errors: string[] = [];
  if (mappingHash(file.mappings) !== file.mapping_hash) {
    errors.push("mapping_hash does not match the mappings in the file");
  }
  const froms = new Set(file.mappings.map((m) => m.from));
  const tos = new Set(file.mappings.map((m) => m.to));
  if (
    froms.size !== file.mappings.length ||
    tos.size !== file.mappings.length
  ) {
    errors.push("mapping is not one to one");
  }
  if (!isDeepStrictEqual(froms, tos)) {
    errors.push("mapping is not a permutation of one id set");
  }
  if (rederived) {
    errors.push(...rederived.errors);
    if (rederived.mapping_hash !== file.mapping_hash) {
      errors.push(
        `re-derived mapping ${rederived.mapping_hash} differs from the committed ${file.mapping_hash}`,
      );
    }
  }
  return errors;
}

/** Which side of the mapping a season's committed cast is on. */
export type CastState = "provisional" | "remapped" | "neither";

export function classifyCommittedCast(
  cast: readonly CommittedCastaway[],
  mappings: readonly CastawayIdMapping[],
): CastState {
  const key = (id: string, name: string, short: string) =>
    `${id}|${normalize(name)}|${normalize(short)}`;
  const actual = new Set(
    cast.map((c) => key(c.castaway_id, c.full_name, c.castaway)),
  );
  const same = (pairs: string[]) =>
    actual.size === pairs.length && pairs.every((p) => actual.has(p));
  // The provisional short name is not in the mapping; compare ids and names.
  const provisional = new Set(
    mappings.map((m) => `${m.from}|${normalize(m.from_name)}`),
  );
  if (
    cast.length === mappings.length &&
    cast.every((c) =>
      provisional.has(`${c.castaway_id}|${normalize(c.full_name)}`),
    )
  ) {
    return "provisional";
  }
  if (same(mappings.map((m) => key(m.to, m.to_name, m.to_castaway)))) {
    return "remapped";
  }
  return "neither";
}

/**
 * Rewrite a generated season file (`src/data/season_N/index.ts`) from the
 * provisional cast to survivoR's, using only the mapping: ids in one pass,
 * then the full and short names that survivoR spells differently. Nothing
 * else in the file changes, so no episode or result data is introduced.
 */
export function rewriteSeasonSource(
  source: string,
  mappings: readonly CastawayIdMapping[],
): string {
  const idMap = new Map(mappings.map((m) => [m.from, m]));
  // One pass: each id token is looked up once, so the permutation never chains.
  let out = source.replace(/\bUS\d{4}\b/g, (id) => idMap.get(id)?.to ?? id);
  for (const m of mappings) {
    const lookupLine = new RegExp(
      `(\\b${m.to}: \\{ full_name: )"[^"]*", castaway: "[^"]*" \\}`,
    );
    out = out.replace(
      lookupLine,
      `$1${JSON.stringify(m.to_name)}, castaway: ${JSON.stringify(m.to_castaway)} }`,
    );
    const playerName = new RegExp(
      `(castaway_id: "${m.to}",\\s*full_name: )"[^"]*"`,
    );
    out = out.replace(playerName, `$1${JSON.stringify(m.to_name)}`);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Document planning
 * ------------------------------------------------------------------ */

export type RemapDocKind =
  | "competition"
  | "trade"
  | "rtdb_draft"
  | "pool_config"
  | "pool_entry"
  | "season"
  | "team_assignments"
  | "castaway_adp"
  /** challenges / eliminations / events / vote_history: never remapped. */
  | "season_results";

/** A stored document, reduced to plain JSON. */
export type RemapSourceDoc = {
  kind: RemapDocKind;
  /** Firestore path (`competitions/x`) or RTDB path (`drafts/x`). */
  path: string;
  data: Record<string, unknown>;
};

export type RemapChangeMode = "remap" | "repair" | "born";

/** A field-level change: only these fields are compared and written. */
export type RemapDocChange = {
  kind: RemapDocKind;
  path: string;
  /**
   * `remap`: a document that existed when the cutover began, moved from
   * provisional to survivoR's ids and marked applied. It may change no field
   * (an empty draft); it is marked anyway, so that anything written into it
   * later is read as survivoR's.
   * `repair`: an already-marked document where some named picks still carry
   * provisional pairs (taken by a client on the old season document); only
   * those picks change.
   * `born`: a document created after the cutover began whose ids are shown
   * to be survivoR's already. Marked, never remapped.
   */
  mode: RemapChangeMode;
  /**
   * Every castaway-bearing field of the document as read (null when absent),
   * so the write is refused if any of them moved. Only fields whose `after`
   * differs are written.
   */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** How many castaway id values change in this document. */
  id_changes: number;
};

export type RemapProblemReason =
  | "unknown_castaway_id"
  | "name_mismatch"
  | "looks_already_remapped"
  | "mixed_old_and_new"
  | "applied_with_other_mapping"
  | "season_results_present"
  | "unhandled_castaway_field"
  | "duplicate_castaway"
  | "prop_bet_epoch_unknown"
  | "born_not_new"
  | "born_ambiguous"
  | "parent_unresolved";

export type RemapProblem = {
  path: string;
  reason: RemapProblemReason;
  detail: string;
  /**
   * `global` problems refuse every write: season results, a foreign mapping,
   * and anything wrong with the season document or the pool config, which
   * every other document depends on. `document` problems hold that document
   * only: it is not written, and the cutover cannot be finalized until it is
   * resolved.
   */
  scope: "global" | "document";
};

export type RemapDocumentPlan = {
  /** In apply order: the season document first, then the pool config. */
  changes: RemapDocChange[];
  /** Empty season results. */
  unchanged: string[];
  /** Documents already marked applied with this mapping, and consistent. */
  already_applied: string[];
  problems: RemapProblem[];
  /**
   * RTDB drafts users can still write castaway ids into: started and not
   * finished, or finished with prop bets still to come.
   */
  live_drafts: string[];
  /**
   * Documents created after the cutover began that cannot be classified yet:
   * no picks, or a draft still being drafted. Left unmarked and classified
   * again by the next run. Never remapped.
   */
  born_pending: string[];
};

/** RTDB marker stored inside a remapped draft node, written atomically. */
export const RTDB_REMAP_MARKER = "castaway_id_remap";

/**
 * What the ledger records about a document when the cutover begins. Only
 * documents in the census are ever remapped; anything else was created later
 * and is classified, never remapped.
 */
export type CensusEntry = {
  kind: RemapDocKind;
  /** RTDB drafts: the users whose prop bets were already in. */
  prop_bet_uids?: string[];
};
export type Census = ReadonlyMap<string, CensusEntry>;

type Pair = { id: string; name: string; owner?: string };
type PairSide = "old" | "new" | "both" | "neither";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Map every element of an array or every value of an object, keeping the
 * container. RTDB stores `draft_picks` keyed by pick number from 1 (read back
 * as an array with a null hole, or as an object) and `prop_bets` keyed by uid;
 * flattening either would renumber picks or drop uids.
 */
const mapContainer = (
  v: unknown,
  fn: (item: unknown, key: string) => unknown,
): unknown => {
  if (Array.isArray(v)) {
    return v.map((item, i) => (item == null ? item : fn(item, String(i))));
  }
  if (isRecord(v)) {
    return Object.fromEntries(
      Object.entries(v).map(([k, item]) => [
        k,
        item == null ? item : fn(item, k),
      ]),
    );
  }
  return v;
};

const containerEntries = (v: unknown): [string, unknown][] =>
  Array.isArray(v)
    ? v.map((item, i) => [String(i), item] as [string, unknown])
    : isRecord(v)
      ? Object.entries(v)
      : [];

const containerSize = (v: unknown): number =>
  containerEntries(v).filter(([, x]) => x != null).length;

/** Prop bet entries by uid (the entry's `user_uid`, else its key). */
const propBetEntries = (v: unknown): [string, Record<string, unknown>][] =>
  containerEntries(v).flatMap(([k, e]) =>
    isRecord(e)
      ? [[typeof e.user_uid === "string" ? e.user_uid : k, e] as const]
      : [],
  ) as [string, Record<string, unknown>][];

/** The census entry for each document that exists when a cutover begins. */
export const buildCensus = (
  docs: readonly RemapSourceDoc[],
): Record<string, CensusEntry> =>
  Object.fromEntries(
    docs
      .filter((d) => d.kind !== "season_results")
      .map((d) => [
        d.path,
        d.kind === "rtdb_draft"
          ? {
              kind: d.kind,
              prop_bet_uids: propBetEntries(d.data.prop_bets).map(([u]) => u),
            }
          : { kind: d.kind },
      ]),
  );

export type PlanDocumentsOptions = {
  mappings: readonly CastawayIdMapping[];
  mappingHash: string;
  /** Prop bet question keys whose answer is a castaway id. */
  castawayPropBetKeys: ReadonlySet<string>;
  /**
   * Firestore paths the ledger records as applied, with the mapping hash
   * each was applied under. RTDB drafts carry their own marker instead.
   */
  ledger: ReadonlyMap<string, string>;
  /**
   * The documents that existed when the cutover began. Null (the default)
   * before any cutover, when every document is pre-existing.
   */
  census?: Census | null;
  /**
   * Born documents whose evidence is ambiguous and that the operator has
   * classified as already on survivoR's ids (`--accept-born`).
   */
  acceptBorn?: ReadonlySet<string>;
};

/** The mapping hash a document is marked applied under, if any. */
const appliedHashOf = (
  doc: RemapSourceDoc,
  ledger: ReadonlyMap<string, string>,
): string | undefined => {
  if (doc.kind === "rtdb_draft") {
    const marker = doc.data[RTDB_REMAP_MARKER];
    return isRecord(marker) && typeof marker.mapping_hash === "string"
      ? marker.mapping_hash
      : undefined;
  }
  return ledger.get(doc.path);
};

const isLiveDraft = (data: Record<string, unknown>): boolean => {
  const state = isRecord(data.state) ? data.state : {};
  if (state.started !== true) return false;
  if (state.finished !== true) return true;
  return containerSize(data.prop_bets) < containerSize(data.participants);
};

/** Where each kind stores a castaway id next to a name. */
const NAMED_FIELD: Partial<Record<RemapDocKind, [string, string]>> = {
  competition: ["draft_picks", "player_name"],
  rtdb_draft: ["draft_picks", "player_name"],
  pool_config: ["roster", "full_name"],
  pool_entry: ["picks", "full_name"],
  season: ["players", "full_name"],
};

/** Result fields that must never be embedded in a season document. */
const EMBEDDED_RESULT_FIELDS = [
  "challenges",
  "eliminations",
  "events",
  "vote_history",
];

/**
 * Every place a changed castaway id appears in a document: string values
 * (`draft_picks.1.castaway_id`) and object keys (`castawayLookup#US0754`).
 */
const idTokens = (
  data: Record<string, unknown>,
  ids: ReadonlySet<string>,
): string[] => {
  const out: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (typeof v === "string") {
      if (ids.has(v)) out.push(at);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${at}.${i}`));
    } else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (ids.has(k)) out.push(`${at}#${k}`);
        walk(x, `${at}.${k}`);
      }
    }
  };
  for (const [k, v] of Object.entries(data)) {
    if (k === RTDB_REMAP_MARKER) continue;
    if (ids.has(k)) out.push(`#${k}`);
    walk(v, k);
  }
  return out;
};

/** Positions the remap reads a name for. */
const isNamedPosition = (p: string): boolean =>
  /^(draft_picks|roster|picks|players)\.[^.#]+\.castaway_id$/.test(p) ||
  /^castawayLookup#US\d{4}$/.test(p);

/** Positions the remap knows how to move, per kind. Anything else refuses. */
const isKnownPosition = (
  kind: RemapDocKind,
  p: string,
  keys: ReadonlySet<string>,
): boolean => {
  const key = (re: RegExp) => {
    const m = re.exec(p);
    return m !== null && keys.has(m[1]);
  };
  switch (kind) {
    case "competition":
    case "rtdb_draft":
      return (
        /^draft_picks\.[^.#]+\.castaway_id$/.test(p) ||
        key(/^prop_bets\.[^.#]+\.values\.([^.#]+)$/)
      );
    case "trade":
      return /^(offered|requested)_castaway_ids\.\d+$/.test(p);
    case "pool_config":
      return (
        /^roster\.[^.#]+\.castaway_id$/.test(p) ||
        /^prop_bet_answers\.\d+$/.test(p)
      );
    case "pool_entry":
      return (
        /^picks\.[^.#]+\.castaway_id$/.test(p) || key(/^prop_bets\.([^.#]+)$/)
      );
    case "season":
      return (
        /^players\.[^.#]+\.castaway_id$/.test(p) ||
        /^castawayLookup#US\d{4}$/.test(p)
      );
    case "team_assignments":
      return /^[^.#]+#US\d{4}$/.test(p);
    case "castaway_adp":
      return /^castaways#US\d{4}$/.test(p);
    case "season_results":
      return false;
  }
};

const APPLY_RANK: Partial<Record<RemapDocKind, number>> = {
  season: 0,
  pool_config: 1,
};

/** Born documents are classified parents first. */
const CLASSIFY_RANK: Partial<Record<RemapDocKind, number>> = {
  rtdb_draft: 0,
  competition: 1,
  trade: 2,
};

/**
 * Plan the field-level changes for every document.
 *
 * Only castaway-bearing fields are touched: `draft_picks` and `prop_bets` on
 * competitions and RTDB drafts, the two id arrays on trades, `roster` and
 * `prop_bet_answers` on the pool config, `picks` and `prop_bets` on pool
 * entries, `players` and `castawayLookup` on the season document, the id keys
 * of `team_assignments` snapshots and of ADP `castaways`. A changed id found
 * anywhere else refuses the document.
 *
 * Named picks move only when their name proves they are provisional, so a
 * pick taken on survivoR's ids is never moved twice. Ids stored without a
 * name (prop bets, trades, ADP keys) move only in a document that existed
 * when the cutover began and is not yet marked. A document created later is
 * classified from its names, its parent draft or competition, and its
 * rosters, and is marked but never remapped.
 */
export function planDocumentRemap(
  docs: readonly RemapSourceDoc[],
  {
    mappings,
    mappingHash: hash,
    castawayPropBetKeys: keys,
    ledger,
    census = null,
    acceptBorn = new Set(),
  }: PlanDocumentsOptions,
): RemapDocumentPlan {
  const byFrom = new Map(mappings.map((m) => [m.from, m]));
  const byTo = new Map(mappings.map((m) => [m.to, m]));
  const idMap = new Map(mappings.map((m) => [m.from, m.to]));
  const changedIds = new Set(
    mappings.filter((m) => m.from !== m.to).map((m) => m.from),
  );
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const index = new Map(docs.map((d, i) => [d.path, i]));

  const sideOf = (p: Pair): PairSide => {
    const n = normalize(p.name);
    const old = normalize(byFrom.get(p.id)?.from_name ?? "\0") === n;
    const neu = normalize(byTo.get(p.id)?.to_name ?? "\0") === n;
    return old && neu ? "both" : old ? "old" : neu ? "new" : "neither";
  };

  const pairOf = (item: Record<string, unknown>, nameField: string): Pair => ({
    id: String(item.castaway_id),
    name: typeof item[nameField] === "string" ? String(item[nameField]) : "",
    owner: typeof item.user_uid === "string" ? item.user_uid : undefined,
  });

  const namedPairs = (kind: RemapDocKind, d: Record<string, unknown>) => {
    const spec = NAMED_FIELD[kind];
    const pairs: Pair[] = [];
    if (spec) {
      for (const [, item] of containerEntries(d[spec[0]])) {
        if (isRecord(item)) pairs.push(pairOf(item, spec[1]));
      }
    }
    if (kind === "season" && isRecord(d.castawayLookup)) {
      for (const [id, v] of Object.entries(d.castawayLookup)) {
        pairs.push({
          id,
          name:
            isRecord(v) && typeof v.full_name === "string" ? v.full_name : "",
        });
      }
    }
    return pairs;
  };

  const hasChangedAnswer = (values: unknown) =>
    isRecord(values) &&
    Object.entries(values).some(
      ([k, v]) => keys.has(k) && typeof v === "string" && changedIds.has(v),
    );

  /**
   * The document's castaway fields, with named picks moved when their name
   * reads provisional, and (when `nameless`) every nameless id moved too.
   */
  const transform = (
    kind: RemapDocKind,
    d: Record<string, unknown>,
    nameless: boolean,
  ) => {
    const unknown: string[] = [];
    let idChanges = 0;
    const mapId = (id: unknown, where: string): unknown => {
      if (typeof id !== "string") return id;
      const to = idMap.get(id);
      if (to === undefined) {
        unknown.push(`${where}: ${id} is not in the mapping`);
        return id;
      }
      if (to !== id) idChanges++;
      return to;
    };
    const mapKeys = (v: unknown, where: string) =>
      isRecord(v)
        ? Object.fromEntries(
            Object.entries(v).map(([k, val]) => [
              /^US\d{4}$/.test(k) ? (mapId(k, `${where}.${k}`) as string) : k,
              val,
            ]),
          )
        : v;
    const mapPropBetValues = (values: unknown, where: string): unknown => {
      if (!isRecord(values)) return values;
      const out: Record<string, unknown> = { ...values };
      for (const key of Object.keys(values)) {
        if (keys.has(key)) out[key] = mapId(values[key], `${where}.${key}`);
      }
      return out;
    };
    const mapNamed = (
      item: Record<string, unknown>,
      nameField: string,
      where: string,
    ) => {
      if (sideOf(pairOf(item, nameField)) !== "old") return item;
      const to = mapId(item.castaway_id, where) as string;
      return { ...item, castaway_id: to, [nameField]: byTo.get(to)!.to_name };
    };
    const named = (field: string, nameField: string) =>
      mapContainer(d[field], (p, k) =>
        isRecord(p) ? mapNamed(p, nameField, `${field}[${k}]`) : p,
      );

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const set = (field: string, next: unknown) => {
      before[field] = d[field] ?? null;
      after[field] = next ?? null;
    };

    switch (kind) {
      case "competition":
      case "rtdb_draft":
        set("draft_picks", named("draft_picks", "player_name"));
        set(
          "prop_bets",
          nameless
            ? mapContainer(d.prop_bets, (e, k) =>
                isRecord(e)
                  ? {
                      ...e,
                      values: mapPropBetValues(
                        e.values,
                        `prop_bets[${k}].values`,
                      ),
                    }
                  : e,
              )
            : d.prop_bets,
        );
        break;
      case "trade":
        for (const field of [
          "offered_castaway_ids",
          "requested_castaway_ids",
        ]) {
          set(
            field,
            nameless
              ? mapContainer(d[field], (id, k) => mapId(id, `${field}[${k}]`))
              : d[field],
          );
        }
        break;
      case "pool_config":
        set("roster", named("roster", "full_name"));
        set(
          "prop_bet_answers",
          nameless
            ? mapContainer(d.prop_bet_answers, (v) =>
                typeof v === "string" && /^US\d{4}$/.test(v)
                  ? mapId(v, "prop_bet_answers")
                  : v,
              )
            : d.prop_bet_answers,
        );
        break;
      case "pool_entry":
        set("picks", named("picks", "full_name"));
        set(
          "prop_bets",
          nameless ? mapPropBetValues(d.prop_bets, "prop_bets") : d.prop_bets,
        );
        break;
      case "season":
        set("players", named("players", "full_name"));
        set(
          "castawayLookup",
          isRecord(d.castawayLookup)
            ? Object.entries(d.castawayLookup).map(([id, v]) => {
                const name =
                  isRecord(v) && typeof v.full_name === "string"
                    ? v.full_name
                    : "";
                if (sideOf({ id, name }) !== "old") return [id, v];
                const to = mapId(id, `castawayLookup.${id}`) as string;
                const m = byTo.get(to)!;
                return [
                  to,
                  isRecord(v)
                    ? { ...v, full_name: m.to_name, castaway: m.to_castaway }
                    : v,
                ];
              })
            : d.castawayLookup,
        );
        break;
      case "team_assignments":
        for (const [episode, snapshot] of Object.entries(d)) {
          if (episode === RTDB_REMAP_MARKER) continue;
          set(episode, nameless ? mapKeys(snapshot, episode) : snapshot);
        }
        break;
      case "castaway_adp":
        set(
          "castaways",
          nameless ? mapKeys(d.castaways, "castaways") : d.castaways,
        );
        break;
      case "season_results":
        break;
    }

    // castawayLookup is built as entries so a key collision is visible here
    // rather than silently dropped by Object.fromEntries.
    const duplicates: string[] = [];
    const seen = (ids: unknown[], where: string) => {
      const counts = new Map<unknown, number>();
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, n] of counts) {
        if (n > 1) duplicates.push(`${where}: ${String(id)} x${n}`);
      }
    };
    const spec = NAMED_FIELD[kind];
    if (spec) {
      seen(
        containerEntries(after[spec[0]])
          .map(([, x]) => x)
          .filter(isRecord)
          .map((x) => x.castaway_id),
        spec[0],
      );
    }
    if (kind === "season" && Array.isArray(after.castawayLookup)) {
      const entries = after.castawayLookup as [string, unknown][];
      seen(
        entries.map(([id]) => id),
        "castawayLookup",
      );
      before.castawayLookup = d.castawayLookup ?? null;
      after.castawayLookup = Object.fromEntries(entries);
    }
    return { before, after, idChanges, unknown, duplicates };
  };

  const changes: [number, RemapDocChange][] = [];
  const lists = {
    unchanged: [] as string[],
    already_applied: [] as string[],
    live_drafts: [] as string[],
    born_pending: [] as string[],
  };
  const problems: RemapProblem[] = [];
  const bornNew = new Set<string>();

  const problem = (
    doc: RemapSourceDoc,
    reason: RemapProblemReason,
    detail: string,
  ) =>
    problems.push({
      path: doc.path,
      reason,
      detail,
      scope:
        reason === "season_results_present" ||
        reason === "applied_with_other_mapping" ||
        doc.kind === "season" ||
        doc.kind === "pool_config"
          ? "global"
          : "document",
    });
  const change = (
    doc: RemapSourceDoc,
    mode: RemapChangeMode,
    r: { before: Record<string, unknown>; after: Record<string, unknown> },
    idChanges: number,
  ) =>
    changes.push([
      index.get(doc.path)!,
      {
        kind: doc.kind,
        path: doc.path,
        mode,
        before: r.before,
        after: mode === "born" ? structuredClone(r.before) : r.after,
        id_changes: idChanges,
      },
    ]);

  /** Whether a document is on survivoR's ids: marked, or born and shown so. */
  const isNewEpoch = (p: string) => {
    const doc = byPath.get(p);
    return (
      doc !== undefined &&
      (appliedHashOf(doc, ledger) === hash || bornNew.has(p))
    );
  };
  const isPreexisting = (p: string) => census === null || census.has(p);

  /** Castaways each participant ever held in a competition, on survivoR's ids. */
  const everOwned = (competitionPath: string, exceptTrade: string) => {
    const owned = new Map<string, Set<string>>();
    const add = (uid: unknown, id: unknown) => {
      if (typeof uid !== "string" || typeof id !== "string") return;
      if (!owned.has(uid)) owned.set(uid, new Set());
      owned.get(uid)!.add(id);
    };
    const comp = byPath.get(competitionPath)!.data;
    for (const [, p] of containerEntries(comp.draft_picks)) {
      if (isRecord(p)) add(p.user_uid, p.castaway_id);
    }
    for (const t of docs) {
      if (
        t.kind !== "trade" ||
        t.path === exceptTrade ||
        !t.path.startsWith(`${competitionPath}/trades/`) ||
        t.data.status !== "accepted"
      ) {
        continue;
      }
      // A sibling's ids are read as survivoR's once it is marked, as
      // provisional while it waits for its remap, and both ways when it is
      // itself unclassified: more ownership only makes evidence weaker.
      const reads = (id: unknown): unknown[] =>
        isNewEpoch(t.path)
          ? [id]
          : isPreexisting(t.path)
            ? [idMap.get(String(id))]
            : [id, idMap.get(String(id))];
      for (const [, id] of containerEntries(t.data.offered_castaway_ids)) {
        for (const r of reads(id)) add(t.data.offered_to_uid, r);
      }
      for (const [, id] of containerEntries(t.data.requested_castaway_ids)) {
        for (const r of reads(id)) add(t.data.offered_by_uid, r);
      }
    }
    return owned;
  };

  const classifyBorn = (
    doc: RemapSourceDoc,
    pairs: Pair[],
    sides: PairSide[],
  ) => {
    const d = doc.data;
    const guard = transform(doc.kind, d, false);
    if (doc.kind === "season" || doc.kind === "pool_config") {
      return problem(
        doc,
        "born_not_new",
        "created after the cutover began; the season document and pool config must exist before it",
      );
    }
    if (sides.includes("old")) {
      return problem(
        doc,
        "born_not_new",
        "created after the cutover began, with provisional names (a client still on the old season document); not remapped automatically",
      );
    }
    const probe = transform(doc.kind, d, true);
    if (probe.unknown.length > 0) {
      return problem(doc, "unknown_castaway_id", probe.unknown.join("; "));
    }
    if (guard.duplicates.length > 0) {
      return problem(doc, "duplicate_castaway", guard.duplicates.join("; "));
    }
    const accept = (ambiguous: string | null) => {
      if (ambiguous !== null && !acceptBorn.has(doc.path)) {
        return problem(doc, "born_ambiguous", ambiguous);
      }
      bornNew.add(doc.path);
      change(doc, "born", guard, 0);
    };

    // Nothing in these can say which ids they use. Only a person who knows
    // who wrote them can, so they wait for an explicit --accept-born rather
    // than dead-ending --finalize.
    if (doc.kind === "team_assignments" || doc.kind === "castaway_adp") {
      return accept(
        "created after the cutover began, with no names or parent to classify it by; confirm who wrote it and on which ids, then --accept-born",
      );
    }

    if (doc.kind === "trade") {
      const parent = doc.path.split("/trades/")[0];
      if (!isNewEpoch(parent)) {
        return problem(
          doc,
          "parent_unresolved",
          `its competition ${parent} is not yet on survivoR's ids`,
        );
      }
      const owned = everOwned(parent, doc.path);
      const ids = (field: string) =>
        containerEntries(d[field]).map(([, id]) => String(id));
      const offered = ids("offered_castaway_ids");
      const requested = ids("requested_castaway_ids");
      const holds = (read: (id: string) => string | undefined) =>
        offered.every((id) =>
          owned.get(String(d.offered_by_uid))?.has(read(id) ?? "\0"),
        ) &&
        requested.every((id) =>
          owned.get(String(d.offered_to_uid))?.has(read(id) ?? "\0"),
        );
      const asNew = holds((id) => id);
      const asOld = holds((id) => idMap.get(id));
      const anyChanged = [...offered, ...requested].some((id) =>
        changedIds.has(id),
      );
      if (asNew && (!asOld || !anyChanged)) return accept(null);
      if (asNew) {
        return accept(
          "its castaways fit the competition's rosters read either way; confirm when it was made, then --accept-born",
        );
      }
      return problem(
        doc,
        "born_not_new",
        asOld
          ? "its castaways fit the rosters only as provisional ids (a client still on the old season document); not remapped automatically"
          : "its castaways fit neither side's rosters",
      );
    }

    if (pairs.length === 0) return void lists.born_pending.push(doc.path);
    if (doc.kind === "rtdb_draft" && isLiveDraft(d)) {
      return void lists.born_pending.push(doc.path);
    }

    // Prop bets store ids without names. Each entry that answers with a
    // changed id needs its own user's pick on survivoR's ids as evidence.
    let ambiguous: string | null = null;
    const newPickBy = (uid: string | undefined) =>
      pairs.some(
        (p, i) => sides[i] === "new" && (uid === undefined || p.owner === uid),
      );
    if (doc.kind === "pool_entry") {
      if (hasChangedAnswer(d.prop_bets) && !newPickBy(undefined)) {
        ambiguous =
          "prop bets answer with changed ids but no pick shows survivoR's ids";
      }
    } else {
      const unproven = propBetEntries(d.prop_bets)
        .filter(([uid, e]) => hasChangedAnswer(e.values) && !newPickBy(uid))
        .map(([uid]) => uid);
      if (unproven.length > 0) {
        ambiguous = `prop bets of ${unproven.length} user(s) answer with changed ids but their picks do not show survivoR's ids`;
      }
    }

    if (doc.kind === "competition") {
      const parent = `drafts/${String(d.draft_id)}`;
      if (!byPath.has(parent)) {
        // Deleted (for instance by the abandoned-draft cleanup), so its
        // prop bets cannot be checked against it. Its names already read
        // survivoR's; a person confirms the rest.
        return accept(
          `its draft ${parent} is gone, so its prop bets cannot be checked; confirm with its members, then --accept-born`,
        );
      }
      if (!isNewEpoch(parent)) {
        return problem(
          doc,
          "parent_unresolved",
          `its draft ${parent} is not yet on survivoR's ids`,
        );
      }
      const shape = (data: Record<string, unknown>) => ({
        picks: containerEntries(data.draft_picks)
          .map(([, p]) => p)
          .filter(isRecord)
          .map((p) => `${String(p.order)}:${String(p.castaway_id)}`)
          .sort(),
        prop_bets: Object.fromEntries(
          propBetEntries(data.prop_bets).map(([uid, e]) => [
            uid,
            Object.fromEntries(
              Object.entries(isRecord(e.values) ? e.values : {}).filter(([k]) =>
                keys.has(k),
              ),
            ),
          ]),
        ),
      });
      if (!isDeepStrictEqual(shape(d), shape(byPath.get(parent)!.data))) {
        return problem(
          doc,
          "born_not_new",
          `its picks or prop bets differ from its draft ${parent}`,
        );
      }
      // Its draft proves the prop bets, whatever this copy's picks show.
      ambiguous = null;
    }
    accept(ambiguous);
  };

  const ordered = [...docs].sort(
    (a, b) =>
      (CLASSIFY_RANK[a.kind] ?? 3) - (CLASSIFY_RANK[b.kind] ?? 3) ||
      index.get(a.path)! - index.get(b.path)!,
  );

  for (const doc of ordered) {
    const d = doc.data;
    if (doc.kind === "rtdb_draft" && isLiveDraft(d)) {
      lists.live_drafts.push(doc.path);
    }

    if (doc.kind === "season_results") {
      if (Object.keys(d).length > 0) {
        problem(
          doc,
          "season_results_present",
          "results are keyed by castaway id and must be regenerated from survivoR, not remapped; stop and plan that separately",
        );
      } else {
        lists.unchanged.push(doc.path);
      }
      continue;
    }
    if (doc.kind === "season") {
      const embedded = EMBEDDED_RESULT_FIELDS.filter(
        (f) => d[f] != null && containerSize(d[f]) > 0,
      );
      if (embedded.length > 0) {
        problem(
          doc,
          "season_results_present",
          `the season document embeds ${embedded.join(", ")}; results must be regenerated from survivoR, not remapped`,
        );
        continue;
      }
    }

    const appliedHash = appliedHashOf(doc, ledger);
    if (appliedHash !== undefined && appliedHash !== hash) {
      problem(
        doc,
        "applied_with_other_mapping",
        `marked applied under mapping ${appliedHash}, not ${hash}`,
      );
      continue;
    }

    const tokens = idTokens(d, changedIds);
    const unhandled = tokens.filter((p) => !isKnownPosition(doc.kind, p, keys));
    if (unhandled.length > 0) {
      problem(
        doc,
        "unhandled_castaway_field",
        `castaway ids where the remap does not look: ${unhandled.slice(0, 5).join(", ")}${unhandled.length > 5 ? ", ..." : ""}`,
      );
      continue;
    }

    const pairs = namedPairs(doc.kind, d);
    const sides = pairs.map(sideOf);
    if (sides.includes("neither")) {
      problem(
        doc,
        "name_mismatch",
        pairs
          .filter((_, i) => sides[i] === "neither")
          .map(
            (p) =>
              `${p.id} stored as "${p.name}", provisional "${byFrom.get(p.id)?.from_name ?? "?"}", survivoR "${byTo.get(p.id)?.to_name ?? "?"}"`,
          )
          .join("; "),
      );
      continue;
    }

    if (appliedHash !== undefined) {
      // Marked: named picks still on provisional pairs were taken by a
      // client on the old season document, and are repaired by name.
      // Nameless ids are survivoR's by now and never move again.
      const r = transform(doc.kind, d, false);
      if (r.unknown.length > 0) {
        problem(doc, "unknown_castaway_id", r.unknown.join("; "));
      } else if (r.duplicates.length > 0) {
        problem(
          doc,
          "duplicate_castaway",
          `repairing by name would give ${r.duplicates.join("; ")}; resolve by hand`,
        );
      } else if (!isDeepStrictEqual(r.before, r.after)) {
        change(doc, "repair", r, r.idChanges);
      } else {
        lists.already_applied.push(doc.path);
      }
      continue;
    }

    if (!isPreexisting(doc.path)) {
      classifyBorn(doc, pairs, sides);
      continue;
    }

    // Pre-existing and not yet marked.
    const hasNew = sides.includes("new");
    const namelessChanged = tokens.filter((p) => !isNamedPosition(p)).length;
    if (hasNew && census === null) {
      problem(
        doc,
        sides.every((s) => s === "new" || s === "both")
          ? "looks_already_remapped"
          : "mixed_old_and_new",
        "stored names already match survivoR's ids but no cutover has begun; not remapping",
      );
      continue;
    }
    if (hasNew && namelessChanged > 0) {
      problem(
        doc,
        "mixed_old_and_new",
        "some picks were taken on survivoR's ids before this document was remapped, so ids stored without names cannot be placed",
      );
      continue;
    }
    if (doc.kind === "rtdb_draft" && census !== null) {
      const known = new Set(census.get(doc.path)?.prop_bet_uids ?? []);
      const late = propBetEntries(d.prop_bets).filter(
        ([uid, e]) => !known.has(uid) && hasChangedAnswer(e.values),
      );
      if (late.length > 0) {
        problem(
          doc,
          "prop_bet_epoch_unknown",
          `${late.length} prop bet entr${late.length === 1 ? "y was" : "ies were"} submitted after the cutover began and before this draft was remapped; which ids they use cannot be told`,
        );
        continue;
      }
    }
    const r = transform(doc.kind, d, true);
    if (r.unknown.length > 0) {
      problem(doc, "unknown_castaway_id", r.unknown.join("; "));
    } else if (r.duplicates.length > 0) {
      problem(doc, "duplicate_castaway", r.duplicates.join("; "));
    } else {
      change(doc, "remap", r, r.idChanges);
    }
  }

  const byIndex = (paths: string[]) =>
    [...paths].sort((a, b) => index.get(a)! - index.get(b)!);
  return {
    changes: changes
      .sort(
        ([ia, a], [ib, b]) =>
          (APPLY_RANK[a.kind] ?? 2) - (APPLY_RANK[b.kind] ?? 2) || ia - ib,
      )
      .map(([, c]) => c),
    unchanged: byIndex(lists.unchanged),
    already_applied: byIndex(lists.already_applied),
    problems: problems.sort((a, b) => index.get(a.path)! - index.get(b.path)!),
    live_drafts: byIndex(lists.live_drafts),
    born_pending: byIndex(lists.born_pending),
  };
}

/* ------------------------------------------------------------------ *
 * Apply and rollback
 * ------------------------------------------------------------------ */

/**
 * The applied-mark transition a write makes, atomically with its fields:
 * `set` marks the document applied (it must not be marked yet), `keep`
 * requires the existing mark (repairs), `clear` requires and removes it
 * (rollback), `absent` requires there is none and leaves it so. With
 * `expected` equal to `next`, `keep` and `absent` write nothing: they probe
 * whether a document already holds a state.
 */
export type RemapMark = "set" | "keep" | "clear" | "absent";

/**
 * The storage the remap writes through. `compareAndSet` must be atomic per
 * document: check every `expected` field (deep equality, key order
 * irrelevant) and the mark, then write the fields of `next` that differ from
 * `expected` and the mark transition in the same transaction, or write
 * nothing and return false.
 */
export type RemapStore = {
  compareAndSet(
    change: Pick<RemapDocChange, "kind" | "path" | "mode">,
    expected: Record<string, unknown>,
    next: Record<string, unknown>,
    mark: RemapMark,
  ): Promise<boolean>;
};

export type RemapApplyResult = {
  applied: string[];
  /** Documents that changed after the plan was made; re-plan and retry. */
  stale: string[];
  /**
   * Documents that already held the target state (and mark), so a rerun of
   * the same plan treats them as done rather than stale.
   */
  already: string[];
  /**
   * Documents not attempted because a prerequisite failed: nothing moves
   * after a season document or pool config that did not apply, and neither is
   * rolled back while anything rolled back before it failed.
   */
  skipped: string[];
};

/**
 * Kinds every other document depends on: clients read castaway ids from the
 * season document, and pool entries from the pool config.
 */
const isPrerequisite = (c: Pick<RemapDocChange, "kind">) =>
  c.kind === "season" || c.kind === "pool_config";

/** Prerequisites must lead a plan; anything else is a tampered plan. */
const assertPrerequisitesFirst = (changes: readonly RemapDocChange[]) => {
  const firstOther = changes.findIndex((c) => !isPrerequisite(c));
  if (
    firstOther !== -1 &&
    changes.slice(firstOther).some((c) => isPrerequisite(c))
  ) {
    throw new Error(
      "The plan does not put the season document and pool config first",
    );
  }
};

/**
 * Apply planned changes one document at a time, in plan order: the season
 * document first, then the pool config, so clients switch to survivoR's ids
 * before anything else moves. If either of those does not apply (stale, or
 * refused), nothing after it is attempted: remapping picks while clients
 * still read the old season document would invite unplaceable prop bets.
 * Any other document that moved on since the plan is skipped as stale rather
 * than overwritten; a fresh dry run plans it again. Because the mark is
 * written in the same transaction as the fields, an interrupted run leaves
 * every document either fully remapped and marked, or untouched and unmarked.
 */
export async function applyCastawayIdRemap(
  changes: readonly RemapDocChange[],
  store: RemapStore,
): Promise<RemapApplyResult> {
  assertPrerequisitesFirst(changes);
  const result: RemapApplyResult = {
    applied: [],
    stale: [],
    already: [],
    skipped: [],
  };
  for (const [i, change] of changes.entries()) {
    const ok = await store.compareAndSet(
      change,
      change.before,
      change.after,
      change.mode === "repair" ? "keep" : "set",
    );
    // Not applied: done already (a rerun of this plan), or truly stale.
    const done =
      !ok &&
      (await store.compareAndSet(change, change.after, change.after, "keep"));
    (ok ? result.applied : done ? result.already : result.stale).push(
      change.path,
    );
    if (!ok && !done && isPrerequisite(change)) {
      result.skipped.push(...changes.slice(i + 1).map((c) => c.path));
      break;
    }
  }
  return result;
}

/**
 * Undo one plan's changes, in reverse order, only where each document still
 * holds that plan's `after`. The season document and pool config come last,
 * and are not touched at all if anything rolled back before them did not
 * restore: switching clients back to provisional ids while some documents
 * still hold survivoR's would mix the two. Roll plans back newest first.
 */
export async function rollbackCastawayIdRemap(
  changes: readonly RemapDocChange[],
  store: RemapStore,
): Promise<RemapApplyResult> {
  assertPrerequisitesFirst(changes);
  const result: RemapApplyResult = {
    applied: [],
    stale: [],
    already: [],
    skipped: [],
  };
  const reversed = [...changes].reverse();
  for (const [i, change] of reversed.entries()) {
    if (isPrerequisite(change) && result.stale.length > 0) {
      result.skipped.push(...reversed.slice(i).map((c) => c.path));
      break;
    }
    const ok = await store.compareAndSet(
      change,
      change.after,
      change.before,
      change.mode === "repair" ? "keep" : "clear",
    );
    // Not restored: restored already (a rerun after a stop), or truly stale.
    const done =
      !ok &&
      (await store.compareAndSet(
        change,
        change.before,
        change.before,
        change.mode === "repair" ? "keep" : "absent",
      ));
    (ok ? result.applied : done ? result.already : result.stale).push(
      change.path,
    );
  }
  return result;
}

/** Deep equality of the named fields, ignoring object key order. */
export const fieldsEqual = (
  current: Record<string, unknown> | null | undefined,
  expected: Record<string, unknown>,
): boolean =>
  Object.entries(expected).every(([k, v]) =>
    isDeepStrictEqual(current?.[k] ?? null, v ?? null),
  );

/** The fields of `next` that differ from `expected`: all a write stores. */
export const changedFields = (
  expected: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(next).filter(
      ([k, v]) => !isDeepStrictEqual(expected[k] ?? null, v ?? null),
    ),
  );
