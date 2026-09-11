import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropBetQuestionKey } from "../../data/propbets";
import type {
  CastawayId,
  PoolId,
  PoolPick,
  PropBetsFormData,
} from "../../types";
import {
  clearAllPoolEntryDrafts,
  createPoolEntryDraftStore,
  MAX_POOL_ENTRY_DRAFTS,
  POOL_ENTRY_DRAFT_STORAGE_KEY,
  POOL_ENTRY_DRAFT_TTL_MS,
  readPoolEntryDraftForPool,
  validatePoolEntryDraftForPool,
  type PoolDraftStorage,
  type PoolEntryDraftPool,
} from "../poolDraftStorage";
import type { PoolEntryDraft } from "../poolEntryDraft";
import {
  clearPoolEntryDraft,
  loadPoolEntryDraft,
  savePoolEntryDraft,
  setPoolEntryDraftStore,
} from "../poolEntryDraft";
import { buildPoolEntryPayload } from "../poolEntryPayload";
import {
  POOL_HANDLE_MAX,
  suggestPoolHandle,
  validatePoolHandle,
} from "../poolHandle";

/**
 * U13: the entry autosave, its storage boundary, and the validation that runs
 * on every restore.
 *
 * Two properties are load bearing here and neither is visible in the page:
 *
 *  - a restored entry has to be *the same entry*, which is the round-trip
 *    assertion against `buildPoolEntryPayload`, and
 *  - a restored entry flows straight into a form the entrant then submits, so
 *    a draft that has been tampered with in browser-local storage has to be
 *    dropped rather than repaired. Anything on the origin can write that key.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const castaway = (n: number): PoolPick => ({
  castaway_id: `US07${String(n).padStart(2, "0")}` as CastawayId,
  full_name: `Castaway ${n}`,
});

const ROSTER: PoolPick[] = [1, 2, 3, 4, 5, 6].map(castaway);

const POOL_ID = "pool_season_51" as PoolId;

const PROP_BET_KEYS: PropBetQuestionKey[] = [
  "propbet_winner",
  "propbet_medical_evac",
];

const pool: PoolEntryDraftPool = {
  id: POOL_ID,
  roster: ROSTER,
  picks_per_entry: 2,
  prop_bet_keys: PROP_BET_KEYS,
};

const PROP_BETS: PropBetsFormData = {
  propbet_winner: ROSTER[0].castaway_id,
  propbet_medical_evac: "No",
};

/** Every store in this file shares one pinned clock; expiry is tested apart. */
const NOW = 1_000_000;
const now = () => NOW;

const draft = (overrides: Partial<PoolEntryDraft> = {}): PoolEntryDraft => ({
  pool_id: POOL_ID,
  picks: [ROSTER[0], ROSTER[3]],
  handle: "TorchSnuffer12",
  prop_bets: { ...PROP_BETS },
  saved_at: NOW,
  ...overrides,
});

/** A localStorage stand-in, plus the two ways a real one misbehaves. */
const memoryStorage = (): PoolDraftStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

const throwingStorage = (): PoolDraftStorage => ({
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
});

