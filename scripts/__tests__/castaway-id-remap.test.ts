import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  SEASON_51_CASTAWAY_LOOKUP,
  SEASON_51_PLAYERS,
} from "../../src/data/season_51";
import {
  applyCastawayIdRemap,
  buildCensus,
  type CastawayIdMappingFile,
  changedFields,
  classifyCommittedCast,
  type CommittedCastaway,
  fieldsEqual,
  planCastawayIdMapping,
  planDocumentRemap,
  type RemapDocumentPlan,
  type RemapMark,
  type RemapSourceDoc,
  type RemapStore,
  rollbackCastawayIdRemap,
  RTDB_REMAP_MARKER,
  verifyMappingFile,
} from "../lib/castaway-id-remap";
import {
  notDuringCutover,
  seasonIdFromPoolId,
  unchangedSince,
} from "../lib/remap-guarded-writes";
import {
  databaseUrlRefusal,
  emulatorTargetRefusal,
  ledgerStatusOf,
  seasonPushRefusal,
} from "../lib/remap-ledger";
import { adpCohortAction, remapLedgerPath } from "../recompute-castaway-adp";
import {
  markAllows,
  markHolds,
  parseArgs,
  type ProductionReader,
  readProduction,
  REMAP_LEDGER_COLLECTION,
  remapLedgerDocId,
  type RemapPlanFile,
  rewriteSeasonFileSource,
  writeRefusals,
} from "../remap-castaway-ids";
import upstreamFixture from "./fixtures/survivor-us51-castaways.json";

const committedFile = JSON.parse(
  fs.readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "castaway-id-remaps",
      "season_51.json",
    ),
    "utf-8",
  ),
) as CastawayIdMappingFile;
const mappings = committedFile.mappings;
const HASH = committedFile.mapping_hash;
const to = (from: string) => mappings.find((m) => m.from === from)!.to;

// The provisional cast comes from the committed mapping, not the season file,
// so these tests hold before and after the season file is rewritten.
const provisionalCast: CommittedCastaway[] = mappings.map((m) => ({
  castaway_id: m.from,
  full_name: m.from_name,
  castaway: "",
}));

const CASTAWAY_KEYS = new Set(["propbet_winner", "propbet_first_vote"]);
const opts = {
  mappings,
  mappingHash: HASH,
  castawayPropBetKeys: CASTAWAY_KEYS,
  ledger: new Map<string, string>(),
};

describe("the committed Season 51 mapping (survivoR 7336413)", () => {
  const rederived = planCastawayIdMapping(
    provisionalCast,
    upstreamFixture.castaways,
  );

  it("is exactly what the provisional cast and the pinned upstream produce", () => {
    expect(rederived.errors).toEqual([]);
    expect(rederived.mappings).toEqual(mappings);
    expect(verifyMappingFile(committedFile, rederived)).toEqual([]);
    expect(committedFile.upstream.commit).toBe(upstreamFixture.commit);
  });

  it("is what the bundled season file now carries", () => {
    const bundled: CommittedCastaway[] = Object.entries(
      SEASON_51_CASTAWAY_LOOKUP,
    ).map(([castaway_id, v]) => ({
      castaway_id,
      full_name: v.full_name,
      castaway: v.castaway,
    }));
    expect(classifyCommittedCast(bundled, mappings)).toBe("remapped");
    expect(
      SEASON_51_PLAYERS.map((p) => [p.castaway_id, p.full_name]).sort(),
    ).toEqual(mappings.map((m) => [m.to, m.to_name]).sort());
    expect(SEASON_51_CASTAWAY_LOOKUP.US0756).toEqual({
      full_name: "Angelica Loblack",
      castaway: "Jelly",
    });
  });

  it("is a permutation of one range, with 19 of 21 ids changing", () => {
    expect(new Set(mappings.map((m) => m.to))).toEqual(
      new Set(mappings.map((m) => m.from)),
    );
    expect(rederived.changed).toHaveLength(19);
    expect(to("US0752")).toBe("US0752");
    expect(to("US0753")).toBe("US0753");
  });

  it("pins every id and the two name differences", () => {
    expect(
      Object.fromEntries(
        rederived.changed.map((m) => [m.from, `${m.to} ${m.to_name}`]),
      ),
    ).toEqual({
      US0754: "US0755 Ana Sani",
      US0755: "US0757 Brady Booker",
      US0756: "US0758 Carter Krull",
      US0757: "US0759 Cristian Chavez",
      US0758: "US0760 Danny Kilby",
      US0759: "US0761 Devin Way",
      US0760: "US0762 Eric Macksoud",
      US0761: "US0756 Angelica Loblack",
      US0762: "US0763 Jenna Doore",
      US0763: "US0764 Kristin Flickinger",
      US0764: "US0765 Lewis Kelly",
      US0765: "US0766 Linnea Capobianco",
      US0766: "US0767 Maggie Nestor",
      US0767: "US0768 Mike Pinsky",
      US0768: "US0769 Ori Jean-Charles",
      US0769: "US0770 Patt Cannaday",
      US0770: "US0771 Rob Antonson",
      US0771: "US0772 Sharonda Cox",
      US0772: "US0754 Thien An Nguyen",
    });
    expect(mappings.find((m) => m.from === "US0761")).toMatchObject({
      matched_by: "short_name_and_surname",
      to_castaway: "Jelly",
    });
    expect(mappings.find((m) => m.from === "US0772")?.to_castaway).toBe(
      "Thien An",
    );
  });

  it("detects a tampered mapping file", () => {
    const tampered = structuredClone(committedFile);
    tampered.mappings[2].to = "US0756";
    expect(verifyMappingFile(tampered)).toEqual(
      expect.arrayContaining([
        "mapping_hash does not match the mappings in the file",
        "mapping is not one to one",
      ]),
    );
  });

  it("reports unmatched and ambiguous castaways instead of guessing", () => {
    const plan = planCastawayIdMapping(
      [
        { castaway_id: "US0001", full_name: "Pat Smith", castaway: "Pat" },
        { castaway_id: "US0002", full_name: "Nobody Here", castaway: "Nobody" },
      ],
      [
        { castaway_id: "US0010", full_name: "Pat Smith", castaway: "Pat" },
        { castaway_id: "US0011", full_name: "Pat Smith", castaway: "Pat" },
      ],
    );
    expect(plan.errors).toContain(
      '"Pat Smith" (US0001) is ambiguous by full_name: US0010, US0011',
    );
    expect(plan.errors).toContain(
      '"Nobody Here" (US0002) matches no upstream castaway',
    );
  });
});

