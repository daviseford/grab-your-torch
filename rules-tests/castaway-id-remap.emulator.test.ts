/**
 * The Season 51 castaway id remap, end to end against the Firestore and
 * Realtime Database emulators.
 *
 * The unit tests in scripts/__tests__/castaway-id-remap.test.ts cover the
 * planning logic with an in-memory store. These run the real Firebase store
 * (Firestore transactions with the ledger, RTDB transactions with the in-node
 * marker) and the same exported flows the CLI runs: begin the cutover, repair
 * and classify what arrives afterwards, finalize, and roll back inside the
 * window. Nothing here touches a real project: the Admin SDK is pointed at the
 * emulators `yarn test:rules` starts, under a demo project id.
 */

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CastawayIdMappingFile } from "../scripts/lib/castaway-id-remap";
import { buildCensus } from "../scripts/lib/castaway-id-remap";
import {
  readRemapLedgerStatus,
  seasonPushRefusal,
} from "../scripts/lib/remap-ledger";
import { adpCohortAction } from "../scripts/recompute-castaway-adp";
import {
  type Admin,
  castawayPropBetKeys,
  dryRun,
  firebaseReader,
  planFromProduction,
  productionStore,
  readProduction,
  type RemapContext,
  type RemapPlanFile,
  runFinalize,
  runRollback,
  runWrite,
} from "../scripts/remap-castaway-ids";

const PROJECT_ID = "demo-survivor-fantasy-rules";
const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!FIRESTORE_HOST || !DATABASE_HOST) {
  // Never fall through to a real project.
  throw new Error("Run through `yarn test:rules`: the emulators are not up");
}
const DATABASE_URL = `http://${DATABASE_HOST}?ns=${PROJECT_ID}-default-rtdb`;

const mapping = JSON.parse(
  fs.readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "scripts",
      "castaway-id-remaps",
      "season_51.json",
    ),
    "utf-8",
  ),
) as CastawayIdMappingFile;
const oldName = (id: string) =>
  mapping.mappings.find((m) => m.from === id)!.from_name;
const newName = (id: string) =>
  mapping.mappings.find((m) => m.to === id)!.to_name;

let app: ReturnType<typeof initializeApp>;
let admin: Admin;
let ctx: RemapContext;

beforeAll(async () => {
  app = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "castaway-id-remap-emulator",
  );
  admin = {
    projectId: PROJECT_ID,
    databaseUrl: DATABASE_URL,
    firestore: getFirestore(app),
    rtdb: getDatabase(app),
  };
  ctx = {
    seasonNum: 51,
    mapping,
    propKeys: await castawayPropBetKeys(),
    acceptBorn: [],
  };
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  expect(res.ok).toBe(true);
  await admin.rtdb.ref().set(null);
});

/* ------------------------------------------------------------------ *
 * Seed: Season 51 as production holds it, on provisional ids
 * ------------------------------------------------------------------ */

const pick = (id: string, order: number, uid: string, name = oldName(id)) => ({
  season_id: "season_51",
  season_num: 51,
  order,
  user_name: uid,
  user_uid: uid,
  castaway_id: id,
  player_name: name,
});
const newPick = (id: string, order: number, uid: string) =>
  pick(id, order, uid, newName(id));

const leaguePicks = [
  pick("US0754", 1, "uid1"), // Ana Sani -> US0755
  pick("US0772", 2, "uid2"), // Thien An Nguyen -> US0754
  pick("US0756", 3, "uid1"), // Carter Krull -> US0758
  pick("US0761", 4, "uid2"), // Jelly Loblack -> US0756 Angelica Loblack
];
const leagueProps = {
  uid1: {
    id: "propbet_1",
    user_uid: "uid1",
    user_name: "uid1",
    values: { propbet_winner: "US0772", propbet_medical_evac: "Yes" },
  },
  uid2: {
    id: "propbet_2",
    user_uid: "uid2",
    user_name: "uid2",
    values: { propbet_winner: "US0754" },
  },
};