afterEach(() => {
  // The module installs a real store at import; put a clean one back so no
  // test can observe another's writes through the shared seam.
  setPoolEntryDraftStore(
    createPoolEntryDraftStore({ storage: memoryStorage(), now }),
  );
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Persistence (happy path)
// ---------------------------------------------------------------------------

describe("createPoolEntryDraftStore", () => {
  it("an in-progress entry survives a page refresh", () => {
    const storage = memoryStorage();

    // The session that fills the form in.
    createPoolEntryDraftStore({ storage, now }).save(draft());

    // The reload: a brand new store over the same browser storage.
    const afterReload = createPoolEntryDraftStore({ storage, now }).load(
      POOL_ID,
    );

    expect(afterReload).toEqual(draft());
  });

  it("writes under its own versioned key and no one else's", () => {
    const storage = memoryStorage();
    createPoolEntryDraftStore({ storage, now }).save(draft());

    expect([...storage.map.keys()]).toEqual([POOL_ENTRY_DRAFT_STORAGE_KEY]);
    expect(POOL_ENTRY_DRAFT_STORAGE_KEY).not.toBe("survivor_auth_intents");
    expect(POOL_ENTRY_DRAFT_STORAGE_KEY).not.toContain("recent_drafts");
  });

  it("keeps drafts for two pools apart", () => {
    const storage = memoryStorage();
    const store = createPoolEntryDraftStore({ storage, now });
    const other = "pool_season_52" as PoolId;

    store.save(draft());
    store.save(draft({ pool_id: other, handle: "OtherHandle" }));

    expect(store.load(POOL_ID)?.handle).toBe("TorchSnuffer12");
    expect(store.load(other)?.handle).toBe("OtherHandle");

    store.clear(POOL_ID);
    expect(store.load(POOL_ID)).toBeNull();
    expect(store.load(other)?.handle).toBe("OtherHandle");
  });

  it("caps how many pools it keeps, dropping the least recent", () => {
    const storage = memoryStorage();
    let clock = NOW;
    const store = createPoolEntryDraftStore({ storage, now: () => clock });

    for (let i = 0; i <= MAX_POOL_ENTRY_DRAFTS; i += 1) {
      clock += 1_000;
      store.save(
        draft({ pool_id: `pool_season_${60 + i}` as PoolId, saved_at: clock }),
      );
    }

    expect(store.load("pool_season_60" as PoolId)).toBeNull();
    expect(
      store.load(`pool_season_${60 + MAX_POOL_ENTRY_DRAFTS}` as PoolId),
    ).not.toBeNull();
  });

  it("re-saving one pool replaces it rather than accumulating", () => {
    const storage = memoryStorage();
    const store = createPoolEntryDraftStore({ storage, now });

    store.save(draft({ handle: "First" }));
    store.save(draft({ handle: "Second" }));

    expect(store.load(POOL_ID)?.handle).toBe("Second");
    const parsed = JSON.parse(
      storage.map.get(POOL_ENTRY_DRAFT_STORAGE_KEY) as string,
    ) as { drafts: unknown[] };
    expect(parsed.drafts).toHaveLength(1);
  });

  it("removes the key entirely once the last draft is cleared", () => {
    const storage = memoryStorage();
    const store = createPoolEntryDraftStore({ storage, now });
    store.save(draft());
    store.clear(POOL_ID);

    expect(storage.map.has(POOL_ENTRY_DRAFT_STORAGE_KEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe("staleness", () => {
  it("does not restore a draft older than the retention window", () => {
    const storage = memoryStorage();
    let clock = 5_000_000;
    const store = createPoolEntryDraftStore({ storage, now: () => clock });
    store.save(draft({ saved_at: clock }));

    clock += POOL_ENTRY_DRAFT_TTL_MS + 1;
    expect(store.load(POOL_ID)).toBeNull();
  });

  it("restores a draft just inside the retention window", () => {
    const storage = memoryStorage();
    let clock = 5_000_000;
    const store = createPoolEntryDraftStore({ storage, now: () => clock });
    store.save(draft({ saved_at: clock }));

    clock += POOL_ENTRY_DRAFT_TTL_MS - 1;
    expect(store.load(POOL_ID)).not.toBeNull();
  });

  it("prunes the expired draft from storage rather than leaving it", () => {
    const storage = memoryStorage();
    let clock = 5_000_000;
    const store = createPoolEntryDraftStore({ storage, now: () => clock });
    store.save(draft({ saved_at: clock }));

    clock += POOL_ENTRY_DRAFT_TTL_MS + 1;
    store.load(POOL_ID);

    expect(storage.map.has(POOL_ENTRY_DRAFT_STORAGE_KEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed storage (error path)
// ---------------------------------------------------------------------------

describe("malformed browser-local payloads", () => {
  const readsAsEmpty = (raw: string) => {
    const storage = memoryStorage();
    storage.map.set(POOL_ENTRY_DRAFT_STORAGE_KEY, raw);
    const store = createPoolEntryDraftStore({ storage, now });
    expect(store.load(POOL_ID)).toBeNull();
    expect(storage.map.has(POOL_ENTRY_DRAFT_STORAGE_KEY)).toBe(false);
  };

  it("discards a payload that is not JSON", () => {
    readsAsEmpty("{not json");
  });

  it("discards a payload written by a different version", () => {
    readsAsEmpty(JSON.stringify({ version: 99, drafts: [draft()] }));
  });

  it("discards a payload whose drafts are not a list", () => {
    readsAsEmpty(JSON.stringify({ version: 1, drafts: { pool: draft() } }));
  });

  it.each([
    ["pool_id missing", { ...draft(), pool_id: undefined }],
    ["pool_id not a pool id", { ...draft(), pool_id: "season_51" }],
    ["picks not a list", { ...draft(), picks: "US0701" }],
    ["a pick that is not an object", { ...draft(), picks: ["US0701"] }],
    [
      "a pick with no full name",
      { ...draft(), picks: [{ castaway_id: "US0701" }] },
    ],
    ["handle not a string", { ...draft(), handle: 7 }],
    ["prop bets not an object", { ...draft(), prop_bets: [] }],
    [
      "a non-string prop bet answer",
      {
        ...draft(),
        prop_bets: { propbet_winner: 3 },
      },
    ],
    ["saved_at missing", { ...draft(), saved_at: undefined }],
  ])("drops a stored draft with %s", (_label, bad) => {
    const storage = memoryStorage();
    storage.map.set(
      POOL_ENTRY_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 1, drafts: [bad] }),
    );
    expect(
      createPoolEntryDraftStore({ storage, now }).load(POOL_ID),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

describe("storage being unavailable", () => {
  it("does not throw when reading, writing, or clearing throws", () => {
    const store = createPoolEntryDraftStore({
      storage: throwingStorage(),
      now,
    });

    expect(() => store.save(draft())).not.toThrow();
    expect(() => store.clear(POOL_ID)).not.toThrow();
    expect(store.load(POOL_ID)).toBeNull();
  });

  it("degrades to in-memory when there is no window at all", () => {
    // The default suite runs in node, so `window` is genuinely undefined here
    // and the store resolves its shared in-memory fallback.
    expect(typeof window).toBe("undefined");
    const store = createPoolEntryDraftStore({ now });

    expect(() => store.save(draft())).not.toThrow();
    expect(store.load(POOL_ID)).toEqual(draft());
    store.clear(POOL_ID);
    expect(store.load(POOL_ID)).toBeNull();
  });

  it("degrades to in-memory when localStorage access throws", () => {
    const stub = {
      get localStorage(): PoolDraftStorage {
        throw new Error("SecurityError");
      },
    };
    vi.stubGlobal("window", stub);

    const store = createPoolEntryDraftStore({ now });
    expect(() => store.save(draft({ handle: "PrivateMode" }))).not.toThrow();
    expect(store.load(POOL_ID)?.handle).toBe("PrivateMode");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Validation on restore, against the pool config in hand
// ---------------------------------------------------------------------------

describe("validatePoolEntryDraftForPool", () => {
  it("accepts a complete entry", () => {
    expect(validatePoolEntryDraftForPool(draft(), pool)).toEqual(draft());
  });

  it("accepts an entry that is still half filled in", () => {
    const partial = draft({ picks: [ROSTER[2]], handle: "T", prop_bets: {} });
    expect(validatePoolEntryDraftForPool(partial, pool)).toEqual(partial);
  });

  it("accepts an empty entry", () => {
    const empty = draft({ picks: [], handle: "", prop_bets: {} });
    expect(validatePoolEntryDraftForPool(empty, pool)).toEqual(empty);
  });

  it("rejects a draft saved for a different pool", () => {
    expect(
      validatePoolEntryDraftForPool(
        draft({ pool_id: "pool_season_52" as PoolId }),
        pool,
      ),
    ).toBeNull();
  });

  // --- the tamper cases -----------------------------------------------------

  it("rejects a pick that is not part of this season's cast", () => {
    const tampered = draft({
      picks: [
        ROSTER[0],
        { castaway_id: "US9999" as CastawayId, full_name: "Ringer" },
      ],
    });
    expect(validatePoolEntryDraftForPool(tampered, pool)).toBeNull();
  });

  it("rejects a pick whose name disagrees with the cast", () => {
    const tampered = draft({
      picks: [
        {
          castaway_id: ROSTER[0].castaway_id,
          full_name: "<img src=x onerror=alert(1)>",
        },
      ],
    });
    expect(validatePoolEntryDraftForPool(tampered, pool)).toBeNull();
  });

  it("rejects the same castaway chosen twice", () => {
    expect(
      validatePoolEntryDraftForPool(
        draft({ picks: [ROSTER[0], ROSTER[0]] }),
        pool,
      ),
    ).toBeNull();
  });

  it("rejects more picks than the pool allows", () => {
    expect(
      validatePoolEntryDraftForPool(
        draft({ picks: [ROSTER[0], ROSTER[1], ROSTER[2]] }),
        pool,
      ),
    ).toBeNull();
  });

  it("rejects a prop bet key this pool does not ask", () => {
    const tampered = draft({
      prop_bets: { ...PROP_BETS, propbet_quit: "Yes" },
    });
    expect(validatePoolEntryDraftForPool(tampered, pool)).toBeNull();
  });

  it("rejects an oversized handle", () => {
    const tampered = draft({ handle: "a".repeat(POOL_HANDLE_MAX + 1) });
    expect(validatePoolEntryDraftForPool(tampered, pool)).toBeNull();
  });

  it.each([
    ["markup", "<b>hi</b>"],
    ["a URL", "http://x.io"],
    ["a newline", "Torch\nSnuffer"],
    ["a zero-width joiner", "Torch‍Snuffer"],
    ["a bidi override", "Torch‮Snuffer"],
  ])("rejects a handle carrying %s", (_label, handle) => {
    expect(validatePoolEntryDraftForPool(draft({ handle }), pool)).toBeNull();
  });

  it("rejects an oversized prop bet answer", () => {
    const tampered = draft({
      prop_bets: { propbet_winner: "x".repeat(500) },
    });
    expect(validatePoolEntryDraftForPool(tampered, pool)).toBeNull();
  });

  it("drops an invalid draft whole rather than repairing part of it", () => {
    const tampered = draft({
      picks: [
        ROSTER[0],
        { castaway_id: "US9999" as CastawayId, full_name: "Ringer" },
      ],
    });
    // Not "the good pick survived": a partially repaired entry is one the
    // entrant never chose, and they would submit it without noticing.
    expect(validatePoolEntryDraftForPool(tampered, pool)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Parity with the submit path (the divergence guard)
// ---------------------------------------------------------------------------

describe("parity with the submit validators", () => {
  it("round-trips a complete entry through serialization and validates it", () => {
    const storage = memoryStorage();
    const store = createPoolEntryDraftStore({ storage, now });
    const original = draft();

    store.save(original);
    const restored = store.load(POOL_ID);
    expect(restored).not.toBeNull();

    const validated = validatePoolEntryDraftForPool(
      restored as PoolEntryDraft,
      pool,
    );
    expect(validated).toEqual(original);

    // And the restored entry is one the submit path will build a payload from,
    // with the same picks, handle, and prop bets that went in.
    const payload = buildPoolEntryPayload({
      uid: "uid-1",
      pool: { ...pool, season_id: "season_51" },
      picks: (validated as PoolEntryDraft).picks,
      handle: (validated as PoolEntryDraft).handle,
      propBets: (validated as PoolEntryDraft).prop_bets,
      timestamp: () => "ts",
    });
    expect(payload.picks).toEqual(original.picks);
    expect(payload.handle).toBe(original.handle);
    expect(payload.prop_bets).toEqual(original.prop_bets);
  });

  it("accepts every handle the submit validator accepts", () => {
    // The restore check is a prefix of the handle rule, never a second rule:
    // anything `validatePoolHandle` would let through must survive a restore,
    // or a legitimate entry would be silently discarded.
    const random = (() => {
      let i = 0;
      return () => ((i = (i + 37) % 97), i / 97);
    })();
    const candidates = [
      "ab",
      "a".repeat(POOL_HANDLE_MAX),
      "Torch Snuffer",
      "torch_snuffer-1",
      ...Array.from({ length: 20 }, () => suggestPoolHandle(random)),
    ];

    for (const handle of candidates) {
      expect(validatePoolHandle(handle)).toBeNull();
      expect(
        validatePoolEntryDraftForPool(draft({ handle }), pool),
      ).not.toBeNull();
    }
  });

  it("never restores a complete entry the submit path would refuse", () => {
    const refusedBySubmit: PoolEntryDraft[] = [
      draft({ picks: [ROSTER[0], ROSTER[0]] }),
      draft({
        picks: [
          ROSTER[0],
          { castaway_id: "US9999" as CastawayId, full_name: "Ringer" },
        ],
      }),
      draft({ handle: "a".repeat(POOL_HANDLE_MAX + 1) }),
    ];

    for (const candidate of refusedBySubmit) {
      expect(() =>
        buildPoolEntryPayload({
          uid: "uid-1",
          pool: { ...pool, season_id: "season_51" },
          picks: candidate.picks,
          handle: candidate.handle,
          propBets: candidate.prop_bets,
          timestamp: () => "ts",
        }),
      ).toThrow();
      expect(validatePoolEntryDraftForPool(candidate, pool)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The page's restore call, and sign-out
// ---------------------------------------------------------------------------

describe("readPoolEntryDraftForPool", () => {
  it("returns what was entered, sourced from the autosave", () => {
    const store = createPoolEntryDraftStore({ storage: memoryStorage(), now });
    setPoolEntryDraftStore(store);
    savePoolEntryDraft(draft());

    expect(readPoolEntryDraftForPool(POOL_ID, pool)).toEqual(draft());
  });

  it("returns null and erases the autosave when the draft is invalid", () => {
    const store = createPoolEntryDraftStore({ storage: memoryStorage(), now });
    setPoolEntryDraftStore(store);
    savePoolEntryDraft(
      draft({
        picks: [{ castaway_id: "US9999" as CastawayId, full_name: "Ringer" }],
      }),
    );

    expect(readPoolEntryDraftForPool(POOL_ID, pool)).toBeNull();
    // No orphan: a rejected draft is gone, not waiting for the next restore.
    expect(loadPoolEntryDraft(POOL_ID)).toBeNull();
  });

  it("returns null when nothing was ever saved", () => {
    setPoolEntryDraftStore(
      createPoolEntryDraftStore({ storage: memoryStorage(), now }),
    );
    expect(readPoolEntryDraftForPool(POOL_ID, pool)).toBeNull();
  });
});

describe("clearAllPoolEntryDrafts", () => {
  it("leaves no autosave behind for any pool", () => {
    const storage = memoryStorage();
    const store = createPoolEntryDraftStore({ storage, now });
    setPoolEntryDraftStore(store);

    savePoolEntryDraft(draft());
    savePoolEntryDraft(draft({ pool_id: "pool_season_52" as PoolId }));

    clearAllPoolEntryDrafts({ storage });

    expect(storage.map.has(POOL_ENTRY_DRAFT_STORAGE_KEY)).toBe(false);
    expect(loadPoolEntryDraft(POOL_ID)).toBeNull();
    expect(loadPoolEntryDraft("pool_season_52" as PoolId)).toBeNull();
  });

  it("does not throw when storage refuses the removal", () => {
    expect(() =>
      clearAllPoolEntryDrafts({ storage: throwingStorage() }),
    ).not.toThrow();
  });

  it("is safe to call when nothing was ever saved", () => {
    const storage = memoryStorage();
    expect(() => clearAllPoolEntryDrafts({ storage })).not.toThrow();
    expect(storage.map.size).toBe(0);
  });
});

describe("the seam the page uses", () => {
  it("is backed by browser-local storage once this module is imported", () => {
    // U4 shipped an in-memory default so the page worked within a session.
    // Importing this module is what makes an entry survive a reload, and the
    // page keeps calling the same four functions.
    const storage = memoryStorage();
    setPoolEntryDraftStore(createPoolEntryDraftStore({ storage, now }));

    savePoolEntryDraft(draft());
    expect(storage.map.has(POOL_ENTRY_DRAFT_STORAGE_KEY)).toBe(true);

    clearPoolEntryDraft(POOL_ID);
    expect(storage.map.has(POOL_ENTRY_DRAFT_STORAGE_KEY)).toBe(false);
  });
});
