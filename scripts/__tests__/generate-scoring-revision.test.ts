import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { SCORING_REVISION } from "../../src/data/scoringRevision.generated.js";
import {
  SCORING_REVISION_SOURCES,
  computeScoringRevision,
  readScoringSources,
  renderScoringRevisionModule,
} from "../generate-scoring-revision.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

describe("scoring revision", () => {
  it("matches the checked-in generated constant", () => {
    // Drift is a CI failure rather than a silent mismatch between the Node
    // recompute job and the browser bundle. Run `yarn gen:scoring-revision`.
    expect(computeScoringRevision(readScoringSources(repoRoot))).toBe(
      SCORING_REVISION,
    );
  });

  it("changes when a point value in src/data/scoring.ts changes", () => {
    const sources = readScoringSources(repoRoot);
    const scoring = sources.find((s) => s.path === "src/data/scoring.ts");
    expect(scoring?.contents).toBeTruthy();

    const edited = sources.map((s) =>
      s.path === "src/data/scoring.ts"
        ? {
            ...s,
            contents: s.contents!.replace("fixed_value: 1", "fixed_value: 2"),
          }
        : s,
    );

    expect(edited).not.toEqual(sources);
    expect(computeScoringRevision(edited)).not.toBe(
      computeScoringRevision(sources),
    );
  });

  it("changes when a derivation module that does not exist yet appears", () => {
    const sources = readScoringSources(repoRoot);
    const absent = sources.find((s) => s.contents === null);

    // The source list is forward-looking: it names derivation modules that
    // later units add. An absent module must still be part of the hash so its
    // arrival invalidates the cache.
    const appeared = sources.map((s) =>
      s === absent ? { ...s, contents: "export const x = 1;\n" } : s,
    );

    if (!absent) {
      // Every listed module exists; nothing to prove here.
      expect(sources.every((s) => s.contents !== null)).toBe(true);
      return;
    }

    expect(computeScoringRevision(appeared)).not.toBe(
      computeScoringRevision(sources),
    );
  });

  it("lists src/data/scoring.ts and the scoring derivation module", () => {
    expect(SCORING_REVISION_SOURCES).toContain("src/data/scoring.ts");
    expect(SCORING_REVISION_SOURCES).toContain("src/utils/scoringUtils.ts");
  });

  it("renders a module byte-identical to the checked-in file", () => {
    const checkedIn = fs.readFileSync(
      path.join(repoRoot, "src", "data", "scoringRevision.generated.ts"),
      "utf8",
    );

    expect(renderScoringRevisionModule(SCORING_REVISION)).toBe(checkedIn);
  });
});
