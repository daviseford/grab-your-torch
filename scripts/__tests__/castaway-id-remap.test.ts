import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { SEASON_51_CASTAWAY_LOOKUP } from "../../src/data/season_51";
import {
  applyCastawayIdRemap,
  type CastawayIdMappingFile,
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
import { remapLedgerPath } from "../recompute-castaway-adp";
import {
  markAllows,
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

const provisionalCast: CommittedCastaway[] = Object.entries(
  SEASON_51_CASTAWAY_LOOKUP,
).map(([castaway_id, v]) => ({ castaway_id, ...v }));

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

  it("is provisional today", () => {
    expect(classifyCommittedCast(provisionalCast, mappings)).toBe(
      "provisional",
    );
  });

  it("rewrites to exactly survivoR's ids, names and short names, adding no results", () => {
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
  });
});

/* ------------------------------------------------------------------ *
 * Documents
 * ------------------------------------------------------------------ */

const oldName = (id: string) =>
  SEASON_51_CASTAWAY_LOOKUP[id as keyof typeof SEASON_51_CASTAWAY_LOOKUP]
    .full_name;
const pick = (id: string, order: number, name = oldName(id)) => ({
  season_id: "season_51",
  season_num: 51,
  order,
  user_name: "u",
  user_uid: "uid1",
  castaway_id: id,
  player_name: name,
});

