import { describe, expect, it } from "vitest";
import { SEASON_51_CASTAWAY_LOOKUP } from "../../src/data/season_51";
import {
  applyCastawayIdRemap,
  planCastawayIdMapping,
  planDocumentRemap,
  rollbackCastawayIdRemap,
  type CommittedCastaway,
  type RemapDocKind,
  type RemapSourceDoc,
  type RemapStore,
} from "../lib/castaway-id-remap";
import upstreamFixture from "./fixtures/survivor-us51-castaways.json";

const committed: CommittedCastaway[] = Object.entries(
  SEASON_51_CASTAWAY_LOOKUP,
).map(([castaway_id, v]) => ({ castaway_id, ...v }));

const mappingPlan = planCastawayIdMapping(committed, upstreamFixture.castaways);
const mapping = mappingPlan.mappings;
const to = (from: string) => mapping.find((m) => m.from === from)!.to;

const CASTAWAY_KEYS = new Set(["propbet_winner", "propbet_first_vote"]);

describe("planCastawayIdMapping against survivoR 7336413 (Season 51)", () => {
  it("matches all 21 castaways one to one with no errors", () => {
    expect(mappingPlan.errors).toEqual([]);
    expect(mapping).toHaveLength(21);
    expect(new Set(mapping.map((m) => m.to)).size).toBe(21);
  });

  it("is a permutation of the same id range, with 19 ids changing", () => {
    expect(new Set(mapping.map((m) => m.to))).toEqual(
      new Set(mapping.map((m) => m.from)),
    );
    expect(mappingPlan.changed).toHaveLength(19);
    expect(to("US0752")).toBe("US0752"); // Aaliyah Puglia
    expect(to("US0753")).toBe("US0753"); // Alexis Levine
  });

  it("resolves the two name differences", () => {
    const jelly = mapping.find((m) => m.from_name === "Jelly Loblack")!;
    expect(jelly).toMatchObject({
      from: "US0761",
      to: "US0756",
      to_name: "Angelica Loblack",
      matched_by: "short_name_and_surname",
    });
    const thienAn = mapping.find((m) => m.from_name === "Thien An Nguyen")!;
    expect(thienAn).toMatchObject({
      from: "US0772",
      to: "US0754",
      matched_by: "full_name",
    });
  });

  it("pins the full mapping", () => {
    expect(
      Object.fromEntries(mappingPlan.changed.map((m) => [m.from, m.to])),
    ).toEqual({
      US0754: "US0755",
      US0755: "US0757",
      US0756: "US0758",
      US0757: "US0759",
      US0758: "US0760",
      US0759: "US0761",
      US0760: "US0762",
      US0761: "US0756",
      US0762: "US0763",
      US0763: "US0764",
      US0764: "US0765",
      US0765: "US0766",
      US0766: "US0767",
      US0767: "US0768",
      US0768: "US0769",
      US0769: "US0770",
      US0770: "US0771",
      US0771: "US0772",
      US0772: "US0754",
    });
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

const name = (id: string) =>
  SEASON_51_CASTAWAY_LOOKUP[id as keyof typeof SEASON_51_CASTAWAY_LOOKUP]
    .full_name;
const pick = (id: string, order: number) => ({
  season_id: "season_51",
  season_num: 51,
  order,
  user_name: "u",
  user_uid: "uid1",
  castaway_id: id,
  player_name: name(id),
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

const opts = {
  mapping,
  castawayPropBetKeys: CASTAWAY_KEYS,
  appliedPaths: new Set<string>(),
};

describe("planDocumentRemap", () => {
  it("remaps picks and castaway prop bets simultaneously, never chaining", () => {
    const plan = planDocumentRemap([competition], opts);
    expect(plan.problems).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    const after = plan.changes[0].after as {
      draft_picks: { castaway_id: string; player_name: string }[];
      prop_bets: { values: Record<string, string> }[];
    };
    // Ana Sani US0754 -> US0755, Thien An US0772 -> US0754. A chained
    // replace would have sent Thien An on to US0755 as well.
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
    expect(plan.changes[0].id_changes).toBe(3);
    // Only castaway fields are part of the change.
    expect(Object.keys(plan.changes[0].before).sort()).toEqual([
      "draft_picks",
      "prop_bets",
    ]);
  });

  it("remaps trades, the pool roster, answers, and entries", () => {
    const docs: RemapSourceDoc[] = [
      {
        kind: "trade",
        path: "competitions/competition_a/trades/trade_1",
        data: {
          offered_castaway_ids: ["US0754"],
          requested_castaway_ids: ["US0772", "US0753"],
        },
      },
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
    ];
    const plan = planDocumentRemap(docs, opts);
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

  it("marks documents with only unchanged ids as unchanged", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "competition",
          path: "competitions/b",
          data: { draft_picks: [pick("US0752", 1)] },
        },
      ],
      opts,
    );
    expect(plan.unchanged).toEqual(["competitions/b"]);
    expect(plan.changes).toEqual([]);
  });

  it("refuses to remap a document twice", () => {
    const first = planDocumentRemap([competition], opts);
    const remapped: RemapSourceDoc = {
      ...competition,
      data: { ...competition.data, ...first.changes[0].after },
    };
    // Ledgered: skipped.
    const ledgered = planDocumentRemap([remapped], {
      ...opts,
      appliedPaths: new Set([competition.path]),
    });
    expect(ledgered.already_applied).toEqual([competition.path]);
    expect(ledgered.changes).toEqual([]);
    // Not ledgered: names give it away, and it is reported, not re-applied.
    const unledgered = planDocumentRemap([remapped], opts);
    expect(unledgered.changes).toEqual([]);
    expect(unledgered.problems[0].reason).toBe("looks_already_remapped");
  });

  it("reports unknown ids and inconsistent names instead of writing", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "competition",
          path: "competitions/c",
          data: {
            draft_picks: [
              { ...pick("US0754", 1), player_name: "Somebody Else" },
            ],
          },
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

  it("reads RTDB sparse arrays stored as objects", () => {
    const plan = planDocumentRemap(
      [
        {
          kind: "rtdb_draft",
          path: "drafts/draft_x",
          data: { draft_picks: { 0: pick("US0754", 1) } },
        },
      ],
      opts,
    );
    expect(plan.changes[0].after.draft_picks).toEqual([
      { ...pick("US0754", 1), castaway_id: "US0755" },
    ]);
  });
});

/** An in-memory store with the same compare-and-set contract. */
function memoryStore(docs: Record<string, Record<string, unknown>>) {
  const ledger = new Set<string>();
  const store: RemapStore = {
    async compareAndSet(_kind: RemapDocKind, path, expected, next) {
      const current = docs[path];
      for (const [k, v] of Object.entries(expected)) {
        if (JSON.stringify(current?.[k]) !== JSON.stringify(v)) return false;
      }
      docs[path] = { ...current, ...next };
      return true;
    },
    async setLedger(path, applied) {
      if (applied) ledger.add(path);
      else ledger.delete(path);
    },
  };
  return { store, ledger, docs };
}

describe("applyCastawayIdRemap and rollbackCastawayIdRemap", () => {
  it("applies once, is idempotent on re-plan, and rolls back exactly", async () => {
    const original = structuredClone(competition.data);
    const { store, ledger, docs } = memoryStore({
      [competition.path]: structuredClone(competition.data),
    });
    const plan = planDocumentRemap([competition], opts);

    const applied = await applyCastawayIdRemap(plan.changes, store);
    expect(applied).toEqual({ applied: [competition.path], stale: [] });
    expect(ledger.has(competition.path)).toBe(true);

    // A second dry run over the new state plans nothing.
    const replan = planDocumentRemap(
      [{ ...competition, data: docs[competition.path] }],
      { ...opts, appliedPaths: ledger },
    );
    expect(replan.changes).toEqual([]);
    expect(replan.already_applied).toEqual([competition.path]);

    const rolled = await rollbackCastawayIdRemap(plan.changes, store);
    expect(rolled.applied).toEqual([competition.path]);
    expect(docs[competition.path]).toEqual(original);
    expect(ledger.size).toBe(0);
  });

  it("skips a document that changed after the plan was made", async () => {
    const { store, docs } = memoryStore({
      [competition.path]: structuredClone(competition.data),
    });
    const plan = planDocumentRemap([competition], opts);
    // A live draft takes another pick between plan and apply.
    (docs[competition.path].draft_picks as unknown[]).push(pick("US0760", 4));
    const result = await applyCastawayIdRemap(plan.changes, store);
    expect(result).toEqual({ applied: [], stale: [competition.path] });
    expect(
      (docs[competition.path].draft_picks as { castaway_id: string }[])[0]
        .castaway_id,
    ).toBe("US0754");
  });
});