describe("the local season file", () => {
  const source = fs.readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "src",
      "data",
      "season_51",
      "index.ts",
    ),
    "utf-8",
  );
  const lookupOf = (src: string) =>
    [
      ...src.matchAll(
        /(US\d{4}): \{ full_name: "([^"]*)", castaway: "([^"]*)" \}/g,
      ),
    ].map(([, castaway_id, full_name, castaway]) => ({
      castaway_id,
      full_name,
      castaway,
    }));
  const playersOf = (src: string) =>
    [...src.matchAll(/castaway_id: "(US\d{4})",\s*full_name: "([^"]*)"/g)].map(
      ([, id, name]) => `${id} ${name}`,
    );

  const state = classifyCommittedCast(lookupOf(source), mappings);

  it("is on one side of the mapping or the other", () => {
    expect(["provisional", "remapped"]).toContain(state);
    expect(classifyCommittedCast(provisionalCast, mappings)).toBe(
      "provisional",
    );
  });

  it.runIf(state === "provisional")(
    "rewrites to exactly survivoR's ids, names and short names, adding no results",
    () => {
      const rewritten = rewriteSeasonFileSource(source, committedFile);
      expect(classifyCommittedCast(lookupOf(rewritten), mappings)).toBe(
        "remapped",
      );
      expect(playersOf(rewritten).sort()).toEqual(
        mappings.map((m) => `${m.to} ${m.to_name}`).sort(),
      );
      // Images and every other player field stay with the person.
      expect(rewritten).toContain(
        'castaway_id: "US0756",\n    full_name: "Angelica Loblack",\n    img: "/images/season_51/Jelly-Loblack.jpg"',
      );
      expect(rewritten).toContain(
        'castaway_id: "US0755",\n    full_name: "Ana Sani",\n    img: "/images/season_51/Ana-Sani.jpg"',
      );
      expect(rewritten).toContain(
        "export const SEASON_51_EPISODES = [] satisfies",
      );
      expect(rewritten).not.toContain("PROVISIONAL");
      expect(rewritten).toContain(`mapping ${HASH}`);
    },
  );

  it.runIf(state === "remapped")(
    "carries exactly survivoR's ids and names once rewritten",
    () => {
      expect(playersOf(source).sort()).toEqual(
        mappings.map((m) => `${m.to} ${m.to_name}`).sort(),
      );
      expect(source).toContain(`mapping ${HASH}`);
    },
  );
});

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

const oldName = (id: string) => mappings.find((m) => m.from === id)!.from_name;
const newName = (id: string) => mappings.find((m) => m.to === id)!.to_name;
const pick = (id: string, order: number, name = oldName(id), uid = "uid1") => ({
  season_id: "season_51",
  season_num: 51,
  order,
  user_name: uid,
  user_uid: uid,
  castaway_id: id,
  player_name: name,
});
/** A pick taken on survivoR's ids. */
const newPick = (id: string, order: number, uid = "uid1") =>
  pick(id, order, newName(id), uid);

const competition: RemapSourceDoc = {
  kind: "competition",
  path: "competitions/competition_a",
  data: {
    competition_name: "A",
    draft_id: "draft_a",
    draft_picks: [pick("US0754", 1), pick("US0772", 2), pick("US0752", 3)],
    prop_bets: [
      {
        id: "propbet_1",
        user_uid: "uid1",
        values: {
          propbet_winner: "US0761",
          propbet_first_vote: "US0752",
          propbet_medevac: "Yes",
        },
      },
    ],
  },
};

const trade: RemapSourceDoc = {
  kind: "trade",
  path: "competitions/competition_a/trades/trade_1",
  data: {
    offered_castaway_ids: ["US0754"],
    requested_castaway_ids: ["US0772", "US0753"],
    status: "accepted",
  },
};

