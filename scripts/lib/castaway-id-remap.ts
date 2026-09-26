/**
 * Remap a season's castaway ids from provisional values to survivoR's
 * published ids, across every stored document that references them.
 *
 * Season 51 was drafted on provisional ids (US0752 to US0772, predicted
 * before survivoR published). survivoR then published the same id range in a
 * different order, so the remap is a PERMUTATION of one id range: US0754 is
 * Ana Sani in the committed file and Thien An Nguyen upstream. That has two
 * consequences every function here is built around:
 *
 * 1. A value is remapped with one lookup in the old-to-new map, never by
 *    chaining replacements. Sequential find-and-replace (US0754 -> US0755,
 *    then US0755 -> US0757, ...) would move one person several times.
 * 2. Applying the remap twice is not a no-op, it moves everyone again. So a
 *    document is remapped at most once, tracked by an applied-paths ledger,
 *    and documents that carry names (draft picks, pool picks) are
 *    cross-checked against both casts so a document that already looks
 *    remapped but is missing from the ledger is reported, never re-applied.
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
    for (const [rule, test] of rules) {
      const candidates = upstream.filter((u) => test(c, u));
      if (candidates.length > 1) {
        errors.push(
          `"${c.full_name}" (${c.castaway_id}) is ambiguous by ${rule}: ${candidates.map((u) => u.castaway_id).join(", ")}`,
        );
        match = undefined;
        break;
      }
      if (candidates.length === 1) {
        match = { u: candidates[0], rule };
        break;
      }
    }
    if (!match) {
      if (!errors.some((e) => e.includes(`(${c.castaway_id}) is ambiguous`))) {
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
  const mapping_hash = createHash("sha256")
    .update(JSON.stringify(mappings.map((m) => [m.from, m.to])))
    .digest("hex")
    .slice(0, 16);

  return {
    mappings,
    changed: mappings.filter((m) => m.from !== m.to),
    errors,
    mapping_hash,
  };
}

/* ------------------------------------------------------------------ *
 * Document planning
 * ------------------------------------------------------------------ */

export type RemapDocKind =
  | "competition"
  | "trade"
  | "rtdb_draft"
  | "pool_config"
  | "pool_entry";

/** A stored document, reduced to plain JSON for the fields that matter. */
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
  | "ledgered_but_not_remapped";

export type RemapProblem = {
  path: string;
  reason: RemapProblemReason;
  detail: string;
};

export type RemapDocumentPlan = {
  changes: RemapDocChange[];
  /** Documents that need no change (no remapped ids in them). */
  unchanged: string[];
  /** Documents skipped because the ledger says they were already applied. */
  already_applied: string[];
  problems: RemapProblem[];
};

type Pair = { id: string; name: string };
type NameState = "old" | "new" | "both" | "mixed" | "none";

/**
 * Classify a document by the (id, name) pairs it stores. "old" means every
 * pair matches the committed cast, "new" every pair matches upstream, "both"
 * means only ids the permutation leaves in place (so either reading holds).
 */