const competition: RemapSourceDoc = {
  kind: "competition",
  path: "competitions/competition_a",
  data: {
    competition_name: "A",
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
    expect(plan.changes.map((c) => c.after)).toEqual([
      {
        offered_castaway_ids: ["US0755"],
        requested_castaway_ids: ["US0754", "US0753"],
      },
      {
        roster: [
          { castaway_id: "US0756", full_name: "Angelica Loblack" },
          { castaway_id: "US0752", full_name: "Aaliyah Puglia" },
        ],
        prop_bet_answers: ["US0756", "US0752", "Yes", "No"],
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
          kind: "team_assignments",
          path: "team_assignments/season_51",
          data: { "1": { US0754: "team_a", US0772: null } },
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

  it("refuses season results rather than remapping them", () => {
    const plan = planDocumentRemap(
      [
        { kind: "season_results", path: "events/season_51", data: {} },
        {
          kind: "season_results",
          path: "eliminations/season_51",
          data: { elimination_1: { castaway_id: "US0752" } },
        },
      ],
      opts,
    );
    expect(plan.unchanged).toEqual(["events/season_51"]);
    expect(plan.problems.map((p) => p.reason)).toEqual([
      "season_results_present",
    ]);
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
    expect(plan.problems[0].reason).toBe("applied_with_other_mapping");
  });
});

/* ------------------------------------------------------------------ *
 * Apply, interruption, repair, rollback
 * ------------------------------------------------------------------ */

/**
 * An in-memory store with the production contract: fields and mark are
 * checked and written together, or nothing is. Firestore marks live in a
 * ledger map, RTDB marks inside the node, as in production.
 */
function memoryStore(initial: readonly RemapSourceDoc[]) {
  const docs = new Map(
    initial.map((d) => [d.path, structuredClone(d.data)] as const),
  );
  const ledger = new Map<string, string>();
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
      const updated = { ...current, ...structuredClone(next) };
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
    initial.map((d) => ({ ...d, data: structuredClone(docs.get(d.path)!) }));
  const replan = (): RemapDocumentPlan =>
    planDocumentRemap(current(), { ...opts, ledger });
  return {
    store,
    docs,
    ledger,
    replan,
    killAfter: (n: number) => (failAfter = n),
  };
}

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

describe("applyCastawayIdRemap and rollbackCastawayIdRemap", () => {
  it("applies once; a re-plan finds everything applied and plans nothing", async () => {
    const all = [competition, trade, draft];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    expect(await applyCastawayIdRemap(plan.changes, mem.store)).toEqual({
      applied: all.map((d) => d.path),
      stale: [],
    });
    const replan = mem.replan();
    expect(replan.changes).toEqual([]);
    expect(replan.problems).toEqual([]);
    expect(replan.already_applied).toEqual(all.map((d) => d.path));
    // Re-running the same plan is refused document by document.
    expect(await applyCastawayIdRemap(plan.changes, mem.store)).toEqual({
      applied: [],
      stale: all.map((d) => d.path),
    });
  });

  it("never double-applies a nameless document after an interrupted run", async () => {
    // The trade stores ids alone, so only its mark can say it was remapped.
    const all = [trade, competition, draft];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
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
    await applyCastawayIdRemap(
      planDocumentRemap([draft], opts).changes,
      mem.store,
    );
    // A client still on the old season document takes Thien An as US0772.
    (mem.docs.get(draft.path)!.draft_picks as unknown[]).push(
      pick("US0772", 2),
    );
    const replan = mem.replan();
    expect(replan.problems).toEqual([]);
    expect(replan.changes).toHaveLength(1);
    expect(replan.changes[0].mode).toBe("repair");
    await applyCastawayIdRemap(replan.changes, mem.store);
    expect(
      (
        mem.docs.get(draft.path)!.draft_picks as ({
          castaway_id: string;
        } | null)[]
      ).map((p) => p?.castaway_id ?? null),
    ).toEqual([null, "US0755", "US0754"]);
    expect(mem.replan().already_applied).toEqual([draft.path]);
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
    });
    expect(mem.ledger.size).toBe(0);
  });

  it("rolls back exactly and clears every mark", async () => {
    const all = [competition, trade, draft];
    const mem = memoryStore(all);
    const plan = planDocumentRemap(all, opts);
    await applyCastawayIdRemap(plan.changes, mem.store);
    const rolled = await rollbackCastawayIdRemap(plan.changes, mem.store);
    expect(rolled.applied).toEqual(all.map((d) => d.path).reverse());
    for (const d of all) expect(mem.docs.get(d.path)).toEqual(d.data);
    expect(mem.ledger.size).toBe(0);
  });

  it("compares fields regardless of object key order", () => {
    expect(fieldsEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(
      true,
    );
    expect(fieldsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * CLI guards and production reading
 * ------------------------------------------------------------------ */

describe("parseArgs", () => {
  it("requires --plan and --project for writes, and one mode at a time", () => {
    expect(() => parseArgs(["51", "--write"])).toThrow(/--plan/);
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
      ]),
    ).toMatchObject({
      seasonNum: 51,
      write: true,
      plan: "p.json",
      project: "proj",
      ackLiveDrafts: ["drafts/a"],
    });
  });
});

describe("writeRefusals", () => {
  const documents = planDocumentRemap([competition], opts);
  const plan: RemapPlanFile = {
    season_num: 51,
    created_at: "2026-09-26T12:00:00.000Z",
    project_id: "proj",
    mapping_hash: HASH,
    upstream_commit: committedFile.upstream.commit,
    local_season_file: "provisional",
    inventory: {},
    documents,
  };
  const base = {
    plan,
    seasonNum: 51,
    project: "proj",
    adminProjectId: "proj",
    mappingHash: HASH,
    ledgerHash: null,
    now: new Date("2026-09-26T13:00:00.000Z"),
    maxPlanAgeHours: 6,
    fresh: documents,
    ackLiveDrafts: [] as string[],
  };

  it("allows a fresh, matching plan", () => {
    expect(writeRefusals(base)).toEqual([]);
  });

  it("binds the plan to the project, mapping, ledger and age", () => {
    expect(writeRefusals({ ...base, adminProjectId: "other" })).toHaveLength(1);
    expect(
      writeRefusals({ ...base, plan: { ...plan, project_id: "other" } }),
    ).toHaveLength(1);
    expect(writeRefusals({ ...base, mappingHash: "x" })).toHaveLength(1);
    expect(writeRefusals({ ...base, ledgerHash: "x" })).toHaveLength(1);
    expect(
      writeRefusals({ ...base, now: new Date("2026-09-27T12:00:00.000Z") }),
    ).toEqual(["the plan is 24.0h old; dry-run again"]);
  });

  it("refuses when production moved since review, or a draft is live", () => {
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
    const live = { ...documents, live_drafts: ["drafts/a"] };
    expect(writeRefusals({ ...base, fresh: live })).toHaveLength(1);
    expect(
      writeRefusals({ ...base, fresh: live, ackLiveDrafts: ["drafts/a"] }),
    ).toEqual([]);
  });
});

describe("readProduction", () => {
  it("reads every store and the ledger", async () => {
    const docs: Record<string, unknown> = {
      "pools/pool_season_51": { roster: [] },
      "seasons/season_51": { players: [] },
      "events/season_51": {},
      [`${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(51)}`]: {
        mapping_hash: HASH,
        applied: { "competitions/c1": { mapping_hash: HASH } },
      },
    };
    const reader: ProductionReader = {
      competitions: async () => [{ id: "c1", data: { draft_picks: [] } }],
      trades: async () => [{ id: "t1", data: {} }],
      drafts: async () => [
        { id: "d1", data: { [RTDB_REMAP_MARKER]: { mapping_hash: HASH } } },
      ],
      doc: async (p) => docs[p] ?? null,
      subcollection: async () => [{ id: "uid1", data: { picks: [] } }],
      adpDocs: async () => [{ id: "season_51_all_drafts", data: {} }],
    };
    const read = await readProduction(reader, 51);
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
    expect(read.inventory).toMatchObject({
      "team_assignments/season_51": false,
      rtdb_drafts_marked: 1,
    });
  });
});

describe("ADP job and the remap ledger", () => {
  it("agree on the ledger document", () => {
    expect(remapLedgerPath("season_51")).toBe(
      `${REMAP_LEDGER_COLLECTION}/${remapLedgerDocId(51)}`,
    );
  });
});
