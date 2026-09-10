import { describe, expect, it } from "vitest";
import type { Draft, PoolId, Season } from "../../../types";
import type {
  AuthIntent,
  AuthIntentStorage,
  EnterPoolIntent,
  JoinDraftIntent,
  StartDraftIntent,
} from "../authIntent";
import {
  AUTH_INTENT_TTL_BY_KIND,
  AUTH_INTENT_TTL_MS,
  claimAuthIntent,
  claimAuthIntentMatching,
  clearAuthIntents,
  generateAuthStateKey,
  readAuthIntent,
  restoreClaimedIntent,
  saveAuthIntent,
} from "../authIntent";

const createMemoryStorage = (): AuthIntentStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

const startIntent: StartDraftIntent = {
  kind: "start-draft",
  seasonId: "season_47" as Season["id"],
  draftId: "draft_preallocated_1" as Draft["id"],
  returnPath: "/seasons/47",
};

const joinIntent: JoinDraftIntent = {
  kind: "join-draft",
  draftId: "draft_invite_1" as Draft["id"],
  returnPath: "/draft/draft_invite_1",
};

const enterPoolIntent: EnterPoolIntent = {
  kind: "enter-pool",
  poolId: "pool_season_51" as PoolId,
  resume: true,
  returnPath: "/pools/pool_season_51/enter",
};

