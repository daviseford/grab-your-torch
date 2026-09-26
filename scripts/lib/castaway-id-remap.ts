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
 *    same RTDB node), and a document without a mark is always read as
 *    provisional.
 * 3. Where the schema stores a name next to the id (draft picks, pool picks,
 *    season players), the name is cross-checked against both casts. That
 *    catches a document edited with the other side's ids, and lets a pick
 *    taken mid-cutover be repaired by name, which ids alone could never prove.
 *
 * The mapping itself is committed (`scripts/castaway-id-remaps/`), pinned to
 * a survivoR commit and hashed, so every dry run, write and rollback uses the
 * exact mapping that was reviewed.
 *
 * Everything here is pure except `applyCastawayIdRemap` and
 * `rollbackCastawayIdRemap`, which go through the small `RemapStore`
 * interface so they can be tested without Firebase.
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

/** A field-level change: only these fields are compared and written. */
export type RemapDocChange = {
  kind: RemapDocKind;
  path: string;
  /**
   * `remap`: the whole document, provisional to survivoR, marks it applied.
   * `repair`: an already-applied document where some named picks still carry
   * provisional pairs (taken mid-cutover); only those picks change.
   */
  mode: "remap" | "repair";
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
  | "season_results_present";

export type RemapProblem = {
  path: string;
  reason: RemapProblemReason;
  detail: string;
};

export type RemapDocumentPlan = {
  changes: RemapDocChange[];
  /** Documents that need no change (no remapped ids in them). */
  unchanged: string[];
  /** Documents already marked applied with this mapping, and consistent. */
  already_applied: string[];
  problems: RemapProblem[];
  /**
   * RTDB drafts users can still write castaway ids into: started and not
   * finished, or finished with prop bets still to come. A write refuses
   * while any exist unless each is acknowledged.
   */
  live_drafts: string[];
};

/** RTDB marker stored inside a remapped draft node, written atomically. */
export const RTDB_REMAP_MARKER = "castaway_id_remap";

type Pair = { id: string; name: string };
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

const containerSize = (v: unknown): number =>
  Array.isArray(v)
    ? v.filter((x) => x != null).length
    : isRecord(v)
      ? Object.values(v).filter((x) => x != null).length
      : 0;

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

/**
 * Plan the field-level changes for every document.
 *
 * Only castaway-bearing fields are touched: `draft_picks` and `prop_bets` on
 * competitions and RTDB drafts, the two id arrays on trades, `roster` and
 * `prop_bet_answers` on the pool config, `picks` and `prop_bets` on pool
 * entries, `players` and `castawayLookup` on the season document, the id keys
 * of `team_assignments` snapshots and of ADP `castaways`. Names travel with
 * ids where the schema stores them and are rewritten to survivoR's.
 */
export function planDocumentRemap(
  docs: readonly RemapSourceDoc[],
  {
    mappings,
    mappingHash: hash,
    castawayPropBetKeys,
    ledger,
  }: PlanDocumentsOptions,
): RemapDocumentPlan {
  const byFrom = new Map(mappings.map((m) => [m.from, m]));
  const byTo = new Map(mappings.map((m) => [m.to, m]));
  const idMap = new Map(mappings.map((m) => [m.from, m.to]));

  const plan: RemapDocumentPlan = {
    changes: [],
    unchanged: [],
    already_applied: [],
    problems: [],
    live_drafts: [],
  };

  const sideOf = (p: Pair): PairSide => {
    const n = normalize(p.name);
    const old = normalize(byFrom.get(p.id)?.from_name ?? "\0") === n;
    const neu = normalize(byTo.get(p.id)?.to_name ?? "\0") === n;
    return old && neu ? "both" : old ? "old" : neu ? "new" : "neither";
  };

  for (const doc of docs) {
    const d = doc.data;
    if (doc.kind === "rtdb_draft" && isLiveDraft(d)) {
      plan.live_drafts.push(doc.path);
    }

    if (doc.kind === "season_results") {
      if (Object.keys(d).length > 0) {
        plan.problems.push({
          path: doc.path,
          reason: "season_results_present",
          detail:
            "results are keyed by castaway id and must be regenerated from survivoR, not remapped; stop and plan that separately",
        });
      } else {
        plan.unchanged.push(doc.path);
      }
      continue;
    }

    const appliedHash = appliedHashOf(doc, ledger);
    if (appliedHash !== undefined && appliedHash !== hash) {
      plan.problems.push({
        path: doc.path,
        reason: "applied_with_other_mapping",
        detail: `marked applied under mapping ${appliedHash}, not ${hash}`,
      });
      continue;
    }
    const applied = appliedHash !== undefined;

    // In `repair` mode only named picks whose pair reads provisional move.
    // In `remap` mode every id moves, named or not.
    const run = (mode: "remap" | "repair") => {
      const problems: RemapProblem[] = [];
      const pairs: Pair[] = [];
      let idChanges = 0;

      const mapId = (id: unknown, where: string): unknown => {
        if (typeof id !== "string") return id;
        if (!idMap.has(id)) {
          problems.push({
            path: doc.path,
            reason: "unknown_castaway_id",
            detail: `${where}: ${id} is not in the mapping`,
          });
          return id;
        }
        const to = idMap.get(id)!;
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
          if (castawayPropBetKeys.has(key)) {
            out[key] = mapId(values[key], `${where}.${key}`);
          }
        }
        return out;
      };
      /** A named pick: remap it (remap mode) or only if it reads old (repair). */
      const mapNamed = (
        item: Record<string, unknown>,
        nameField: string,
        where: string,
        extra?: (to: CastawayIdMapping) => Record<string, unknown>,
      ) => {
        const pair = {
          id: String(item.castaway_id),
          name:
            typeof item[nameField] === "string" ? String(item[nameField]) : "",
        };
        pairs.push(pair);
        if (mode === "repair" && sideOf(pair) !== "old") return item;
        const to = mapId(item.castaway_id, where);
        const m = typeof to === "string" ? byTo.get(to) : undefined;
        return m
          ? { ...item, castaway_id: to, [nameField]: m.to_name, ...extra?.(m) }
          : { ...item, castaway_id: to };
      };

      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const set = (field: string, next: unknown) => {
        if (d[field] === undefined) return;
        before[field] = d[field];
        after[field] = next;
      };

      switch (doc.kind) {
        case "competition":
        case "rtdb_draft":
          set(
            "draft_picks",
            mapContainer(d.draft_picks, (p, k) =>
              isRecord(p) ? mapNamed(p, "player_name", `draft_picks[${k}]`) : p,
            ),
          );
          if (mode === "remap") {
            set(
              "prop_bets",
              mapContainer(d.prop_bets, (e, k) =>
                isRecord(e)
                  ? {
                      ...e,
                      values: mapPropBetValues(
                        e.values,
                        `prop_bets[${k}].values`,
                      ),
                    }
                  : e,
              ),
            );
          }
          break;
        case "trade":
          if (mode === "remap") {
            for (const field of [
              "offered_castaway_ids",
              "requested_castaway_ids",
            ]) {
              set(
                field,
                mapContainer(d[field], (id, k) => mapId(id, `${field}[${k}]`)),
              );
            }
          }
          break;
        case "pool_config":
        case "pool_entry": {
          const field = doc.kind === "pool_config" ? "roster" : "picks";
          set(
            field,
            mapContainer(d[field], (p, k) =>
              isRecord(p) ? mapNamed(p, "full_name", `${field}[${k}]`) : p,
            ),
          );
          if (mode === "remap" && doc.kind === "pool_config") {
            set(
              "prop_bet_answers",
              mapContainer(d.prop_bet_answers, (v) =>
                typeof v === "string" && /^US\d{4}$/.test(v)
                  ? mapId(v, "prop_bet_answers")
                  : v,
              ),
            );
          }
          if (mode === "remap" && doc.kind === "pool_entry") {
            set("prop_bets", mapPropBetValues(d.prop_bets, "prop_bets"));
          }
          break;
        }
        case "season":
          set(
            "players",
            mapContainer(d.players, (p, k) =>
              isRecord(p) ? mapNamed(p, "full_name", `players[${k}]`) : p,
            ),
          );
          if (mode === "remap" && isRecord(d.castawayLookup)) {
            set(
              "castawayLookup",
              Object.fromEntries(
                Object.entries(d.castawayLookup).map(([k, v]) => {
                  const to = mapId(k, `castawayLookup.${k}`) as string;
                  const m = byTo.get(to);
                  return [
                    to,
                    m && isRecord(v)
                      ? { ...v, full_name: m.to_name, castaway: m.to_castaway }
                      : v,
                  ];
                }),
              ),
            );
          }
          break;
        case "team_assignments":
          if (mode === "remap") {
            for (const [episode, snapshot] of Object.entries(d)) {
              set(episode, mapKeys(snapshot, episode));
            }
          }
          break;
        case "castaway_adp":
          if (mode === "remap")
            set("castaways", mapKeys(d.castaways, "castaways"));
          break;
      }
      return { before, after, pairs, problems, idChanges };
    };

    if (applied) {
      // Already remapped under this mapping. Named picks taken mid-cutover
      // with provisional pairs are repaired by name; anything else is fine.
      const r = run("repair");
      const sides = r.pairs.map(sideOf);
      if (sides.includes("neither")) {
        plan.problems.push({
          path: doc.path,
          reason: "name_mismatch",
          detail: r.pairs
            .filter((p) => sideOf(p) === "neither")
            .map((p) => `${p.id} stored as "${p.name}"`)
            .join("; "),
        });
      } else if (r.problems.length > 0) {
        plan.problems.push(...r.problems);
      } else if (r.idChanges > 0 || !isDeepStrictEqual(r.before, r.after)) {
        plan.changes.push({
          kind: doc.kind,
          path: doc.path,
          mode: "repair",
          before: r.before,
          after: r.after,
          id_changes: r.idChanges,
        });
      } else {
        plan.already_applied.push(doc.path);
      }
      continue;
    }

    const r = run("remap");
    const sides = r.pairs.map(sideOf);
    if (
      sides.length > 0 &&
      sides.every((s) => s === "new" || s === "both") &&
      sides.includes("new")
    ) {
      plan.problems.push({
        path: doc.path,
        reason: "looks_already_remapped",
        detail:
          "stored names already match survivoR's ids but the document is not marked applied; not re-applying",
      });
      continue;
    }
    if (
      sides.some((s) => s === "neither") ||
      (sides.includes("new") && sides.includes("old"))
    ) {
      const bad = r.pairs.filter(
        (p) => sideOf(p) !== "old" && sideOf(p) !== "both",
      );
      plan.problems.push({
        path: doc.path,
        reason: bad.every((p) => sideOf(p) === "new")
          ? "mixed_old_and_new"
          : "name_mismatch",
        detail: bad
          .map(
            (p) =>
              `${p.id} stored as "${p.name}", provisional "${byFrom.get(p.id)?.from_name ?? "?"}"`,
          )
          .join("; "),
      });
      continue;
    }
    if (r.problems.length > 0) {
      plan.problems.push(...r.problems);
      continue;
    }
    if (r.idChanges === 0 && isDeepStrictEqual(r.before, r.after)) {
      plan.unchanged.push(doc.path);
      continue;
    }
    plan.changes.push({
      kind: doc.kind,
      path: doc.path,
      mode: "remap",
      before: r.before,
      after: r.after,
      id_changes: r.idChanges,
    });
  }

  return plan;
}