describe("planDocumentRemap", () => {
  it("remaps picks and castaway prop bets with one lookup each, never chaining", () => {
    const plan = planDocumentRemap([competition], opts);
    expect(plan.problems).toEqual([]);
    const after = plan.changes[0].after as {
      draft_picks: { castaway_id: string; player_name: string }[];
      prop_bets: { values: Record<string, string> }[];
    };
    // Ana US0754 -> US0755 and Thien An US0772 -> US0754. A chained replace
    // would have sent Thien An on to US0755 as well.
    expect(
      after.draft_picks.map((p) => [p.castaway_id, p.player_name]),
    ).toEqual([
      ["US0755", "Ana Sani"],
      ["US0754", "Thien An Nguyen"],
      ["US0752", "Aaliyah Puglia"],
    ]);
    expect(after.prop_bets[0].values).toEqual({
      propbet_winner: "US0756",
      propbet_first_vote: "US0752",
      propbet_medevac: "Yes",
    });
    expect(plan.changes[0]).toMatchObject({ mode: "remap", id_changes: 3 });
    expect(Object.keys(plan.changes[0].before).sort()).toEqual([
      "draft_picks",
      "prop_bets",
    ]);
  });

  it("keeps RTDB containers: picks keyed from 1, prop bets keyed by uid", () => {
    // Exactly what RTDB returns for a draft whose picks were written at
    // draft_picks/1, draft_picks/2 and prop bets at prop_bets/{uid}.
    const asArray: RemapSourceDoc = {
      kind: "rtdb_draft",
      path: "drafts/draft_x",
      data: {
        state: { started: true, finished: true },
        participants: { uidA: { uid: "uidA" }, uidB: { uid: "uidB" } },
        draft_picks: [null, pick("US0754", 1), pick("US0761", 2)],
        prop_bets: {
          uidA: {
            id: "p1",
            user_uid: "uidA",
            values: { propbet_winner: "US0772" },
          },
          uidB: {
            id: "p2",
            user_uid: "uidB",
            values: { propbet_winner: "US0752" },
          },
        },
      },
    };
    const asObject: RemapSourceDoc = {
      ...asArray,
      path: "drafts/draft_y",
      data: { ...asArray.data, draft_picks: { "1": pick("US0754", 1) } },
    };
    const plan = planDocumentRemap([asArray, asObject], opts);
    expect(plan.problems).toEqual([]);
    const [a, b] = plan.changes.map((c) => c.after);
    expect(a.draft_picks).toEqual([
      null,
      { ...pick("US0754", 1), castaway_id: "US0755" },
      {
        ...pick("US0761", 2),
        castaway_id: "US0756",
        player_name: "Angelica Loblack",
      },
    ]);
    expect(Object.keys(a.prop_bets as object)).toEqual(["uidA", "uidB"]);
    expect(
      (a.prop_bets as Record<string, { values: object }>).uidA.values,
    ).toEqual({ propbet_winner: "US0754" });
    expect(b.draft_picks).toEqual({
      "1": { ...pick("US0754", 1), castaway_id: "US0755" },
    });
    expect(plan.live_drafts).toEqual([]);
  });

  it("remaps trades, the pool roster and answers, and entries", () => {
    const plan = planDocumentRemap(
      [
        trade,
        {
          kind: "pool_config",
          path: "pools/pool_season_51",
          data: {
            roster: [
              { castaway_id: "US0761", full_name: "Jelly Loblack" },
              { castaway_id: "US0752", full_name: "Aaliyah Puglia" },
            ],
            prop_bet_answers: ["US0761", "US0752", "Yes", "No"],
          },
        },
        {
          kind: "pool_entry",
          path: "pools/pool_season_51/entries/uid1",
          data: {
            handle: "h",
            picks: [{ castaway_id: "US0761", full_name: "Jelly Loblack" }],
            prop_bets: { propbet_winner: "US0772" },
          },
        },
      ],
      opts,
    );
    expect(plan.problems).toEqual([]);
    // The pool config is applied before the documents that depend on it.
    expect(plan.changes.map((c) => c.after)).toEqual([
      {
        roster: [
          { castaway_id: "US0756", full_name: "Angelica Loblack" },
          { castaway_id: "US0752", full_name: "Aaliyah Puglia" },
        ],
        prop_bet_answers: ["US0756", "US0752", "Yes", "No"],
      },
      {
        offered_castaway_ids: ["US0755"],
        requested_castaway_ids: ["US0754", "US0753"],
      },
      {
        picks: [{ castaway_id: "US0756", full_name: "Angelica Loblack" }],
        prop_bets: { propbet_winner: "US0754" },
      },
    ]);
  });

  it("remaps the season document, team assignments and ADP keys", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "team_assignments",
          path: "team_assignments/season_51",
          data: { "1": { US0754: "team_a", US0772: null } },
        },
        {
          kind: "season",
          path: "seasons/season_51",
          data: {
            name: "Survivor 51",
            episodes: [],
            players: [
              {
                castaway_id: "US0772",
                full_name: "Thien An Nguyen",
                img: "/images/season_51/Thien-An-Nguyen.jpg",
              },
              {
                castaway_id: "US0761",
                full_name: "Jelly Loblack",
                img: "/images/season_51/Jelly-Loblack.jpg",
                nickname: "Jelly",
              },
            ],
            castawayLookup: {
              US0772: { full_name: "Thien An Nguyen", castaway: "Thien" },
              US0761: { full_name: "Jelly Loblack", castaway: "Jelly" },
            },
          },
        },
        {
          kind: "castaway_adp",
          path: "castaway_adp/season_51_pre_premiere",
          data: {
            season_id: "season_51",
            cohort: "pre_premiere",
            castaways: { US0754: { adp: 1.5 }, US0772: { adp: 9 } },
          },
        },
      ],
      opts,
    );
    expect(plan.problems).toEqual([]);
    // The season document goes first, so clients switch before anything else.
    expect(plan.changes.map((c) => c.kind)).toEqual([
      "season",
      "team_assignments",
      "castaway_adp",
    ]);
    const [season, teams, adp] = plan.changes.map((c) => c.after);
    expect(season).toEqual({
      players: [
        {
          castaway_id: "US0754",
          full_name: "Thien An Nguyen",
          img: "/images/season_51/Thien-An-Nguyen.jpg",
        },
        {
          castaway_id: "US0756",
          full_name: "Angelica Loblack",
          img: "/images/season_51/Jelly-Loblack.jpg",
          nickname: "Jelly",
        },
      ],
      castawayLookup: {
        US0754: { full_name: "Thien An Nguyen", castaway: "Thien An" },
        US0756: { full_name: "Angelica Loblack", castaway: "Jelly" },
      },
    });
    expect(teams).toEqual({ "1": { US0755: "team_a", US0754: null } });
    expect(adp).toEqual({
      castaways: { US0755: { adp: 1.5 }, US0754: { adp: 9 } },
    });
  });

  it("refuses season results, standalone or embedded in the season document (R1)", () => {
    const plan = planDocumentRemap(
      [
        { kind: "season_results", path: "events/season_51", data: {} },
        {
          kind: "season_results",
          path: "eliminations/season_51",
          data: { elimination_1: { castaway_id: "US0752" } },
        },
        {
          kind: "season",
          path: "seasons/season_51",
          data: {
            players: [],
            castawayLookup: {},
            events: { event_1: { castaway_id: "US0760" } },
          },
        },
      ],
      opts,
    );
    expect(plan.unchanged).toEqual(["events/season_51"]);
    expect(plan.changes).toEqual([]);
    expect(plan.problems.map((p) => [p.reason, p.scope])).toEqual([
      ["season_results_present", "global"],
      ["season_results_present", "global"],
    ]);
  });

  it("refuses a changed id anywhere the remap does not look (R1)", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "season",
          path: "seasons/season_51",
          data: {
            players: [],
            castawayLookup: {},
            episodes: [{ order: 1, featured_castaway: "US0760" }],
          },
        },
        {
          kind: "competition",
          path: "competitions/c",
          data: {
            draft_picks: [pick("US0754", 1)],
            scores: { US0760: 4 },
          },
        },
        {
          kind: "competition",
          path: "competitions/d",
          // A castaway answer under a key the app does not know as one.
          data: {
            draft_picks: [],
            prop_bets: [{ user_uid: "u", values: { propbet_new: "US0760" } }],
          },
        },
      ],
      opts,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.problems.map((p) => [p.path, p.reason, p.scope])).toEqual([
      ["seasons/season_51", "unhandled_castaway_field", "global"],
      ["competitions/c", "unhandled_castaway_field", "document"],
      ["competitions/d", "unhandled_castaway_field", "document"],
    ]);
    expect(plan.problems[0].detail).toContain("episodes.0.featured_castaway");
    expect(plan.problems[1].detail).toContain("scores#US0760");
  });

  it("reports unknown ids and inconsistent names instead of writing", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "competition",
          path: "competitions/c",
          data: { draft_picks: [pick("US0754", 1, "Somebody Else")] },
        },
        {
          kind: "trade",
          path: "competitions/c/trades/t",
          data: {
            offered_castaway_ids: ["US0999"],
            requested_castaway_ids: [],
          },
        },
      ],
      opts,
    );
    expect(plan.changes).toEqual([]);
    expect(plan.problems.map((p) => p.reason)).toEqual([
      "name_mismatch",
      "unknown_castaway_id",
    ]);
  });

  it("refuses a document already on survivoR's names before any cutover", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "competition",
          path: "competitions/c",
          data: { draft_picks: [newPick("US0754", 1)] },
        },
      ],
      opts,
    );
    expect(plan.problems.map((p) => p.reason)).toEqual([
      "looks_already_remapped",
    ]);
  });

  it("flags drafts users can still write to", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "rtdb_draft",
          path: "drafts/picking",
          data: { state: { started: true, finished: false } },
        },
        {
          kind: "rtdb_draft",
          path: "drafts/awaiting_prop_bets",
          data: {
            state: { started: true, finished: true },
            participants: { a: {}, b: {} },
            prop_bets: { a: { values: {} } },
          },
        },
        {
          kind: "rtdb_draft",
          path: "drafts/lobby",
          data: { state: { started: false } },
        },
      ],
      opts,
    );
    expect(plan.live_drafts).toEqual([
      "drafts/picking",
      "drafts/awaiting_prop_bets",
    ]);
  });

  it("rejects a document marked under another mapping", () => {
    const plan = planDocumentRemap([trade], {
      ...opts,
      ledger: new Map([[trade.path, "0000000000000000"]]),
    });
    expect(plan.problems[0]).toMatchObject({
      reason: "applied_with_other_mapping",
      scope: "global",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Apply, interruption, repair, rollback
 * ------------------------------------------------------------------ */

/**
 * An in-memory store with the production contract: fields and mark are
 * checked and written together, or nothing is; only changed fields are
 * written. Firestore marks live in a ledger map, RTDB marks inside the node,
 * as in production. The Firebase store itself runs against the emulators in
 * rules-tests/castaway-id-remap.emulator.test.ts.
 */
function memoryStore(initial: readonly RemapSourceDoc[]) {
  const docs = new Map(
    initial.map((d) => [d.path, structuredClone(d.data)] as const),
  );
  const kinds = new Map(initial.map((d) => [d.path, d.kind] as const));
  const ledger = new Map<string, string>();
  const acceptBorn = new Set<string>();
  let census: ReturnType<typeof censusOf> | null = null;
  let failAfter = Infinity;
  const markOf = (kind: string, p: string) =>
    kind === "rtdb_draft"
      ? (docs.get(p)?.[RTDB_REMAP_MARKER] as { mapping_hash?: string })
          ?.mapping_hash
      : ledger.get(p);
  const store: RemapStore = {
    async compareAndSet(change, expected, next, mark: RemapMark) {
      if (failAfter-- <= 0) throw new Error("process killed");
      const current = docs.get(change.path);
      if (
        !current ||
        !fieldsEqual(current, expected) ||
        !markAllows(mark, markOf(change.kind, change.path), HASH)
      ) {
        return false;
      }
      const updated = {
        ...current,
        ...structuredClone(changedFields(expected, next)),
      };
      for (const [k, v] of Object.entries(updated)) {
        if (v === null) delete updated[k];
      }
      if (change.kind === "rtdb_draft") {
        if (mark === "set") updated[RTDB_REMAP_MARKER] = { mapping_hash: HASH };
        if (mark === "clear") delete updated[RTDB_REMAP_MARKER];
      } else if (mark === "set") ledger.set(change.path, HASH);
      else if (mark === "clear") ledger.delete(change.path);
      docs.set(change.path, updated);
      return true;
    },
  };
  const current = (): RemapSourceDoc[] =>
    [...docs.entries()].map(([p, data]) => ({
      kind: kinds.get(p)!,
      path: p,
      data: structuredClone(data),
    }));
  const replan = (): RemapDocumentPlan =>
    planDocumentRemap(current(), { ...opts, ledger, census, acceptBorn });
  return {
    store,
    docs,
    ledger,
    acceptBorn,
    replan,
    killAfter: (n: number) => (failAfter = n),
    /** Record the census, as the first write does. */
    begin: () => {
      census = censusOf(current());
    },
    /** A document created after the census. */
    add: (doc: RemapSourceDoc) => {
      kinds.set(doc.path, doc.kind);
      docs.set(doc.path, structuredClone(doc.data));
    },
    /** Begin (if not yet) and apply a fresh plan, as a write does. */
    write: async () => {
      if (census === null) census = censusOf(current());
      return applyCastawayIdRemap(replan().changes, store);
    },
  };
}

const censusOf = (docs: readonly RemapSourceDoc[]) =>
  new Map(Object.entries(buildCensus(docs)));

const draft: RemapSourceDoc = {
  kind: "rtdb_draft",
  path: "drafts/draft_a",
  data: {
    state: { started: true, finished: true },
    participants: { uid1: {} },
    draft_picks: [null, pick("US0754", 1)],
    prop_bets: { uid1: { values: { propbet_winner: "US0772" } } },
  },
};

const picksOf = (data: Record<string, unknown> | undefined) =>
  Object.values((data?.draft_picks ?? {}) as object)
    .filter(Boolean)
    .map((p: { castaway_id: string }) => p.castaway_id);

describe("applyCastawayIdRemap and rollbackCastawayIdRemap", () => {
  it("applies once; a re-plan finds everything applied and plans nothing", async () => {
    const all = [competition, trade, draft];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    expect(await mem.write()).toEqual({
      applied: all.map((d) => d.path),
      stale: [],
      already: [],
      skipped: [],
    });
    const replan = mem.replan();
    expect(replan.changes).toEqual([]);
    expect(replan.problems).toEqual([]);
    expect(replan.already_applied).toEqual(all.map((d) => d.path));
    // Re-running the same plan writes nothing: every document is done.
    expect(await applyCastawayIdRemap(plan.changes, mem.store)).toEqual({
      applied: [],
      stale: [],
      already: all.map((d) => d.path),
      skipped: [],
    });
  });

  it("never double-applies a nameless document after an interrupted run", async () => {
    // The trade stores ids alone, so only its mark can say it was remapped.
    const all = [trade, competition, draft];
    const mem = memoryStore(all);
    mem.begin();
    const plan = mem.replan();
    mem.killAfter(1);
    await expect(applyCastawayIdRemap(plan.changes, mem.store)).rejects.toThrow(
      "process killed",
    );
    expect(mem.ledger.has(trade.path)).toBe(true);
    mem.killAfter(Infinity);
    const replan = mem.replan();
    expect(replan.already_applied).toEqual([trade.path]);
    expect(replan.changes.map((c) => c.path)).toEqual([
      competition.path,
      draft.path,
    ]);
    await applyCastawayIdRemap(replan.changes, mem.store);
    expect(mem.docs.get(trade.path)).toMatchObject({
      offered_castaway_ids: ["US0755"],
      requested_castaway_ids: ["US0754", "US0753"],
    });
  });

  it("repairs, by name, a pick taken with a provisional id after the remap", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    // A client still on the old season document takes Thien An as US0772.
    (mem.docs.get(draft.path)!.draft_picks as unknown[]).push(
      pick("US0772", 2),
    );
    const replan = mem.replan();
    expect(replan.problems).toEqual([]);
    expect(replan.changes).toHaveLength(1);
    expect(replan.changes[0].mode).toBe("repair");
    await applyCastawayIdRemap(replan.changes, mem.store);
    expect(picksOf(mem.docs.get(draft.path))).toEqual(["US0755", "US0754"]);
    expect(mem.replan().already_applied).toEqual([draft.path]);
  });

  it("refuses a repair that would put one castaway on a board twice (N3)", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    // Ana Sani is US0755 now. A stale client shows her as available under
    // her provisional US0754 and a second user takes her again.
    (mem.docs.get(draft.path)!.draft_picks as unknown[]).push(
      pick("US0754", 2, "Ana Sani", "uid2"),
      pick("US0761", 3, "Jelly Loblack", "uid1"),
    );
    const replan = mem.replan();
    expect(replan.changes).toEqual([]);
    expect(replan.problems).toMatchObject([
      { path: draft.path, reason: "duplicate_castaway", scope: "document" },
    ]);
    expect(replan.problems[0].detail).toContain("US0755 x2");
  });

  it("skips a document that changed after the plan was made", async () => {
    const mem = memoryStore([competition]);
    const plan = planDocumentRemap([competition], opts);
    (mem.docs.get(competition.path)!.draft_picks as unknown[]).push(
      pick("US0760", 4),
    );
    expect(await applyCastawayIdRemap(plan.changes, mem.store)).toEqual({
      applied: [],
      stale: [competition.path],
      already: [],
      skipped: [],
    });
    expect(mem.ledger.size).toBe(0);
  });

  it("switches the season first and rolls it back last, exactly, clearing every mark", async () => {
    const season: RemapSourceDoc = {
      kind: "season",
      path: "seasons/season_51",
      data: {
        players: [{ castaway_id: "US0754", full_name: "Ana Sani" }],
        castawayLookup: { US0754: { full_name: "Ana Sani", castaway: "Ana" } },
      },
    };
    const all = [competition, trade, draft, season];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    const applied = await applyCastawayIdRemap(plan.changes, mem.store);
    expect(applied.applied[0]).toBe(season.path);
    const rolled = await rollbackCastawayIdRemap(plan.changes, mem.store);
    expect(rolled.applied).toEqual([...applied.applied].reverse());
    expect(rolled.applied.at(-1)).toBe(season.path);
    for (const d of all) expect(mem.docs.get(d.path)).toEqual(d.data);
    expect(mem.ledger.size).toBe(0);
  });

  it("compares fields regardless of object key order", () => {
    expect(fieldsEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(
      true,
    );
    expect(fieldsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(changedFields({ a: 1, b: null }, { a: 1, b: null })).toEqual({});
  });
});

/* ------------------------------------------------------------------ *
 * The cutover census: documents that exist when it begins are remapped,
 * anything created later is classified and never remapped.
 * ------------------------------------------------------------------ */

/**
 * uid1 drafted Ana (US0754) and Carter (US0756), uid2 Thien An (US0772) and
 * Jelly (US0761), all on provisional ids. After the remap: uid1 holds
 * US0755 and US0758, uid2 holds US0754 and US0756.
 */
const league: RemapSourceDoc = {
  kind: "competition",
  path: "competitions/league",
  data: {
    draft_id: "league",
    draft_picks: [
      pick("US0754", 1, undefined, "uid1"),
      pick("US0772", 2, undefined, "uid2"),
      pick("US0756", 3, undefined, "uid1"),
      pick("US0761", 4, undefined, "uid2"),
    ],
    prop_bets: [],
  },
};
const bornTrade = (
  id: string,
  offered: string[],
  requested: string[],
): RemapSourceDoc => ({
  kind: "trade",
  path: `competitions/league/trades/${id}`,
  data: {
    offered_by_uid: "uid1",
    offered_to_uid: "uid2",
    offered_castaway_ids: offered,
    requested_castaway_ids: requested,
    status: "pending",
  },
});

describe("the cutover census", () => {
  it("marks every pre-existing document, even an empty draft", async () => {
    const lobby: RemapSourceDoc = {
      kind: "rtdb_draft",
      path: "drafts/lobby",
      data: { state: { started: false }, season_id: "season_51" },
    };
    const mem = memoryStore([competition, lobby]);
    mem.begin();
    const plan = mem.replan();
    expect(plan.changes.find((c) => c.path === lobby.path)).toMatchObject({
      mode: "remap",
      id_changes: 0,
    });
    await mem.write();
    expect(mem.replan().already_applied).toEqual([
      competition.path,
      lobby.path,
    ]);

    // Picks taken into it later are survivoR's; a provisional one is
    // repaired by name.
    mem.docs.get(lobby.path)!.draft_picks = [
      null,
      newPick("US0754", 1),
      pick("US0761", 2),
    ];
    const replan = mem.replan();
    expect(replan.problems).toEqual([]);
    expect(replan.changes).toMatchObject([
      { path: lobby.path, mode: "repair", id_changes: 1 },
    ]);
    await applyCastawayIdRemap(replan.changes, mem.store);
    expect(picksOf(mem.docs.get(lobby.path))).toEqual(["US0754", "US0756"]);
  });

  it("never remaps a trade created after the cutover began (N1)", async () => {
    const mem = memoryStore([league]);
    await mem.write();
    // Offered after the switch: uid1 gives Ana (US0755) for Thien An (US0754).
    const t = bornTrade("t_new", ["US0755"], ["US0754"]);
    mem.add(t);
    const plan = mem.replan();
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toMatchObject([
      { path: t.path, mode: "born", id_changes: 0 },
    ]);
    expect(plan.changes[0].after).toEqual(plan.changes[0].before);
    await applyCastawayIdRemap(plan.changes, mem.store);
    expect(mem.docs.get(t.path)).toEqual(t.data);
    // Marked, so every later run leaves it alone.
    expect(mem.replan().already_applied).toContain(t.path);
    expect(mem.replan().changes).toEqual([]);
  });

  it("reports a trade made on provisional ids after the cutover, and never remaps it", async () => {
    const mem = memoryStore([league]);
    await mem.write();
    // A stale client offers Ana as US0754 for Thien An as US0772.
    const t = bornTrade("t_stale", ["US0754"], ["US0772"]);
    mem.add(t);
    const plan = mem.replan();
    expect(plan.changes).toEqual([]);
    expect(plan.problems).toMatchObject([
      { path: t.path, reason: "born_not_new", scope: "document" },
    ]);
    expect(plan.problems[0].detail).toMatch(/only as provisional ids/);
  });

  it("asks the operator about a trade that fits both readings; --accept-born marks it", async () => {
    // uid1 holds Ana (US0755) and Brady (US0757) after the remap, and
    // US0755 read as provisional is Brady, so offering US0755 fits both.
    const both: RemapSourceDoc = {
      ...league,
      data: {
        ...league.data,
        draft_picks: [
          pick("US0754", 1, undefined, "uid1"),
          pick("US0755", 2, undefined, "uid1"),
        ],
      },
    };
    const mem = memoryStore([both]);
    await mem.write();
    const t = bornTrade("t_both", ["US0755"], []);
    mem.add(t);
    expect(mem.replan().problems).toMatchObject([
      { path: t.path, reason: "born_ambiguous", scope: "document" },
    ]);
    mem.acceptBorn.add(t.path);
    expect(mem.replan().changes).toMatchObject([
      { path: t.path, mode: "born" },
    ]);
  });

  it("classifies a draft and competition made on survivoR's ids after the cutover (N2), without blocking repairs", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    // A pick taken into the remapped draft by a stale client: needs repair.
    (mem.docs.get(draft.path)!.draft_picks as unknown[]).push(
      pick("US0772", 2),
    );
    // A whole new league drafted on survivoR's ids.
    const newDraft: RemapSourceDoc = {
      kind: "rtdb_draft",
      path: "drafts/fresh",
      data: {
        state: { started: true, finished: true },
        participants: { uid9: {} },
        draft_picks: [null, newPick("US0754", 1, "uid9")],
        prop_bets: {
          uid9: { user_uid: "uid9", values: { propbet_winner: "US0756" } },
        },
      },
    };
    const newComp: RemapSourceDoc = {
      kind: "competition",
      path: "competitions/fresh",
      data: {
        draft_id: "fresh",
        draft_picks: [newPick("US0754", 1, "uid9")],
        prop_bets: [{ user_uid: "uid9", values: { propbet_winner: "US0756" } }],
      },
    };
    // And one whose draft is gone: held for a person, alone.
    const orphan: RemapSourceDoc = {
      kind: "competition",
      path: "competitions/orphan",
      data: { draft_id: "missing", draft_picks: [newPick("US0760", 1)] },
    };
    mem.add(newDraft);
    mem.add(newComp);
    mem.add(orphan);
    const plan = mem.replan();
    expect(plan.changes.map((c) => [c.path, c.mode])).toEqual([
      [draft.path, "repair"],
      [newDraft.path, "born"],
      [newComp.path, "born"],
    ]);
    expect(plan.problems).toMatchObject([
      { path: orphan.path, reason: "born_ambiguous", scope: "document" },
    ]);
    expect(plan.problems[0].detail).toMatch(/is gone/);
    await applyCastawayIdRemap(plan.changes, mem.store);
    expect(mem.docs.get(newComp.path)!.draft_picks).toEqual(
      newComp.data.draft_picks,
    );
    expect(picksOf(mem.docs.get(draft.path))).toEqual(["US0755", "US0754"]);
    expect(mem.replan().changes).toEqual([]);
  });

  it("holds a born competition that differs from its draft, or uses provisional names", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    mem.add({
      kind: "competition",
      path: "competitions/draft_a_copy",
      data: {
        draft_id: "draft_a",
        draft_picks: [newPick("US0760", 1)],
        prop_bets: [],
      },
    });
    mem.add({
      kind: "rtdb_draft",
      path: "drafts/stale",
      data: {
        state: { started: true, finished: true },
        participants: {},
        draft_picks: [null, pick("US0760", 1)],
      },
    });
    expect(mem.replan().problems.map((p) => [p.path, p.reason])).toEqual([
      ["competitions/draft_a_copy", "born_not_new"],
      ["drafts/stale", "born_not_new"],
    ]);
  });

  it("leaves an empty or still-drafting new draft unmarked until it can be told", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    mem.add({
      kind: "rtdb_draft",
      path: "drafts/empty",
      data: { state: { started: false } },
    });
    mem.add({
      kind: "rtdb_draft",
      path: "drafts/drafting",
      data: {
        state: { started: true, finished: false },
        draft_picks: [null, newPick("US0754", 1)],
      },
    });
    const plan = mem.replan();
    expect(plan.changes).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.born_pending).toEqual(["drafts/empty", "drafts/drafting"]);
  });

  it("moves named picks by name in a draft that took survivoR's ids before its remap", async () => {
    const drafting: RemapSourceDoc = {
      kind: "rtdb_draft",
      path: "drafts/drafting",
      data: {
        state: { started: true, finished: false },
        draft_picks: [null, pick("US0754", 1)],
      },
    };
    const mem = memoryStore([drafting]);
    mem.begin();
    // The season switched first; the next pick arrives on survivoR's ids.
    (mem.docs.get(drafting.path)!.draft_picks as unknown[]).push(
      newPick("US0772", 2),
    );
    const plan = mem.replan();
    expect(plan.problems).toEqual([]);
    await applyCastawayIdRemap(plan.changes, mem.store);
    expect(picksOf(mem.docs.get(drafting.path))).toEqual(["US0755", "US0772"]);

    // With a nameless answer as well, the draft cannot be placed.
    const mixed = memoryStore([drafting]);
    mixed.begin();
    const node = mixed.docs.get(drafting.path)!;
    (node.draft_picks as unknown[]).push(newPick("US0772", 2));
    node.prop_bets = { uid1: { values: { propbet_winner: "US0760" } } };
    expect(mixed.replan().problems).toMatchObject([
      { reason: "mixed_old_and_new", scope: "document" },
    ]);
  });

  it("refuses to place a prop bet submitted during the cutover", async () => {
    const awaiting: RemapSourceDoc = {
      kind: "rtdb_draft",
      path: "drafts/awaiting",
      data: {
        state: { started: true, finished: true },
        participants: { uid1: {}, uid2: {} },
        draft_picks: [
          null,
          pick("US0754", 1),
          pick("US0760", 2, undefined, "uid2"),
        ],
        prop_bets: { uid1: { values: { propbet_winner: "US0772" } } },
      },
    };
    const mem = memoryStore([awaiting]);
    mem.begin();
    (mem.docs.get(awaiting.path)!.prop_bets as Record<string, unknown>).uid2 = {
      values: { propbet_winner: "US0760" },
    };
    const plan = mem.replan();
    expect(plan.changes).toEqual([]);
    expect(plan.problems).toMatchObject([
      { reason: "prop_bet_epoch_unknown", scope: "document" },
    ]);
  });
});