describe("authIntent", () => {
  describe("generateAuthStateKey", () => {
    it("generates unguessable unique keys", () => {
      const a = generateAuthStateKey();
      const b = generateAuthStateKey();
      expect(a).toMatch(/^[0-9a-f]{32}$/);
      expect(b).toMatch(/^[0-9a-f]{32}$/);
      expect(a).not.toBe(b);
    });
  });

  describe("save and read", () => {
    it("round-trips a start-draft intent without losing branded IDs or return path", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });

      expect(readAuthIntent(stateKey, { storage })).toEqual(startIntent);
    });

    it("round-trips a join-draft intent", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(joinIntent, { storage });

      expect(readAuthIntent(stateKey, { storage })).toEqual(joinIntent);
    });

    it("does not remove the intent on read", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });

      expect(readAuthIntent(stateKey, { storage })).toEqual(startIntent);
      expect(readAuthIntent(stateKey, { storage })).toEqual(startIntent);
    });

    it("rejects a cross-origin return path at save time", () => {
      const storage = createMemoryStorage();
      const malicious: AuthIntent = {
        ...joinIntent,
        returnPath: "https://evil.example.com/steal",
      };

      expect(() => saveAuthIntent(malicious, { storage })).toThrow();
    });

    it("rejects protocol-relative return paths at save time", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...joinIntent, returnPath: "//evil.example.com" },
          { storage },
        ),
      ).toThrow();
    });

    it("rejects backslash return paths that URL parsers treat as protocol-relative", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...joinIntent, returnPath: "/\\evil.example.com" },
          { storage },
        ),
      ).toThrow();
    });
  });

  describe("claim", () => {
    it("returns the intent on the first claim and null on the second", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });

      expect(claimAuthIntent(stateKey, { storage })).toEqual(startIntent);
      expect(claimAuthIntent(stateKey, { storage })).toBeNull();
      expect(readAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("removes the record before returning it", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(joinIntent, { storage });

      const claimed = claimAuthIntent(stateKey, { storage });

      expect(claimed).toEqual(joinIntent);
      expect(readAuthIntent(stateKey, { storage })).toBeNull();
    });
  });

  describe("validation of stored data", () => {
    const STORAGE_KEY = "survivor_auth_intents";

    it("discards malformed storage payloads", () => {
      const storage = createMemoryStorage();
      storage.setItem(STORAGE_KEY, "not json {{{");

      expect(readAuthIntent("whatever", { storage })).toBeNull();
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    });

    it("discards records with unknown intent kinds", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) as string);
      raw.records[stateKey].intent.kind = "delete-everything";
      storage.setItem(STORAGE_KEY, JSON.stringify(raw));

      expect(readAuthIntent(stateKey, { storage })).toBeNull();
      expect(claimAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("discards records with missing IDs", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) as string);
      delete raw.records[stateKey].intent.seasonId;
      storage.setItem(STORAGE_KEY, JSON.stringify(raw));

      expect(readAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("discards records with cross-origin return URLs", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(joinIntent, { storage });
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) as string);
      raw.records[stateKey].intent.returnPath = "https://evil.example.com/x";
      storage.setItem(STORAGE_KEY, JSON.stringify(raw));

      expect(readAuthIntent(stateKey, { storage })).toBeNull();
      expect(claimAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("discards malformed record shapes", () => {
      const storage = createMemoryStorage();
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, records: { abc: "garbage" } }),
      );

      expect(readAuthIntent("abc", { storage })).toBeNull();
    });
  });

  describe("state key rejection", () => {
    it("rejects unknown state keys", () => {
      const storage = createMemoryStorage();

      expect(readAuthIntent("f".repeat(32), { storage })).toBeNull();
      expect(claimAuthIntent("f".repeat(32), { storage })).toBeNull();
    });

    it("rejects forged state keys without exposing stored intents", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(joinIntent, { storage });
      const forged = stateKey.replace(/.$/, stateKey.endsWith("0") ? "1" : "0");

      expect(readAuthIntent(forged, { storage })).toBeNull();
      expect(claimAuthIntent(forged, { storage })).toBeNull();
      // The genuine record is untouched.
      expect(readAuthIntent(stateKey, { storage })).toEqual(joinIntent);
    });

    it("rejects expired state keys and removes their records", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const stateKey = saveAuthIntent(startIntent, options);

      now += AUTH_INTENT_TTL_MS + 1;

      expect(readAuthIntent(stateKey, options)).toBeNull();
      expect(claimAuthIntent(stateKey, options)).toBeNull();
    });

    it("accepts an intent saved just inside the expiry window", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const stateKey = saveAuthIntent(startIntent, options);

      now += AUTH_INTENT_TTL_MS - 1;

      expect(claimAuthIntent(stateKey, options)).toEqual(startIntent);
    });
  });

  describe("retry", () => {
    it("restores a claimed intent preserving the preallocated draft id", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });
      const claimed = claimAuthIntent(stateKey, { storage });

      expect(claimed).toEqual(startIntent);
      restoreClaimedIntent(stateKey, startIntent, { storage });

      expect(claimAuthIntent(stateKey, { storage })).toEqual(startIntent);
      expect(claimAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("refreshes the expiry window on restore", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const stateKey = saveAuthIntent(startIntent, options);

      now += AUTH_INTENT_TTL_MS - 10;
      claimAuthIntent(stateKey, options);
      now += 5;
      restoreClaimedIntent(stateKey, startIntent, options);

      now += AUTH_INTENT_TTL_MS - 1;
      expect(claimAuthIntent(stateKey, options)).toEqual(startIntent);
    });

    it("rejects restoring an invalid intent", () => {
      const storage = createMemoryStorage();
      const invalid = {
        kind: "start-draft",
        seasonId: "not-a-season",
        draftId: "draft_x",
        returnPath: "/seasons/47",
      } as unknown as AuthIntent;

      expect(() =>
        restoreClaimedIntent(generateAuthStateKey(), invalid, { storage }),
      ).toThrow();
    });
  });

  describe("claimAuthIntentMatching", () => {
    const matchesSeason47 = (intent: AuthIntent) =>
      intent.kind === "start-draft" && intent.seasonId === startIntent.seasonId;
    const matchesJoinInvite1 = (intent: AuthIntent) =>
      intent.kind === "join-draft" && intent.draftId === joinIntent.draftId;

    it("returns null when no intents are stored", () => {
      const storage = createMemoryStorage();

      expect(claimAuthIntentMatching(matchesSeason47, { storage })).toBeNull();
    });

    it("claims the matching intent and returns it with its state key", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });

      const claimed = claimAuthIntentMatching(matchesSeason47, { storage });

      expect(claimed).toEqual({ stateKey, intent: startIntent });
      expect(readAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("leaves non-matching intents pending", () => {
      const storage = createMemoryStorage();
      const otherKey = saveAuthIntent(joinIntent, { storage });

      expect(claimAuthIntentMatching(matchesSeason47, { storage })).toBeNull();
      expect(readAuthIntent(otherKey, { storage })).toEqual(joinIntent);
    });

    it("claims only the first match when several intents match", () => {
      const storage = createMemoryStorage();
      const first = saveAuthIntent(startIntent, { storage });
      const second = saveAuthIntent(
        { ...startIntent, draftId: "draft_preallocated_2" as Draft["id"] },
        { storage },
      );

      const claimed = claimAuthIntentMatching(matchesSeason47, { storage });

      expect(claimed).toEqual({ stateKey: first, intent: startIntent });
      expect(claimAuthIntentMatching(matchesSeason47, { storage })).toEqual({
        stateKey: second,
        intent: { ...startIntent, draftId: "draft_preallocated_2" },
      });
    });

    it("is single-use: a second matching claim returns null", () => {
      const storage = createMemoryStorage();
      saveAuthIntent(joinIntent, { storage });

      expect(
        claimAuthIntentMatching(matchesJoinInvite1, { storage }),
      ).not.toBeNull();
      expect(
        claimAuthIntentMatching(matchesJoinInvite1, { storage }),
      ).toBeNull();
    });

    it("skips and discards expired records while scanning", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const expiredKey = saveAuthIntent(startIntent, options);

      now += AUTH_INTENT_TTL_MS + 1;
      const freshKey = saveAuthIntent(joinIntent, options);

      expect(claimAuthIntentMatching(() => true, options)).toEqual({
        stateKey: freshKey,
        intent: joinIntent,
      });
      expect(readAuthIntent(expiredKey, options)).toBeNull();
    });

    it("discards invalid records instead of offering them to the predicate", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });
      const raw = JSON.parse(
        storage.getItem("survivor_auth_intents") as string,
      );
      raw.records[stateKey].intent.kind = "delete-everything";
      storage.setItem("survivor_auth_intents", JSON.stringify(raw));

      const predicate = () => true;

      expect(claimAuthIntentMatching(predicate, { storage })).toBeNull();
      expect(storage.getItem("survivor_auth_intents")).toBeNull();
    });
  });

  describe("clearAuthIntents", () => {
    it("removes every pending intent", () => {
      const storage = createMemoryStorage();
      const first = saveAuthIntent(startIntent, { storage });
      const second = saveAuthIntent(joinIntent, { storage });

      clearAuthIntents({ storage });

      expect(readAuthIntent(first, { storage })).toBeNull();
      expect(readAuthIntent(second, { storage })).toBeNull();
    });

    it("is safe to call when nothing is stored", () => {
      const storage = createMemoryStorage();

      expect(() => clearAuthIntents({ storage })).not.toThrow();
    });
  });

  describe("default storage boundary", () => {
    it("works without window.localStorage in a Node environment", () => {
      const stateKey = saveAuthIntent(startIntent);

      expect(claimAuthIntent(stateKey)).toEqual(startIntent);
      clearAuthIntents();
    });
  });

  describe("storage write failures", () => {
    const createThrowingWriteStorage = (): AuthIntentStorage => ({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });

    it("saveAuthIntent does not throw when setItem throws", () => {
      const storage = createThrowingWriteStorage();

      expect(() => saveAuthIntent(startIntent, { storage })).not.toThrow();
    });

    it("clearAuthIntents does not throw when removeItem throws", () => {
      const storage = createThrowingWriteStorage();

      expect(() => clearAuthIntents({ storage })).not.toThrow();
    });

    it("claimAuthIntent on a healthy store still works after a failed save", () => {
      saveAuthIntent(startIntent, { storage: createThrowingWriteStorage() });

      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(startIntent, { storage });

      expect(claimAuthIntent(stateKey, { storage })).toEqual(startIntent);
    });
  });

  describe("enter-pool intent", () => {
    const STORAGE_KEY = "survivor_auth_intents";

    it("round-trips an enter-pool intent through serialization", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(enterPoolIntent, { storage });

      expect(readAuthIntent(stateKey, { storage })).toEqual(enterPoolIntent);
    });

    it("round-trips an entry with no autosave to resume", () => {
      const storage = createMemoryStorage();
      const intent: EnterPoolIntent = { ...enterPoolIntent, resume: false };
      const stateKey = saveAuthIntent(intent, { storage });

      expect(readAuthIntent(stateKey, { storage })).toEqual(intent);
    });

    it("is single-use: the second claim returns null", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(enterPoolIntent, { storage });

      expect(claimAuthIntent(stateKey, { storage })).toEqual(enterPoolIntent);
      expect(claimAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("is recoverable by a pool-matching scan after a refresh loses the state key", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(enterPoolIntent, { storage });

      const claimed = claimAuthIntentMatching(
        (intent) =>
          intent.kind === "enter-pool" &&
          intent.poolId === enterPoolIntent.poolId,
        { storage },
      );

      expect(claimed).toEqual({ stateKey, intent: enterPoolIntent });
      expect(readAuthIntent(stateKey, { storage })).toBeNull();
    });

    it("is restorable under its original state key after a transient failure", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(enterPoolIntent, { storage });
      claimAuthIntent(stateKey, { storage });

      restoreClaimedIntent(stateKey, enterPoolIntent, { storage });

      expect(claimAuthIntent(stateKey, { storage })).toEqual(enterPoolIntent);
    });

    it("rejects a pool id that does not match the pool id shape", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...enterPoolIntent, poolId: "season_51" as PoolId },
          { storage },
        ),
      ).toThrow();
    });

    it("rejects a pool id carrying path traversal characters", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...enterPoolIntent, poolId: "pool_../../admin" as PoolId },
          { storage },
        ),
      ).toThrow();
    });

    it("rejects an empty pool id suffix", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...enterPoolIntent, poolId: "pool_" as PoolId },
          { storage },
        ),
      ).toThrow();
    });

    it("rejects a cross-origin return path", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...enterPoolIntent, returnPath: "https://evil.example.com/steal" },
          { storage },
        ),
      ).toThrow();
    });

    it("rejects a backslash return path that URL parsers treat as protocol-relative", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...enterPoolIntent, returnPath: "/\\evil.example.com" },
          { storage },
        ),
      ).toThrow();
    });

    it("rejects a missing resume marker", () => {
      const storage = createMemoryStorage();
      const withoutMarker: Record<string, unknown> = { ...enterPoolIntent };
      delete withoutMarker.resume;

      expect(() =>
        saveAuthIntent(withoutMarker as unknown as AuthIntent, { storage }),
      ).toThrow();
    });

    it("rejects a non-boolean resume marker", () => {
      const storage = createMemoryStorage();

      expect(() =>
        saveAuthIntent(
          { ...enterPoolIntent, resume: "yes" } as unknown as AuthIntent,
          { storage },
        ),
      ).toThrow();
    });

    it("discards a stored enter-pool record whose pool id was tampered with", () => {
      const storage = createMemoryStorage();
      const stateKey = saveAuthIntent(enterPoolIntent, { storage });
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) as string);
      raw.records[stateKey].intent.poolId = "pool_ someone elses";
      storage.setItem(STORAGE_KEY, JSON.stringify(raw));

      expect(readAuthIntent(stateKey, { storage })).toBeNull();
      expect(claimAuthIntent(stateKey, { storage })).toBeNull();
    });
  });

  describe("per-kind expiry", () => {
    const STORAGE_KEY = "survivor_auth_intents";
    const poolTtl = AUTH_INTENT_TTL_BY_KIND["enter-pool"];

    it("keeps both draft intents on the shared 60 minute window", () => {
      expect(AUTH_INTENT_TTL_BY_KIND["start-draft"]).toBe(AUTH_INTENT_TTL_MS);
      expect(AUTH_INTENT_TTL_BY_KIND["join-draft"]).toBe(AUTH_INTENT_TTL_MS);
      expect(AUTH_INTENT_TTL_MS).toBe(60 * 60 * 1000);
    });

    it("gives enter-pool a longer window than the draft intents", () => {
      expect(poolTtl).toBeGreaterThan(AUTH_INTENT_TTL_MS);
    });

    it("keeps an enter-pool intent alive past the draft window", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const poolKey = saveAuthIntent(enterPoolIntent, options);
      const draftKey = saveAuthIntent(startIntent, options);

      now += AUTH_INTENT_TTL_MS + 1;

      expect(readAuthIntent(draftKey, options)).toBeNull();
      expect(readAuthIntent(poolKey, options)).toEqual(enterPoolIntent);
    });

    it("accepts an enter-pool intent just inside its own window", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const stateKey = saveAuthIntent(enterPoolIntent, options);

      now += poolTtl - 1;

      expect(claimAuthIntent(stateKey, options)).toEqual(enterPoolIntent);
    });

    it("drops an enter-pool intent once its own window elapses", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const stateKey = saveAuthIntent(enterPoolIntent, options);

      now += poolTtl + 1;

      expect(readAuthIntent(stateKey, options)).toBeNull();
      expect(claimAuthIntent(stateKey, options)).toBeNull();
    });

    it("applies each kind's own window while scanning a mixed store", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const draftKey = saveAuthIntent(joinIntent, options);
      const poolKey = saveAuthIntent(enterPoolIntent, options);

      now += AUTH_INTENT_TTL_MS + 1;

      expect(claimAuthIntentMatching(() => true, options)).toEqual({
        stateKey: poolKey,
        intent: enterPoolIntent,
      });
      expect(readAuthIntent(draftKey, options)).toBeNull();
    });

    it("does not let an inherited object key masquerade as an intent kind", () => {
      const storage = createMemoryStorage();
      let now = 1_000_000;
      const options = { storage, now: () => now };
      const stateKey = saveAuthIntent(startIntent, options);
      const raw = JSON.parse(storage.getItem(STORAGE_KEY) as string);
      raw.records[stateKey].intent.kind = "constructor";
      storage.setItem(STORAGE_KEY, JSON.stringify(raw));

      now += AUTH_INTENT_TTL_MS + 1;

      expect(readAuthIntent(stateKey, options)).toBeNull();
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
