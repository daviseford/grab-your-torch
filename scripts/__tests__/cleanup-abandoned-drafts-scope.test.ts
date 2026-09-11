/**
 * Pins the blast radius of the abandoned-draft cleanup (R24).
 *
 * A pool is deliberately unfinished for months: it is created before a season
 * premieres and holds entries that nobody touches again until the finale. Any
 * "delete what looks abandoned" job that could reach a pool would eventually
 * delete one. Two things keep that from happening, and both are pinned here.
 *
 *  1. The cleanup operates exclusively on the Realtime Database, under
 *     `drafts`. Pools live in Firestore, so the script structurally cannot
 *     reach them. That is a property of the source, not of any runtime guard,
 *     so it is asserted against the source: an edit that adds a Firestore walk
 *     to this script fails here rather than in production.
 *  2. A pool must never be written under `drafts/` in the Realtime Database.
 *     If one ever were, the age rule below would delete it, so the second test
 *     shows exactly what the rule does to a pool-shaped node that strayed into
 *     the drafts subtree.
 *
 * The script is not importable here on purpose: it initializes the Firebase
 * Admin SDK as a side effect of import and runs `main()` at module load.
 */

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { findAbandonedDrafts } from "../lib/draft-cleanup";

const scriptsDir = path.join(__dirname, "..");

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(scriptsDir, relativePath), "utf-8");

/** Comments are prose and may legitimately mention Firestore or pools. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CLEANUP_SOURCES = [
  "cleanup-abandoned-drafts.ts",
  "lib/draft-cleanup.ts",
] as const;

describe("the abandoned-draft cleanup cannot reach pool documents", () => {
  it.each(CLEANUP_SOURCES)("%s touches no Firestore API", (relativePath) => {
    const code = stripComments(readSource(relativePath));

    expect(code).not.toMatch(/firebase-admin\/firestore/);
    expect(code).not.toMatch(/getFirestore/);
    expect(code).not.toMatch(/\.collection\(/);
  });

  it.each(CLEANUP_SOURCES)("%s never names a pool path", (relativePath) => {
    const code = stripComments(readSource(relativePath));

    expect(code).not.toMatch(/pools/);
    expect(code).not.toMatch(/pool_season_/);
  });

  it("reads and deletes under the drafts subtree only", () => {
    const code = stripComments(readSource("cleanup-abandoned-drafts.ts"));

    const refs = [...code.matchAll(/\.ref\(\s*["'`]([^"'`]*)["'`]\s*\)/g)].map(
      (match) => match[1],
    );

    expect(refs).toEqual(["drafts"]);
    // Every mutation goes through that one ref, so nothing can address a
    // sibling subtree by accident.
    expect(code).not.toMatch(/\.ref\(\s*[^"'`)]/);
  });
});

describe("findAbandonedDrafts run against a tree holding drafts and pools", () => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const NOW = 1_700_000_000_000;

  /**
   * A realtime-database root as it actually is: pools are not here, because
   * they are Firestore documents. The cleanup is handed `root.drafts`.
   */
  const rtdbRoot = {
    drafts: {
      draft_stale: {
        state: { finished: false },
        created_at: NOW - 30 * SEVEN_DAYS_MS,
      },
      draft_done: {
        state: { finished: true },
        created_at: NOW - 30 * SEVEN_DAYS_MS,
      },
    },
    pools: {
      pool_season_51: {
        created_at: NOW - 30 * SEVEN_DAYS_MS,
        entries: { uid_alpha: { handle: "alpha" } },
      },
    },
  };

  it("deletes only stale drafts and never sees the pool subtree", () => {
    const result = findAbandonedDrafts(rtdbRoot.drafts, NOW);

    expect(result.toDelete).toEqual(["draft_stale"]);
    expect(result.toDelete).not.toContain("pool_season_51");
    expect(rtdbRoot.pools.pool_season_51.entries.uid_alpha.handle).toBe(
      "alpha",
    );
  });

  it("would delete a pool that ever strayed into the drafts subtree", () => {
    // Not a recommendation, a warning. A pool has no `state.finished` and sits
    // untouched for months, so it satisfies the abandonment rule perfectly.
    // This is why a pool is never written under `drafts/`.
    const result = findAbandonedDrafts(
      { ...rtdbRoot.drafts, ...rtdbRoot.pools },
      NOW,
    );

    expect(result.toDelete).toContain("pool_season_51");
  });
});