const firestoreSeed: Record<string, Record<string, unknown>> = {
  "seasons/season_51": {
    id: "season_51",
    order: 51,
    name: "Survivor 51",
    img: "",
    episodes: [],
    players: mapping.mappings.map((m) => ({
      season_id: "season_51",
      season_num: 51,
      castaway_id: m.from,
      full_name: m.from_name,
      img: `/images/season_51/${m.from_name.replace(/ /g, "-")}.jpg`,
    })),
    castawayLookup: Object.fromEntries(
      mapping.mappings.map((m) => [
        m.from,
        { full_name: m.from_name, castaway: m.from_name.split(" ")[0] },
      ]),
    ),
  },
  "pools/pool_season_51": {
    season_id: "season_51",
    roster: mapping.mappings.map((m) => ({
      castaway_id: m.from,
      full_name: m.from_name,
    })),
    prop_bet_answers: [...mapping.mappings.map((m) => m.from), "Yes", "No"],
  },
  "pools/pool_season_51/entries/uidA": {
    handle: "alpha",
    picks: [{ castaway_id: "US0761", full_name: "Jelly Loblack" }],
    prop_bets: { propbet_winner: "US0772" },
  },
  "competitions/competition_league": {
    id: "competition_league",
    season_id: "season_51",
    season_num: 51,
    draft_id: "draft_league",
    competition_name: "League",
    draft_picks: leaguePicks,
    prop_bets: Object.values(leagueProps),
  },
  "competitions/competition_league/trades/trade_old": {
    id: "trade_old",
    season_id: "season_51",
    competition_id: "competition_league",
    offered_by_uid: "uid1",
    offered_to_uid: "uid2",
    offered_castaway_ids: ["US0754"],
    requested_castaway_ids: ["US0772"],
    status: "accepted",
  },
  "competitions/competition_s50": {
    id: "competition_s50",
    season_id: "season_50",
    draft_picks: [pick("US0754", 1, "uid1")],
  },
  "castaway_adp/season_51_all_drafts": {
    season_id: "season_51",
    cohort: "all_drafts",
    castaways: { US0754: { adp: 1.5, picks: 3 }, US0772: { adp: 9, picks: 2 } },
  },
  "events/season_51": {},
  "challenges/season_51": {},
};

const rtdbSeed: Record<string, Record<string, unknown>> = {
  draft_league: {
    id: "draft_league",
    season_id: "season_51",
    state: { started: true, finished: true },
    participants: { uid1: { uid: "uid1" }, uid2: { uid: "uid2" } },
    draft_picks: Object.fromEntries(leaguePicks.map((p) => [p.order, p])),
    prop_bets: leagueProps,
  },
  draft_lobby: {
    id: "draft_lobby",
    season_id: "season_51",
    state: { started: false, finished: false },
    participants: { uid3: { uid: "uid3" } },
  },
  draft_waiting: {
    id: "draft_waiting",
    season_id: "season_51",
    state: { started: true, finished: true },
    participants: { uid4: { uid: "uid4" }, uid5: { uid: "uid5" } },
    draft_picks: {
      1: pick("US0760", 1, "uid4"),
      2: pick("US0765", 2, "uid5"),
    },
    prop_bets: {
      uid4: { user_uid: "uid4", values: { propbet_winner: "US0760" } },
    },
  },
  draft_s50: {
    id: "draft_s50",
    season_id: "season_50",
    draft_picks: { 1: pick("US0754", 1, "uid1") },
  },
};

async function seed(overrides: Record<string, Record<string, unknown>> = {}) {
  const batch = admin.firestore.batch();
  for (const [p, data] of Object.entries({ ...firestoreSeed, ...overrides })) {
    batch.set(admin.firestore.doc(p), data);
  }
  await batch.commit();
  await admin.rtdb.ref("drafts").set(rtdbSeed);
}

const fsDoc = async (p: string) =>
  (await admin.firestore.doc(p).get()).data() as Record<string, unknown>;
const rtNode = async (p: string) =>
  (await admin.rtdb.ref(p).once("value")).val() as Record<string, unknown>;
const ledger = () => fsDoc("admin_migrations/castaway_id_remap_season_51");
const idsOf = (picks: unknown) =>
  Object.values(picks as object)
    .filter(Boolean)
    .map((p: { castaway_id: string }) => p.castaway_id);