function classifyPairs(
  pairs: readonly Pair[],
  oldNames: ReadonlyMap<string, string>,
  newNames: ReadonlyMap<string, string>,
): NameState {
  if (pairs.length === 0) return "none";
  let allOld = true;
  let allNew = true;
  for (const p of pairs) {
    const n = normalize(p.name);
    if (normalize(oldNames.get(p.id) ?? "\0") !== n) allOld = false;
    if (normalize(newNames.get(p.id) ?? "\0") !== n) allNew = false;
  }
  if (allOld && allNew) return "both";
  if (allOld) return "old";
  if (allNew) return "new";
  return "mixed";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** RTDB drops empty arrays and may return sparse arrays as objects. */
const asArray = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : isRecord(v) ? Object.values(v) : [];

export type PlanDocumentsOptions = {
  mapping: readonly CastawayIdMapping[];
  /** Prop bet question keys whose answer is a castaway id. */
  castawayPropBetKeys: ReadonlySet<string>;
  /** Paths the ledger records as already remapped with this mapping. */
  appliedPaths: ReadonlySet<string>;
};

/**
 * Plan the field-level changes for every document.
 *
 * Only castaway-bearing fields are touched: `draft_picks` and `prop_bets` on
 * competitions and RTDB drafts, the two id arrays on trades, `roster` and
 * `prop_bet_answers` on the pool config, `picks` and `prop_bets` on pool
 * entries. Names travel with ids where the schema stores them (draft pick
 * `player_name`, pool pick `full_name`) and are rewritten to survivoR's name.
 */
export function planDocumentRemap(
  docs: readonly RemapSourceDoc[],
  { mapping, castawayPropBetKeys, appliedPaths }: PlanDocumentsOptions,
): RemapDocumentPlan {
  const idMap = new Map(mapping.map((m) => [m.from, m.to]));
  const oldNames = new Map(mapping.map((m) => [m.from, m.from_name]));
  const newNames = new Map(mapping.map((m) => [m.to, m.to_name]));
  const knownIds = new Set([...idMap.keys()]);

  const plan: RemapDocumentPlan = {
    changes: [],
    unchanged: [],
    already_applied: [],
    problems: [],
  };

  for (const doc of docs) {
    const problems: RemapProblem[] = [];
    let idChanges = 0;

    const mapId = (id: unknown, where: string): unknown => {
      if (typeof id !== "string") return id;
      if (!knownIds.has(id)) {
        problems.push({
          path: doc.path,
          reason: "unknown_castaway_id",
          detail: `${where}: ${id} is not in the committed cast`,
        });
        return id;
      }
      const to = idMap.get(id)!;
      if (to !== id) idChanges++;
      return to;
    };

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

    const pairs: Pair[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const d = doc.data;

    if (doc.kind === "competition" || doc.kind === "rtdb_draft") {
      if (d.draft_picks !== undefined) {
        const picks = asArray(d.draft_picks);
        before.draft_picks = d.draft_picks;
        after.draft_picks = picks.map((p, i) => {
          if (!isRecord(p)) return p;
          const name = typeof p.player_name === "string" ? p.player_name : "";
          pairs.push({ id: String(p.castaway_id), name });
          const to = mapId(p.castaway_id, `draft_picks[${i}]`);
          return {
            ...p,
            castaway_id: to,
            ...(typeof to === "string" && newNames.has(to) && name
              ? { player_name: newNames.get(to) }
              : {}),
          };
        });
      }
      if (d.prop_bets !== undefined) {
        const entries = asArray(d.prop_bets);
        before.prop_bets = d.prop_bets;
        after.prop_bets = entries.map((e, i) =>
          isRecord(e)
            ? {
                ...e,
                values: mapPropBetValues(e.values, `prop_bets[${i}].values`),
              }
            : e,
        );
      }
    } else if (doc.kind === "trade") {
      for (const field of ["offered_castaway_ids", "requested_castaway_ids"]) {
        if (d[field] === undefined) continue;
        before[field] = d[field];
        after[field] = asArray(d[field]).map((id, i) =>
          mapId(id, `${field}[${i}]`),
        );
      }
    } else if (doc.kind === "pool_config" || doc.kind === "pool_entry") {
      const pickField = doc.kind === "pool_config" ? "roster" : "picks";
      if (d[pickField] !== undefined) {
        before[pickField] = d[pickField];
        after[pickField] = asArray(d[pickField]).map((p, i) => {
          if (!isRecord(p)) return p;
          const name = typeof p.full_name === "string" ? p.full_name : "";
          pairs.push({ id: String(p.castaway_id), name });
          const to = mapId(p.castaway_id, `${pickField}[${i}]`);
          return {
            ...p,
            castaway_id: to,
            ...(typeof to === "string" && newNames.has(to)
              ? { full_name: newNames.get(to) }
              : {}),
          };
        });
      }
      if (doc.kind === "pool_config" && d.prop_bet_answers !== undefined) {
        before.prop_bet_answers = d.prop_bet_answers;
        after.prop_bet_answers = asArray(d.prop_bet_answers).map((v) =>
          typeof v === "string" && knownIds.has(v) ? idMap.get(v) : v,
        );
      }
      if (doc.kind === "pool_entry" && d.prop_bets !== undefined) {
        before.prop_bets = d.prop_bets;
        after.prop_bets = mapPropBetValues(d.prop_bets, "prop_bets");
      }
    }

    const state = classifyPairs(pairs, oldNames, newNames);

    if (appliedPaths.has(doc.path)) {
      if (state === "old" || state === "mixed") {
        plan.problems.push({
          path: doc.path,
          reason: "ledgered_but_not_remapped",
          detail: `ledger says remapped, but stored names read as ${state}`,
        });
      } else {
        plan.already_applied.push(doc.path);
      }
      continue;
    }
    if (state === "new") {
      plan.problems.push({
        path: doc.path,
        reason: "looks_already_remapped",
        detail:
          "stored names already match survivoR's ids but the ledger has no record; not re-applying",
      });
      continue;
    }
    if (state === "mixed") {
      const bad = pairs.filter(
        (p) => normalize(oldNames.get(p.id) ?? "") !== normalize(p.name),
      );
      plan.problems.push({
        path: doc.path,
        reason: bad.every(
          (p) => normalize(newNames.get(p.id) ?? "") === normalize(p.name),
        )
          ? "mixed_old_and_new"
          : "name_mismatch",
        detail: bad
          .map(
            (p) =>
              `${p.id} stored as "${p.name}", committed "${oldNames.get(p.id) ?? "?"}"`,
          )
          .join("; "),
      });
      continue;
    }
    if (problems.length > 0) {
      plan.problems.push(...problems);
      continue;
    }
    if (idChanges === 0 && isDeepStrictEqual(before, after)) {
      plan.unchanged.push(doc.path);
      continue;
    }
    plan.changes.push({
      kind: doc.kind,
      path: doc.path,
      before,
      after,
      id_changes: idChanges,
    });
  }

  return plan;
}

/* ------------------------------------------------------------------ *
 * Apply and rollback
 * ------------------------------------------------------------------ */

/**
 * The storage the remap writes through. Each call is one document; the
 * implementation must make `compareAndSet` atomic for that document (a
 * Firestore transaction, an RTDB transaction).
 */
export type RemapStore = {
  /**
   * Replace `next`'s fields on `path` only if every field of `expected`
   * still deep-equals the stored value. Returns false (and writes nothing)
   * when the document moved on since the plan was made.
   */
  compareAndSet(
    kind: RemapDocKind,
    path: string,
    expected: Record<string, unknown>,
    next: Record<string, unknown>,
  ): Promise<boolean>;
  /** Record `path` as remapped (or, with `applied: false`, as rolled back). */
  setLedger(path: string, applied: boolean): Promise<void>;
};

export type RemapApplyResult = {
  applied: string[];
  /** Documents that changed after the plan was made; re-plan and retry. */
  stale: string[];
};

/**
 * Apply planned changes one document at a time.
 *
 * A document that moved on since the plan (a live draft took a pick) is
 * skipped as stale rather than overwritten; a fresh dry run plans it again.
 * The ledger is written right after each document so a crash never leaves a
 * remapped document that a rerun would remap a second time; the name
 * cross-check in `planDocumentRemap` catches the one-document window.
 */
export async function applyCastawayIdRemap(
  changes: readonly RemapDocChange[],
  store: RemapStore,
): Promise<RemapApplyResult> {
  const result: RemapApplyResult = { applied: [], stale: [] };
  for (const change of changes) {
    const ok = await store.compareAndSet(
      change.kind,
      change.path,
      change.before,
      change.after,
    );
    if (!ok) {
      result.stale.push(change.path);
      continue;
    }
    await store.setLedger(change.path, true);
    result.applied.push(change.path);
  }
  return result;
}

/** Undo applied changes, only where the document still holds `after`. */
export async function rollbackCastawayIdRemap(
  changes: readonly RemapDocChange[],
  store: RemapStore,
): Promise<RemapApplyResult> {
  const result: RemapApplyResult = { applied: [], stale: [] };
  for (const change of changes) {
    const ok = await store.compareAndSet(
      change.kind,
      change.path,
      change.after,
      change.before,
    );
    if (!ok) {
      result.stale.push(change.path);
      continue;
    }
    await store.setLedger(change.path, false);
    result.applied.push(change.path);
  }
  return result;
}