/* ------------------------------------------------------------------ *
 * Apply and rollback
 * ------------------------------------------------------------------ */

/**
 * The applied-mark transition a write makes, atomically with its fields:
 * `set` marks the document applied (it must not be marked yet), `keep`
 * requires the existing mark (repairs), `clear` requires and removes it
 * (rollback).
 */
export type RemapMark = "set" | "keep" | "clear";

/**
 * The storage the remap writes through. `compareAndSet` must be atomic per
 * document: check every `expected` field (deep equality, key order
 * irrelevant) and the mark, then write `next` and the mark transition in the
 * same transaction, or write nothing and return false.
 */
export type RemapStore = {
  compareAndSet(
    change: Pick<RemapDocChange, "kind" | "path">,
    expected: Record<string, unknown>,
    next: Record<string, unknown>,
    mark: RemapMark,
  ): Promise<boolean>;
};

export type RemapApplyResult = {
  applied: string[];
  /** Documents that changed after the plan was made; re-plan and retry. */
  stale: string[];
};

/**
 * Apply planned changes one document at a time. A document that moved on
 * since the plan (a live draft took a pick) is skipped as stale rather than
 * overwritten; a fresh dry run plans it again. Because the mark is written in
 * the same transaction as the fields, an interrupted run leaves every
 * document either fully remapped and marked, or untouched and unmarked.
 */
export async function applyCastawayIdRemap(
  changes: readonly RemapDocChange[],
  store: RemapStore,
): Promise<RemapApplyResult> {
  const result: RemapApplyResult = { applied: [], stale: [] };
  for (const change of changes) {
    const ok = await store.compareAndSet(
      change,
      change.before,
      change.after,
      change.mode === "remap" ? "set" : "keep",
    );
    (ok ? result.applied : result.stale).push(change.path);
  }
  return result;
}

/**
 * Undo one plan's changes, in reverse order, only where each document still
 * holds that plan's `after`. Roll plans back newest first.
 */
export async function rollbackCastawayIdRemap(
  changes: readonly RemapDocChange[],
  store: RemapStore,
): Promise<RemapApplyResult> {
  const result: RemapApplyResult = { applied: [], stale: [] };
  for (const change of [...changes].reverse()) {
    const ok = await store.compareAndSet(
      change,
      change.after,
      change.before,
      change.mode === "remap" ? "clear" : "keep",
    );
    (ok ? result.applied : result.stale).push(change.path);
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