/** Dry run, then write with the live draft acknowledged. */
async function cutover(): Promise<RemapPlanFile> {
  const plan = await dryRun(admin, ctx, "provisional");
  const outcome = await runWrite(admin, ctx, {
    plan,
    project: PROJECT_ID,
    ackLiveDrafts: ["drafts/draft_waiting"],
    maxPlanAgeHours: 1,
  });
  expect(outcome.refusals).toEqual([]);
  return plan;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("beginning the cutover", () => {
  it("refuses an unacknowledged live draft, then switches the season first and marks every census document", async () => {
    await seed();
    const plan = await dryRun(admin, ctx, "provisional");
    expect(plan.ledger_status).toBe("none");
    expect(plan.documents.problems).toEqual([]);
    expect(plan.documents.live_drafts).toEqual(["drafts/draft_waiting"]);
    expect(plan.documents.changes).toHaveLength(9);

    const refused = await runWrite(admin, ctx, {
      plan,
      project: PROJECT_ID,
      ackLiveDrafts: [],
      maxPlanAgeHours: 1,
    });
    expect(refused.refusals).toHaveLength(1);
    expect(refused.refusals[0]).toMatch(/live/);
    expect(await ledger()).toBeUndefined();

    const outcome = await runWrite(admin, ctx, {
      plan,
      project: PROJECT_ID,
      ackLiveDrafts: ["drafts/draft_waiting"],
      maxPlanAgeHours: 1,
    });
    if (!("result" in outcome)) throw new Error(outcome.refusals.join("; "));
    expect(outcome.began).toBe(true);
    expect(outcome.result.stale).toEqual([]);
    expect(outcome.result.applied[0]).toBe("seasons/season_51");
    expect(outcome.after.changes).toEqual([]);
    expect(outcome.after.problems).toEqual([]);

    // Picks, names and prop bets, with one lookup each.
    const comp = await fsDoc("competitions/competition_league");
    expect(
      (comp.draft_picks as { castaway_id: string; player_name: string }[]).map(
        (p) => `${p.castaway_id} ${p.player_name}`,
      ),
    ).toEqual([
      "US0755 Ana Sani",
      "US0754 Thien An Nguyen",
      "US0758 Carter Krull",
      "US0756 Angelica Loblack",
    ]);
    expect(
      (comp.prop_bets as { values: Record<string, string> }[])[0].values,
    ).toEqual({ propbet_winner: "US0754", propbet_medical_evac: "Yes" });
    expect(
      await fsDoc("competitions/competition_league/trades/trade_old"),
    ).toMatchObject({
      offered_castaway_ids: ["US0755"],
      requested_castaway_ids: ["US0754"],
    });
    const season = await fsDoc("seasons/season_51");
    expect(
      (season.castawayLookup as Record<string, { full_name: string }>).US0756
        .full_name,
    ).toBe("Angelica Loblack");
    expect(
      Object.keys(
        (await fsDoc("castaway_adp/season_51_all_drafts")).castaways as object,
      ).sort(),
    ).toEqual(["US0754", "US0755"]);
    expect(await fsDoc("pools/pool_season_51/entries/uidA")).toMatchObject({
      picks: [{ castaway_id: "US0756", full_name: "Angelica Loblack" }],
      prop_bets: { propbet_winner: "US0754" },
    });

    // RTDB containers survive: picks keyed from 1, prop bets keyed by uid.
    const league = await rtNode("drafts/draft_league");
    expect(Array.isArray(league.draft_picks)).toBe(true);
    expect((league.draft_picks as unknown[])[0]).toBeUndefined();
    expect(idsOf(league.draft_picks)).toEqual([
      "US0755",
      "US0754",
      "US0758",
      "US0756",
    ]);
    expect(Object.keys(league.prop_bets as object)).toEqual(["uid1", "uid2"]);
    // The empty lobby is marked too, so later picks read as survivoR's.
    expect(
      (await rtNode("drafts/draft_lobby")).castaway_id_remap,
    ).toMatchObject({ mapping_hash: mapping.mapping_hash, origin: "remapped" });

    // Other seasons are untouched.
    expect(await fsDoc("competitions/competition_s50")).toEqual(
      firestoreSeed["competitions/competition_s50"],
    );
    expect(idsOf((await rtNode("drafts/draft_s50")).draft_picks)).toEqual([
      "US0754",
    ]);

    // The ledger records the census and every mark; the other jobs hold.
    const l = await ledger();
    expect(l.status).toBe("in_progress");
    expect(Object.keys(l.census as object).sort()).toEqual(
      [
        "castaway_adp/season_51_all_drafts",
        "competitions/competition_league",
        "competitions/competition_league/trades/trade_old",
        "drafts/draft_league",
        "drafts/draft_lobby",
        "drafts/draft_waiting",
        "pools/pool_season_51",
        "pools/pool_season_51/entries/uidA",
        "seasons/season_51",
      ].sort(),
    );
    expect(Object.keys(l.applied as object)).toHaveLength(6);
    const status = await readRemapLedgerStatus(admin.firestore, "season_51");
    expect(status).toBe("in_progress");
    expect(seasonPushRefusal("season_51", status, "remapped")).toMatch(
      /in progress/,
    );
    expect(adpCohortAction(status, "all_drafts")).toBe("hold");
  });

  it("refuses an RTDB instance of another project (N4) and embedded season results (R1)", async () => {
    await seed();
    const plan = await dryRun(admin, ctx, "provisional");
    const elsewhere = {
      ...admin,
      databaseUrl: "https://someone-else-default-rtdb.firebaseio.com",
    };
    const refused = await runWrite(elsewhere, ctx, {
      plan,
      project: PROJECT_ID,
      ackLiveDrafts: ["drafts/draft_waiting"],
      maxPlanAgeHours: 1,
    });
    expect(refused.refusals.join("; ")).toMatch(
      /does not belong to project demo-survivor-fantasy-rules/,
    );

    await admin.firestore
      .doc("seasons/season_51")
      .update({ events: { event_1: { castaway_id: "US0760" } } });
    const withResults = await dryRun(admin, ctx, "provisional");
    expect(withResults.documents.problems).toMatchObject([
      {
        path: "seasons/season_51",
        reason: "season_results_present",
        scope: "global",
      },
    ]);
    const blocked = await runWrite(admin, ctx, {
      plan: withResults,
      project: PROJECT_ID,
      ackLiveDrafts: ["drafts/draft_waiting"],
      maxPlanAgeHours: 1,
    });
    expect(blocked.refusals.length).toBeGreaterThan(0);
    expect(await ledger()).toBeUndefined();
  });
});

describe("after the cutover began", () => {
  it("classifies new documents, repairs stale picks, holds a duplicate, and never remaps anything twice (N1, N2, N3)", async () => {
    await seed();
    await cutover();

    // A trade offered on survivoR's ids: Ana (US0755) for Thien An (US0754).
    const bornTrade = {
      id: "trade_new",
      season_id: "season_51",
      competition_id: "competition_league",
      offered_by_uid: "uid1",
      offered_to_uid: "uid2",
      offered_castaway_ids: ["US0755"],
      requested_castaway_ids: ["US0754"],
      status: "pending",
    };
    await admin.firestore
      .doc("competitions/competition_league/trades/trade_new")
      .set(bornTrade);
    // A new league drafted and saved on survivoR's ids.
    const freshPick = newPick("US0754", 1, "uid9");
    const freshProps = {
      uid9: { user_uid: "uid9", values: { propbet_winner: "US0756" } },
    };
    await admin.rtdb.ref("drafts/draft_fresh").set({
      id: "draft_fresh",
      season_id: "season_51",
      state: { started: true, finished: true },
      participants: { uid9: { uid: "uid9" } },
      draft_picks: { 1: freshPick },
      prop_bets: freshProps,
    });
    await admin.firestore.doc("competitions/competition_fresh").set({
      id: "competition_fresh",
      season_id: "season_51",
      draft_id: "draft_fresh",
      draft_picks: [freshPick],
      prop_bets: Object.values(freshProps),
    });
    // A stale client takes Jelly under her provisional id in the lobby.
    await admin.rtdb
      .ref("drafts/draft_lobby/draft_picks/1")
      .set(pick("US0761", 1, "uid3"));
    // And another offers Ana again under her provisional id: a duplicate.
    await admin.rtdb
      .ref("drafts/draft_league/draft_picks/5")
      .set(pick("US0754", 5, "uid2"));

    const plan = await dryRun(admin, ctx, "provisional");
    expect(plan.ledger_status).toBe("in_progress");
    expect(plan.documents.changes.map((c) => [c.path, c.mode]).sort()).toEqual(
      [
        ["competitions/competition_fresh", "born"],
        ["competitions/competition_league/trades/trade_new", "born"],
        ["drafts/draft_fresh", "born"],
        ["drafts/draft_lobby", "repair"],
      ].sort(),
    );
    expect(plan.documents.problems).toMatchObject([
      {
        path: "drafts/draft_league",
        reason: "duplicate_castaway",
        scope: "document",
      },
    ]);

    // One held document does not block the rest.
    const outcome = await runWrite(admin, ctx, {
      plan,
      project: PROJECT_ID,
      ackLiveDrafts: [],
      maxPlanAgeHours: 1,
    });
    if (!("result" in outcome)) throw new Error(outcome.refusals.join("; "));
    expect(outcome.began).toBe(false);
    expect(outcome.result.stale).toEqual([]);

    expect(
      await fsDoc("competitions/competition_league/trades/trade_new"),
    ).toEqual(bornTrade);
    expect(
      await fsDoc("competitions/competition_league/trades/trade_old"),
    ).toMatchObject({
      offered_castaway_ids: ["US0755"],
      requested_castaway_ids: ["US0754"],
    });
    expect(
      ((await ledger()).applied as Record<string, { origin: string }>)[
        "competitions/competition_league/trades/trade_new"
      ].origin,
    ).toBe("born");
    expect(
      (await rtNode("drafts/draft_fresh")).castaway_id_remap,
    ).toMatchObject({ origin: "born" });
    expect((await fsDoc("competitions/competition_fresh")).draft_picks).toEqual(
      [freshPick],
    );
    const lobby = (await rtNode("drafts/draft_lobby")).draft_picks as {
      castaway_id: string;
      player_name: string;
    }[];
    expect(lobby[1]).toMatchObject({
      castaway_id: "US0756",
      player_name: "Angelica Loblack",
    });
    // The held draft keeps its duplicate for a person to resolve.
    expect(idsOf((await rtNode("drafts/draft_league")).draft_picks)).toEqual([
      "US0755",
      "US0754",
      "US0758",
      "US0756",
      "US0754",
    ]);

    const again = await planFromProduction(admin, ctx);
    expect(again.documents.changes).toEqual([]);
    expect(again.documents.problems.map((p) => p.reason)).toEqual([
      "duplicate_castaway",
    ]);
  });

  it("resumes an interrupted cutover without remapping anything twice", async () => {
    await seed();
    const plan = await dryRun(admin, ctx, "provisional");
    // What runWrite does, killed after the fourth document.
    const read = await readProduction(firebaseReader(admin), 51);
    await admin.firestore
      .doc("admin_migrations/castaway_id_remap_season_51")
      .set({
        season_num: 51,
        mapping_hash: mapping.mapping_hash,
        upstream_commit: mapping.upstream.commit,
        status: "in_progress",
        started_at: new Date().toISOString(),
        census: buildCensus(read.docs),
        applied: {},
      });
    const store = productionStore(admin, 51, mapping.mapping_hash);
    for (const c of plan.documents.changes.slice(0, 4)) {
      expect(
        await store.compareAndSet(
          c,
          c.before,
          c.after,
          c.mode === "repair" ? "keep" : "set",
        ),
      ).toBe(true);
    }
    expect(plan.documents.changes.slice(0, 4).map((c) => c.path)).toEqual([
      "seasons/season_51",
      "pools/pool_season_51",
      "competitions/competition_league",
      "competitions/competition_league/trades/trade_old",
    ]);
    // A born trade arrives in the gap, on survivoR's ids.
    await admin.firestore
      .doc("competitions/competition_league/trades/trade_gap")
      .set({
        offered_by_uid: "uid1",
        offered_to_uid: "uid2",
        offered_castaway_ids: ["US0758"],
        requested_castaway_ids: ["US0756"],
        status: "pending",
      });

    const resume = await dryRun(admin, ctx, "provisional");
    expect(resume.documents.problems).toEqual([]);
    expect(
      resume.documents.changes.map((c) => `${c.path}:${c.mode}`).sort(),
    ).toEqual(
      [
        "castaway_adp/season_51_all_drafts:remap",
        "competitions/competition_league/trades/trade_gap:born",
        "drafts/draft_league:remap",
        "drafts/draft_lobby:remap",
        "drafts/draft_waiting:remap",
        "pools/pool_season_51/entries/uidA:remap",
      ].sort(),
    );
    const outcome = await runWrite(admin, ctx, {
      plan: resume,
      project: PROJECT_ID,
      ackLiveDrafts: ["drafts/draft_waiting"],
      maxPlanAgeHours: 1,
    });
    if (!("result" in outcome)) throw new Error(outcome.refusals.join("; "));
    expect(outcome.after.changes).toEqual([]);
    expect(
      await fsDoc("competitions/competition_league/trades/trade_old"),
    ).toMatchObject({ offered_castaway_ids: ["US0755"] });
    expect(
      await fsDoc("competitions/competition_league/trades/trade_gap"),
    ).toMatchObject({ offered_castaway_ids: ["US0758"] });
  });

  it("refuses to place a prop bet submitted during the cutover", async () => {
    await seed();
    const plan = await dryRun(admin, ctx, "provisional");
    // Begin, then a prop bet lands in the acknowledged draft before its turn.
    const read = await readProduction(firebaseReader(admin), 51);
    await admin.firestore
      .doc("admin_migrations/castaway_id_remap_season_51")
      .set({
        season_num: 51,
        mapping_hash: mapping.mapping_hash,
        status: "in_progress",
        census: buildCensus(read.docs),
        applied: {},
      });
    await admin.rtdb
      .ref("drafts/draft_waiting/prop_bets/uid5")
      .set({ user_uid: "uid5", values: { propbet_winner: "US0765" } });
    const result = await (async () => {
      const store = productionStore(admin, 51, mapping.mapping_hash);
      const waiting = plan.documents.changes.find(
        (c) => c.path === "drafts/draft_waiting",
      )!;
      // Its compare-and-set sees the new prop bet and writes nothing.
      return store.compareAndSet(waiting, waiting.before, waiting.after, "set");
    })();
    expect(result).toBe(false);
    const again = await planFromProduction(admin, ctx);
    expect(again.documents.problems).toMatchObject([
      {
        path: "drafts/draft_waiting",
        reason: "prop_bet_epoch_unknown",
        scope: "document",
      },
    ]);
    expect(
      again.documents.changes.some((c) => c.path === "drafts/draft_waiting"),
    ).toBe(false);
  });
});

describe("finalize and rollback", () => {
  it("rolls back inside the window, then a fresh cutover can begin", async () => {
    await seed();
    const plan = await cutover();
    const outcome = await runRollback(admin, ctx, {
      plan,
      project: PROJECT_ID,
    });
    if (!("result" in outcome)) throw new Error(outcome.refusals.join("; "));
    expect(outcome.result.stale).toEqual([]);
    expect(outcome.result.applied.at(-1)).toBe("seasons/season_51");
    expect(outcome.rolledBack).toBe(true);

    for (const [p, data] of Object.entries(firestoreSeed)) {
      expect(await fsDoc(p)).toEqual(data);
    }
    const league = await rtNode("drafts/draft_league");
    expect(league.castaway_id_remap).toBeUndefined();
    expect(idsOf(league.draft_picks)).toEqual(idsOf(leaguePicks));
    expect(
      (await rtNode("drafts/draft_lobby")).castaway_id_remap,
    ).toBeUndefined();
    expect((await ledger()).status).toBe("rolled_back");

    const again = await dryRun(admin, ctx, "provisional");
    expect(again.ledger_status).toBe("rolled_back");
    expect(again.documents.changes).toHaveLength(9);
    const second = await runWrite(admin, ctx, {
      plan: again,
      project: PROJECT_ID,
      ackLiveDrafts: ["drafts/draft_waiting"],
      maxPlanAgeHours: 1,
    });
    expect("began" in second && second.began).toBe(true);
    expect((await ledger()).status).toBe("in_progress");
  });

  it("refuses to roll back once a document was created on survivoR's ids", async () => {
    await seed();
    const plan = await cutover();
    await admin.rtdb.ref("drafts/draft_new").set({
      id: "draft_new",
      season_id: "season_51",
      state: { started: false },
    });
    const outcome = await runRollback(admin, ctx, {
      plan,
      project: PROJECT_ID,
    });
    expect(outcome.refusals.join("; ")).toMatch(/roll forward instead/);
    expect(
      idsOf((await fsDoc("competitions/competition_league")).draft_picks),
    ).toEqual(["US0755", "US0754", "US0758", "US0756"]);
  });

  it("finalizes only when every census document is marked and the bundle is remapped; then it is forward only", async () => {
    await seed();
    const plan = await cutover();

    const provisional = await runFinalize(admin, ctx, {
      project: PROJECT_ID,
      localState: "provisional",
    });
    expect(provisional.refusals.join("; ")).toMatch(/bundled season file/);

    // An unresolved problem holds it too.
    await admin.rtdb
      .ref("drafts/draft_league/draft_picks/5")
      .set(pick("US0754", 5, "uid2"));
    const held = await runFinalize(admin, ctx, {
      project: PROJECT_ID,
      localState: "remapped",
    });
    expect(held.refusals.join("; ")).toMatch(/problem/);
    await admin.rtdb.ref("drafts/draft_league/draft_picks/5").remove();

    expect(
      await runFinalize(admin, ctx, {
        project: PROJECT_ID,
        localState: "remapped",
      }),
    ).toEqual({ refusals: [] });
    const status = await readRemapLedgerStatus(admin.firestore, "season_51");
    expect(status).toBe("finalized");
    expect(seasonPushRefusal("season_51", status, "remapped")).toBeNull();
    expect(seasonPushRefusal("season_51", status, "provisional")).toMatch(
      /provisional/,
    );
    expect(adpCohortAction(status, "all_drafts")).toBe("compute");

    const rollback = await runRollback(admin, ctx, {
      plan,
      project: PROJECT_ID,
    });
    expect(rollback.refusals.join("; ")).toMatch(/roll forward/);
  });
});

describe("the Firebase store", () => {
  it("never writes an absent RTDB node or a node whose mark disagrees, and checks the committed mark (R2, R3)", async () => {
    await admin.firestore
      .doc("admin_migrations/castaway_id_remap_season_51")
      .set({
        mapping_hash: mapping.mapping_hash,
        status: "in_progress",
        census: {},
        applied: {},
      });
    const store = productionStore(admin, 51, mapping.mapping_hash);
    const change = {
      kind: "rtdb_draft" as const,
      path: "drafts/ghost",
      mode: "remap" as const,
    };
    expect(
      await store.compareAndSet(
        change,
        { draft_picks: null },
        { draft_picks: null },
        "set",
      ),
    ).toBe(false);
    expect(await rtNode("drafts/ghost")).toBeNull();

    await admin.rtdb.ref("drafts/marked").set({
      draft_picks: { 1: pick("US0754", 1, "u") },
      castaway_id_remap: { mapping_hash: mapping.mapping_hash },
    });
    const marked = { ...change, path: "drafts/marked" };
    const current = { draft_picks: [null, pick("US0754", 1, "u")] };
    // Already marked: a second "set" is refused, "keep" is allowed.
    expect(await store.compareAndSet(marked, current, current, "set")).toBe(
      false,
    );
    expect(await store.compareAndSet(marked, current, current, "keep")).toBe(
      true,
    );
    expect(await store.compareAndSet(marked, current, current, "clear")).toBe(
      true,
    );
    expect((await rtNode("drafts/marked")).castaway_id_remap).toBeUndefined();
  });

  it("marks a Firestore document without touching it, and writes episode-number fields as field paths", async () => {
    await admin.firestore
      .doc("admin_migrations/castaway_id_remap_season_51")
      .set({
        mapping_hash: mapping.mapping_hash,
        status: "in_progress",
        census: {},
        applied: {},
      });
    const store = productionStore(admin, 51, mapping.mapping_hash);
    const t = { offered_castaway_ids: ["US0755"], requested_castaway_ids: [] };
    await admin.firestore.doc("competitions/c/trades/t").set(t);
    expect(
      await store.compareAndSet(
        { kind: "trade", path: "competitions/c/trades/t", mode: "born" },
        t,
        t,
        "set",
      ),
    ).toBe(true);
    expect(await fsDoc("competitions/c/trades/t")).toEqual(t);
    expect(
      ((await ledger()).applied as Record<string, unknown>)[
        "competitions/c/trades/t"
      ],
    ).toMatchObject({ origin: "born", kind: "trade" });

    await admin.firestore
      .doc("team_assignments/season_51")
      .set({ "1": { US0754: "a" }, "2": { US0772: "b" } });
    expect(
      await store.compareAndSet(
        {
          kind: "team_assignments",
          path: "team_assignments/season_51",
          mode: "remap",
        },
        { "1": { US0754: "a" }, "2": { US0772: "b" } },
        { "1": { US0755: "a" }, "2": { US0754: "b" } },
        "set",
      ),
    ).toBe(true);
    expect(await fsDoc("team_assignments/season_51")).toEqual({
      "1": { US0755: "a" },
      "2": { US0754: "b" },
    });
  });
});
