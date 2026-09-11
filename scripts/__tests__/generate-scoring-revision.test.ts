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
    // The absent module is constructed rather than hunted for. This assertion
    // used to search the real source list for one whose contents were null,
    // which held while the list named modules later units had not written
    // yet, and silently stopped running the moment the last of them landed,
    // leaving a tautology behind. An absent module must still be part of the
    // hash so its arrival invalidates the cache, and that has to stay
    // provable once every listed module exists.
    const sources = [
      ...readScoringSources(repoRoot),
      { path: "src/utils/notYetWritten.ts", contents: null },
    ];
    const appeared = sources.map((s) =>
      s.contents === null ? { ...s, contents: "export const x = 1;" } : s,
    );

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