describe("prerequisites and explicit resolution", () => {
  const season: RemapSourceDoc = {
    kind: "season",
    path: "seasons/season_51",
    data: {
      players: [{ castaway_id: "US0754", full_name: "Ana Sani" }],
      castawayLookup: { US0754: { full_name: "Ana Sani", castaway: "Ana" } },
    },
  };

  it("attempts nothing after a season document that did not apply", async () => {
    const all = [competition, trade, draft, season];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    // The season document moved after the plan was made.
    mem.docs.get(season.path)!.players = [];
    const result = await applyCastawayIdRemap(plan.changes, mem.store);
    expect(result).toEqual({
      applied: [],
      stale: [season.path],
      already: [],
      skipped: [competition.path, trade.path, draft.path],
    });
    expect(mem.docs.get(competition.path)).toEqual(competition.data);
    expect(mem.ledger.size).toBe(0);
  });

  it("refuses a plan that does not lead with its prerequisites", async () => {
    const all = [competition, season];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    await expect(
      applyCastawayIdRemap([...plan.changes].reverse(), mem.store),
    ).rejects.toThrow(/first/);
  });

  it("does not roll the season back while anything before it failed to restore", async () => {
    const all = [competition, trade, draft, season];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    await applyCastawayIdRemap(plan.changes, mem.store);
    // A pick lands in the draft after the write: its rollback is stale.
    (mem.docs.get(draft.path)!.draft_picks as unknown[]).push(
      newPick("US0760", 2),
    );
    const result = await rollbackCastawayIdRemap(plan.changes, mem.store);
    expect(result.stale).toEqual([draft.path]);
    expect(result.skipped).toEqual([season.path]);
    expect(mem.ledger.get(season.path)).toBe(HASH);
    expect(
      (mem.docs.get(season.path)!.players as { castaway_id: string }[])[0]
        .castaway_id,
    ).toBe("US0755");

    // Once the late pick is resolved, rerunning the same rollback finishes:
    // documents already restored count as done, not stale.
    (mem.docs.get(draft.path)!.draft_picks as unknown[]).pop();
    const rerun = await rollbackCastawayIdRemap(plan.changes, mem.store);
    expect(rerun.stale).toEqual([]);
    expect(rerun.skipped).toEqual([]);
    expect(rerun.applied).toEqual([draft.path, season.path]);
    expect(rerun.already).toEqual([trade.path, competition.path]);
    for (const d of all) expect(mem.docs.get(d.path)).toEqual(d.data);
    expect(mem.ledger.size).toBe(0);
  });

  it("holds born team assignments for an explicit --accept-born, then marks them", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    const teams: RemapSourceDoc = {
      kind: "team_assignments",
      path: "team_assignments/season_51",
      data: { "1": { US0754: "a" } },
    };
    mem.add(teams);
    expect(mem.replan().problems).toMatchObject([
      { path: teams.path, reason: "born_ambiguous", scope: "document" },
    ]);
    expect(mem.replan().changes).toEqual([]);
    mem.acceptBorn.add(teams.path);
    const plan = mem.replan();
    expect(plan.changes).toMatchObject([{ path: teams.path, mode: "born" }]);
    await applyCastawayIdRemap(plan.changes, mem.store);
    expect(mem.docs.get(teams.path)).toEqual(teams.data);
    expect(mem.replan().problems).toEqual([]);
  });

  it("accepts an orphaned competition only with --accept-born, and never one on provisional names", async () => {
    const mem = memoryStore([draft]);
    await mem.write();
    const orphan: RemapSourceDoc = {
      kind: "competition",
      path: "competitions/orphan",
      data: { draft_id: "gone", draft_picks: [newPick("US0760", 1)] },
    };
    const stale: RemapSourceDoc = {
      kind: "competition",
      path: "competitions/stale_orphan",
      data: { draft_id: "gone2", draft_picks: [pick("US0760", 1)] },
    };
    mem.add(orphan);
    mem.add(stale);
    mem.acceptBorn.add(orphan.path);
    mem.acceptBorn.add(stale.path);
    const plan = mem.replan();
    expect(plan.changes).toMatchObject([{ path: orphan.path, mode: "born" }]);
    expect(plan.problems).toMatchObject([
      { path: stale.path, reason: "born_not_new" },
    ]);
  });
});

describe("pre-flight of the prerequisites", () => {
  const season: RemapSourceDoc = {
    kind: "season",
    path: "seasons/season_51",
    data: {
      players: [{ castaway_id: "US0754", full_name: "Ana Sani" }],
      castawayLookup: { US0754: { full_name: "Ana Sani", castaway: "Ana" } },
    },
  };
  const pool: RemapSourceDoc = {
    kind: "pool_config",
    path: "pools/pool_season_51",
    data: {
      roster: [{ castaway_id: "US0754", full_name: "Ana Sani" }],
      prop_bet_answers: ["US0754"],
    },
  };

  it("applies nothing, not even the season document, when the pool config cannot move", async () => {
    const all = [competition, season, pool];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    mem.docs.get(pool.path)!.roster = [];
    const result = await applyCastawayIdRemap(plan.changes, mem.store);
    expect(result.applied).toEqual([]);
    expect(result.stale).toEqual([pool.path]);
    expect(result.skipped).toEqual([season.path, competition.path]);
    expect(mem.docs.get(season.path)).toEqual(season.data);
    expect(mem.ledger.size).toBe(0);
  });

  it("restores nothing when the season document no longer holds the plan's after", async () => {
    const all = [competition, season, pool];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    await applyCastawayIdRemap(plan.changes, mem.store);
    mem.docs.get(season.path)!.players = [];
    const result = await rollbackCastawayIdRemap(plan.changes, mem.store);
    expect(result.applied).toEqual([]);
    expect(result.stale).toEqual([season.path]);
    expect(mem.ledger.get(competition.path)).toBe(HASH);
  });
});

describe("guarded writes", () => {
  it("reads a season from a pool id, and nothing from anything else", () => {
    expect(seasonIdFromPoolId("pool_season_51")).toBe("season_51");
    expect(seasonIdFromPoolId("pool_season_7")).toBe("season_7");
    expect(seasonIdFromPoolId("pool_season_d")).toBeNull();
    expect(seasonIdFromPoolId("pool_s51")).toBeNull();
    expect(seasonIdFromPoolId("season_51")).toBeNull();
  });

  it("holds during a cutover, and for a long job whose state moved", () => {
    const during = notDuringCutover("season_51", "job");
    expect(during("none")).toBeNull();
    expect(during("finalized")).toBeNull();
    expect(during("in_progress")).toMatch(/in progress/);
    const moved = unchangedSince("season_51", "job", "none");
    expect(moved("none")).toBeNull();
    expect(moved("in_progress")).toMatch(/rerun/);
    expect(moved("finalized")).toMatch(/rerun/);
    expect(
      unchangedSince("season_51", "job", "in_progress")("in_progress"),
    ).toMatch(/rerun/);
  });
});

describe("the emulator target guard", () => {
  it("wants both emulator hosts or neither, and emulators only for demo projects", () => {
    const both = {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000",
    };
    expect(emulatorTargetRefusal({}, "survivor-fantasy-51c4b")).toBeNull();
    expect(emulatorTargetRefusal(both, "demo-x")).toBeNull();
    expect(emulatorTargetRefusal(both, "survivor-fantasy-51c4b")).toMatch(
      /unset them/,
    );
    expect(
      emulatorTargetRefusal(
        { FIREBASE_DATABASE_EMULATOR_HOST: "127.0.0.1:9000" },
        "survivor-fantasy-51c4b",
      ),
    ).toMatch(/only one emulator/);
    expect(emulatorTargetRefusal({}, "demo-x")).toMatch(/no emulator/);
  });
});

/* ------------------------------------------------------------------ *
 * CLI guards and production reading
 * ------------------------------------------------------------------ */

describe("parseArgs", () => {
  it("requires --plan and --project for writes, and one mode at a time", () => {
    expect(() => parseArgs(["51", "--write"])).toThrow(/--plan/);
    expect(() => parseArgs(["51", "--finalize"])).toThrow(/--project/);
    expect(() =>
      parseArgs([
        "51",
        "--write",
        "--rollback",
        "--plan",
        "p",
        "--project",
        "x",
      ]),
    ).toThrow(/exclusive/);
    expect(() => parseArgs(["51", "--upstream", "abc"])).toThrow(
      /40-character/,
    );
    expect(
      parseArgs([
        "51",
        "--write",
        "--plan",
        "p.json",
        "--project",
        "proj",
        "--ack-live-draft",
        "drafts/a",
        "--accept-born",
        "competitions/c/trades/t",
      ]),
    ).toMatchObject({
      seasonNum: 51,
      write: true,
      plan: "p.json",
      project: "proj",
      ackLiveDrafts: ["drafts/a"],
      acceptBorn: ["competitions/c/trades/t"],
    });
  });
});

describe("writeRefusals", () => {
  const liveDraft: RemapSourceDoc = {
    kind: "rtdb_draft",
    path: "drafts/a",
    data: {
      state: { started: true, finished: false },
      draft_picks: [null, pick("US0754", 1)],
    },
  };
  const documents = planDocumentRemap([competition], opts);
  const URL = "https://proj-default-rtdb.firebaseio.com";
  const plan: RemapPlanFile = {
    season_num: 51,
    created_at: "2026-09-26T12:00:00.000Z",
    project_id: "proj",
    database_url: URL,
    mapping_hash: HASH,
    upstream_commit: committedFile.upstream.commit,
    local_season_file: "provisional",
    ledger_status: "none",
    accept_born: [],
    inventory: {},
    documents,
  };
  const base = {
    plan,
    seasonNum: 51,
    project: "proj",
    adminProjectId: "proj",
    databaseUrl: URL,
    mappingHash: HASH,
    ledgerHash: null,
    ledgerStatus: "none" as const,
    now: new Date("2026-09-26T13:00:00.000Z"),
    maxPlanAgeHours: 6,
    fresh: documents,
    ackLiveDrafts: [] as string[],
    acceptBorn: [] as string[],
  };

  it("allows a fresh, matching plan", () => {
    expect(writeRefusals(base)).toEqual([]);
  });

  it("binds the plan to the project, database, mapping, ledger and age", () => {
    expect(writeRefusals({ ...base, adminProjectId: "other" })).toHaveLength(1);
    expect(
      writeRefusals({ ...base, plan: { ...plan, project_id: "other" } }),
    ).toHaveLength(1);
    expect(writeRefusals({ ...base, mappingHash: "x" })).toHaveLength(1);
    expect(writeRefusals({ ...base, ledgerHash: "x" })).toHaveLength(1);
    expect(
      writeRefusals({ ...base, now: new Date("2026-09-27T12:00:00.000Z") }),
    ).toEqual(["the plan is 24.0h old; dry-run again"]);
    // N4: an RTDB instance of another project, even named in both places.
    const other = "https://other-default-rtdb.firebaseio.com";
    expect(
      writeRefusals({
        ...base,
        databaseUrl: other,
        plan: { ...plan, database_url: other },
      }),
    ).toEqual([
      `the Realtime Database URL ${other} does not belong to project proj`,
    ]);
    // Or a URL of this project that is not the one the plan read.
    expect(
      writeRefusals({
        ...base,
        databaseUrl: "https://proj.europe-west1.firebasedatabase.app",
      }),
    ).toHaveLength(1);
    expect(writeRefusals({ ...base, ledgerStatus: "in_progress" })).toEqual([
      "the cutover was none when the plan was made and is in_progress now; dry-run again",
    ]);
    expect(writeRefusals({ ...base, acceptBorn: ["x"] })).toEqual([
      "--accept-born differs from the plan's",
    ]);
  });

  it("refuses when production moved since review, or a written draft is live", () => {
    const moved = planDocumentRemap(
      [
        {
          ...competition,
          data: {
            ...competition.data,
            draft_picks: [pick("US0754", 1), pick("US0760", 2)],
          },
        },
      ],
      opts,
    );
    expect(writeRefusals({ ...base, fresh: moved })).toEqual([
      "production changed since the plan was reviewed; dry-run again",
    ]);
    const withLive = planDocumentRemap([competition, liveDraft], opts);
    expect(withLive.live_drafts).toEqual(["drafts/a"]);
    const livePlan = { ...plan, documents: withLive };
    expect(
      writeRefusals({ ...base, plan: livePlan, fresh: withLive }),
    ).toHaveLength(1);
    expect(
      writeRefusals({
        ...base,
        plan: livePlan,
        fresh: withLive,
        ackLiveDrafts: ["drafts/a"],
      }),
    ).toEqual([]);
  });

  it("scopes problems: global ones always refuse, document ones only at the start", () => {
    const docProblem = {
      path: "competitions/c",
      reason: "born_not_new" as const,
      detail: "",
      scope: "document" as const,
    };
    const withDoc = { ...documents, problems: [docProblem] };
    const started = {
      ...base,
      ledgerStatus: "in_progress" as const,
      plan: {
        ...plan,
        ledger_status: "in_progress" as const,
        documents: withDoc,
      },
      fresh: withDoc,
    };
    // Mid-cutover, one held document does not block the others (N2).
    expect(writeRefusals(started)).toEqual([]);
    // Beginning the cutover needs a clean plan.
    expect(
      writeRefusals({
        ...base,
        plan: { ...plan, documents: withDoc },
        fresh: withDoc,
      }),
    ).toEqual(["the cutover can only begin from a plan with no problems"]);
    const global = { ...docProblem, scope: "global" as const };
    const withGlobal = { ...documents, problems: [global] };
    expect(
      writeRefusals({
        ...started,
        plan: { ...started.plan, documents: withGlobal },
        fresh: withGlobal,
      }),
    ).toEqual(["the plan or a fresh read reports a global problem"]);
  });
});

describe("readProduction", () => {
  const readerOf = (ledgerDoc: unknown): ProductionReader => {
    const docs: Record<string, unknown> = {
      "pools/pool_season_51": { roster: [] },
      "seasons/season_51": { players: [] },
      "events/season_51": {},
      [`${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(51)}`]: ledgerDoc,
    };
    return {
      competitions: async () => [{ id: "c1", data: { draft_picks: [] } }],
      trades: async () => [{ id: "t1", data: {} }],
      drafts: async () => [
        { id: "d1", data: { [RTDB_REMAP_MARKER]: { mapping_hash: HASH } } },
      ],
      doc: async (p) => docs[p] ?? null,
      subcollection: async () => [{ id: "uid1", data: { picks: [] } }],
      adpDocs: async () => [{ id: "season_51_all_drafts", data: {} }],
    };
  };

  it("reads every store, the ledger and its census", async () => {
    const read = await readProduction(
      readerOf({
        mapping_hash: HASH,
        status: "in_progress",
        census: { "competitions/c1": { kind: "competition" } },
        applied: { "competitions/c1": { mapping_hash: HASH } },
      }),
      51,
    );
    expect(read.docs.map((d) => `${d.kind} ${d.path}`)).toEqual([
      "competition competitions/c1",
      "trade competitions/c1/trades/t1",
      "rtdb_draft drafts/d1",
      "pool_config pools/pool_season_51",
      "pool_entry pools/pool_season_51/entries/uid1",
      "season seasons/season_51",
      "season_results events/season_51",
      "castaway_adp castaway_adp/season_51_all_drafts",
    ]);
    expect(read.ledger).toEqual(new Map([["competitions/c1", HASH]]));
    expect(read.ledgerHash).toBe(HASH);
    expect(read.ledgerStatus).toBe("in_progress");
    expect([...read.census!.keys()]).toEqual(["competitions/c1"]);
    expect(read.inventory).toMatchObject({
      "team_assignments/season_51": false,
      rtdb_drafts_marked: 1,
      ledger_census_paths: 1,
    });
  });

  it("stops on a ledger without a census, and ignores a rolled-back one's", async () => {
    await expect(
      readProduction(readerOf({ mapping_hash: HASH, applied: {} }), 51),
    ).rejects.toThrow(/no census/);
    const rolled = await readProduction(
      readerOf({
        mapping_hash: HASH,
        status: "rolled_back",
        census: { x: { kind: "trade" } },
        applied: {},
      }),
      51,
    );
    expect(rolled.census).toBeNull();
    expect(rolled.ledgerStatus).toBe("rolled_back");
  });
});

describe("ledger, gates and marks", () => {
  it("agree on the ledger document with the ADP job", () => {
    expect(remapLedgerPath("season_51")).toBe(
      `${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(51)}`,
    );
  });

  it("reads a ledger's status, counting a legacy one as in progress", () => {
    expect(ledgerStatusOf(null)).toBe("none");
    expect(ledgerStatusOf({ mapping_hash: HASH })).toBe("in_progress");
    expect(ledgerStatusOf({ status: "finalized" })).toBe("finalized");
    expect(ledgerStatusOf({ status: "rolled_back" })).toBe("rolled_back");
  });

  it("holds the ADP job for the whole cutover and freezes pre-premiere after", () => {
    expect(adpCohortAction("none", "pre_premiere")).toBe("compute");
    expect(adpCohortAction("in_progress", "all_drafts")).toBe("hold");
    expect(adpCohortAction("in_progress", "pre_premiere")).toBe("hold");
    expect(adpCohortAction("finalized", "pre_premiere")).toBe("frozen");
    expect(adpCohortAction("rolled_back", "pre_premiere")).toBe("frozen");
    expect(adpCohortAction("finalized", "all_drafts")).toBe("compute");
  });

  it("refuses a season push during the cutover or from the wrong side", () => {
    expect(seasonPushRefusal("season_51", "none", "provisional")).toBeNull();
    expect(seasonPushRefusal("season_51", "in_progress", "remapped")).toMatch(
      /in progress/,
    );
    expect(seasonPushRefusal("season_51", "finalized", "remapped")).toBeNull();
    expect(seasonPushRefusal("season_51", "finalized", "provisional")).toMatch(
      /bundled season file is provisional/,
    );
    expect(seasonPushRefusal("season_51", "none", "remapped")).toMatch(
      /not been remapped/,
    );
    expect(seasonPushRefusal("season_51", "none", "neither")).toMatch(
      /neither/,
    );
    expect(seasonPushRefusal("season_50", "none", null)).toBeNull();
  });

  it("ties a Realtime Database URL to its project (N4)", () => {
    expect(
      databaseUrlRefusal("https://p-default-rtdb.firebaseio.com", "p"),
    ).toBeNull();
    expect(
      databaseUrlRefusal("https://p.europe-west1.firebasedatabase.app/", "p"),
    ).toBeNull();
    expect(
      databaseUrlRefusal("http://127.0.0.1:9000?ns=p-default-rtdb", "p"),
    ).toBeNull();
    expect(
      databaseUrlRefusal("https://q-default-rtdb.firebaseio.com", "p"),
    ).toMatch(/does not belong/);
    expect(databaseUrlRefusal("https://example.com", "p")).toMatch(
      /not a Firebase database/,
    );
    expect(databaseUrlRefusal(undefined, "p")).toMatch(/no Realtime/);
  });

  it("checks the mark a committed write leaves (R3)", () => {
    expect(markHolds("set", HASH, HASH)).toBe(true);
    expect(markHolds("set", undefined, HASH)).toBe(false);
    expect(markHolds("keep", HASH, HASH)).toBe(true);
    expect(markHolds("clear", undefined, HASH)).toBe(true);
    expect(markHolds("clear", HASH, HASH)).toBe(false);
  });
});
