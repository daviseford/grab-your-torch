/**
 * Import-graph boundary assertions.
 *
 * Two kinds of mistake are invisible to `tsc`, `eslint`, and every other test
 * in this repo, because both produce perfectly valid, perfectly typed code:
 *
 *  1. Pool code reaching for the competition ownership helpers. `tradeUtils`
 *     and the draft-grid surfaces assume a castaway has at most one owner.
 *     Pool picks are non-exclusive, so those helpers are wrong there in a way
 *     no type will ever object to.
 *  2. The homepage transitively importing season data. `src/data/season-metadata.ts`
 *     documents its zero-import guarantee in a comment; one accidental import
 *     of `src/data/seasons` or a `src/data/season_*` module anywhere in the
 *     homepage's import closure drags megabytes of player and episode arrays
 *     into the entry chunk. The build still succeeds.
 *
 * ADDING A RULE
 * -------------
 * Append an entry to `RULES` below:
 *
 *   {
 *     id: "short-slug",
 *     reason: "one sentence a failing developer can act on",
 *     from: ["glob", ...],   // files the rule constrains
 *     to: ["glob", ...],     // modules those files may not reach
 *     mode: "direct" | "transitive",
 *   }
 *
 * Globs are matched against repo-relative POSIX paths. `*` matches within one
 * segment, `**` matches across segments. A `from` glob that matches nothing is
 * not a failure: the pool surfaces mostly do not exist yet, and the rules are
 * written so they begin enforcing the moment those files land.
 *
 * `mode: "direct"` fails only on an import statement written in the file
 * itself. `mode: "transitive"` follows the whole import closure, which is what
 * a bundle-size guarantee needs.
 *
 * An optional `allow` list excuses named `importer -> imported` edges that
 * pre-date the rule. Every other path to the same target still fails, and a
 * separate test fails once an excused edge disappears, so the list shrinks
 * rather than rots. Add to it only for existing debt, never for new code.
 *
 * Specifiers are parsed out of real `import` / `export ... from` / `import()`
 * statements after comments are stripped, so mentioning a forbidden module by
 * name in a comment or a doc block does not trip the check. Do not contort
 * prose to avoid a matcher.
 */

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type BoundaryRule = {
  id: string;
  reason: string;
  from: string[];
  to: string[];
  mode: "direct" | "transitive";
  /**
   * Pre-existing edges the rule tolerates, as exact `importer -> imported`
   * pairs. An exception is a debt entry, not a loophole: every other path to
   * the same target still fails, so the rule keeps its teeth while the listed
   * edge stays visible and deletable.
   */
  allow?: { from: string; to: string; why: string }[];
};

export const RULES: BoundaryRule[] = [
  {
    id: "pool-never-imports-ownership-helpers",
    reason:
      "Pool picks are non-exclusive, so one-owner helpers (tradeUtils, the draft cast grid, MyPlayers, DraftTable, useCompetitionMeta) do not apply. The pool needs its own cast picker and its own standings path.",
    from: [
      "src/pages/Pool.tsx",
      "src/components/Pool/**",
      "src/components/Home/HomePool.tsx",
      "src/hooks/usePool*.ts",
      // Beyond the surfaces KTD10 lists: the pure pool helpers are pool code
      // by the same argument, and covering them is what lets their doc
      // comments name tradeUtils in prose without anyone worrying.
      "src/utils/pool*.ts",
    ],
    to: [
      "src/utils/tradeUtils.ts",
      "src/pages/DraftCastGrid.tsx",
      "src/components/MyPlayers/**",
      "src/components/DraftTable/**",
      "src/hooks/useCompetitionMeta.ts",
    ],
    mode: "direct",
  },
  {
    id: "homepage-never-reaches-season-data",
    reason:
      "src/data/season-metadata.ts exists so the homepage can render season tiles without loading player and episode arrays. Any path from Home.tsx to src/data/seasons or a src/data/season_* module puts that payload in the entry chunk.",
    from: ["src/components/Home/Home.tsx"],
    to: ["src/data/seasons.ts", "src/data/season_*/**"],
    mode: "transitive",
    allow: [
      {
        from: "src/components/Home/HomeDraftExample.tsx",
        to: "src/data/season_47/index.ts",
        why: "Pre-dates this rule. The static draft-board demo strip uses a fixed handful of season 47 castaways. One season module (~78 KB), not the whole registry. Worth replacing with literal demo data; until then it is fenced to this one edge.",
      },
      {
        from: "src/components/Home/HomeTradeExample.tsx",
        to: "src/data/season_47/index.ts",
        why: "Same demo data, same pre-existing edge, same replacement.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

/** Repo-relative POSIX path -> repo-relative POSIX paths it imports. */
export type ModuleGraph = Map<string, string[]>;

export type Violation = {
  ruleId: string;
  /** Import chain, starting at the constrained file and ending at the target. */
  chain: string[];
};

/**
 * Blank out line and block comments, preserving length so nothing else shifts.
 * String and template literals are skipped so a `//` inside a URL survives.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j += 1) {
        out += source[j] === "\n" ? "\n" : " ";
      }
      i = stop;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const STATIC_IMPORT = /\bimport\s+(?:[^;'"`]*?\bfrom\s*)?["']([^"']+)["']/g;
const REEXPORT = /\bexport\s+[^;'"`]*?\bfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Module specifiers written in real import syntax. Comments are stripped
 * first, so a module named in prose is not a specifier.
 */
export function parseImportSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const re of [STATIC_IMPORT, REEXPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      found.push(m[1]);
    }
  }
  return [...new Set(found)];
}

const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".d.ts",
  ".js",
  ".jsx",
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

function dirnamePosix(file: string): string {
  const cut = file.lastIndexOf("/");
  return cut === -1 ? "" : file.slice(0, cut);
}

/** POSIX path join with `.` and `..` collapsed. No node builtins available. */
function joinPosix(dir: string, rel: string): string {
  const out: string[] = [];
  for (const segment of `${dir}/${rel}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Resolve a relative specifier against the set of known files. Bare specifiers
 * (npm packages) and anything that resolves to no known file are dropped: the
 * rules only ever talk about files in this repo.
 */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = joinPosix(dirnamePosix(fromFile), specifier);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** Build a resolved module graph from a map of repo-relative path -> source. */
export function buildGraph(files: ReadonlyMap<string, string>): ModuleGraph {
  const known = new Set(files.keys());
  const graph: ModuleGraph = new Map();
  for (const [file, source] of files) {
    const edges: string[] = [];
    for (const spec of parseImportSpecifiers(source)) {
      const resolved = resolveSpecifier(file, spec, known);
      if (resolved !== null && resolved !== file) edges.push(resolved);
    }
    graph.set(file, edges);
  }
  return graph;
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i += 2;
      continue;
    }
    if (c === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    out += /[.+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    i += 1;
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(file: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(file));
}

/** Every boundary violation in the graph, with the import chain that proves it. */
export function checkBoundaries(
  graph: ModuleGraph,
  rules: readonly BoundaryRule[],
): Violation[] {
  const violations: Violation[] = [];
  for (const rule of rules) {
    const allowed = new Set((rule.allow ?? []).map((a) => `${a.from} ${a.to}`));
    const isAllowed = (from: string, to: string) => allowed.has(`${from} ${to}`);
    const sources = [...graph.keys()].filter((f) => matchesAny(f, rule.from));
    for (const source of sources) {
      if (rule.mode === "direct") {
        for (const edge of graph.get(source) ?? []) {
          if (matchesAny(edge, rule.to) && !isAllowed(source, edge)) {
            violations.push({ ruleId: rule.id, chain: [source, edge] });
          }
        }
        continue;
      }
      // Transitive: breadth-first over the import closure, reporting the
      // shortest chain to each distinct forbidden module.
      const seen = new Set<string>([source]);
      const queue: string[][] = [[source]];
      const reported = new Set<string>();
      while (queue.length > 0) {
        const chain = queue.shift()!;
        const tail = chain[chain.length - 1];
        for (const edge of graph.get(tail) ?? []) {
          if (isAllowed(tail, edge)) continue;
          if (matchesAny(edge, rule.to) && !reported.has(edge)) {
            reported.add(edge);
            violations.push({ ruleId: rule.id, chain: [...chain, edge] });
            continue;
          }
          if (seen.has(edge)) continue;
          seen.add(edge);
          queue.push([...chain, edge]);
        }
      }
    }
  }
  return violations;
}

function describeViolations(
  violations: Violation[],
  rules: readonly BoundaryRule[],
): string {
  return violations
    .map((v) => {
      const rule = rules.find((r) => r.id === v.ruleId);
      return `[${v.ruleId}] ${v.chain.join(" -> ")}\n    ${rule?.reason ?? ""}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

/**
 * Sources are read through Vite's glob rather than `node:fs`: the app tsconfig
 * targets the browser and has no node types, and `src/data/__tests__/seasonCompletion.test.ts`
 * already establishes this pattern. Globs are relative to this file, so
 * `../../x` is `src/x`.
 *
 * Generated season modules are excluded from parsing on purpose. They are
 * several megabytes of literal arrays, they are leaves of the graph as far as
 * any rule here is concerned, and both rules that name them treat them as a
 * destination rather than something to traverse through. If a future rule ever
 * needs to follow an edge *out of* a season module, drop the negation.
 */
const RAW_SOURCES = import.meta.glob(
  ["../../**/*.{ts,tsx}", "!../../data/season_*/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/**
 * Files registered as resolution targets only, with no contents parsed:
 * stylesheets, JSON fixtures, imported assets, and the season modules above.
 * Without them an import of a CSS module would fail to resolve and be dropped
 * silently. Not eager, so only the keys cost anything.
 */
const TARGET_ONLY_MODULES = import.meta.glob([
  "../../**/*.{css,json,svg,png,jpg,jpeg,webp,gif,woff,woff2}",
  "../../data/season_*/**/*.{ts,tsx}",
]);

/**
 * Vite reports glob keys relative to the file that globbed, so a key can be
 * `./sibling.ts`, `../parent.ts`, or `../../components/Home/Home.tsx`. Resolve
 * each against this file's own directory to get a repo-relative path.
 */
const THIS_DIR = "src/utils/__tests__";

function toRepoPath(globKey: string): string {
  return joinPosix(THIS_DIR, globKey);
}

function readRealFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const key of Object.keys(TARGET_ONLY_MODULES)) {
    files.set(toRepoPath(key), "");
  }
  for (const [key, source] of Object.entries(RAW_SOURCES)) {
    files.set(toRepoPath(key), source);
  }
  return files;
}

const realFiles = readRealFiles();
const realGraph = buildGraph(realFiles);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("import boundaries: the real tree", () => {
  it("has no boundary violations", () => {
    const violations = checkBoundaries(realGraph, RULES);
    expect(describeViolations(violations, RULES)).toBe("");
    expect(violations).toEqual([]);
  });

  it("actually resolved the import graph it just checked", () => {
    // Guards against the failure mode where resolution silently produces an
    // empty graph and every rule passes vacuously.
    expect(realGraph.size).toBeGreaterThan(100);
    const homeEdges = realGraph.get("src/components/Home/Home.tsx");
    expect(homeEdges).toBeDefined();
    expect(homeEdges).toContain("src/data/season-metadata.ts");
    expect(realGraph.get("src/utils/__tests__/tradeUtils.test.ts")).toContain(
      "src/utils/tradeUtils.ts",
    );
  });

  it("has no stale baseline exceptions", () => {
    // An `allow` entry is debt. When the edge it excuses is finally deleted,
    // this fails so the entry gets deleted with it rather than silently
    // widening the rule for whatever lands at that path next.
    for (const rule of RULES) {
      for (const exception of rule.allow ?? []) {
        expect(
          realGraph.get(exception.from) ?? [],
          `${rule.id}: allow entry ${exception.from} -> ${exception.to} no longer matches a real import`,
        ).toContain(exception.to);
      }
    }
  });

  it("still enforces rules whose constrained files do not exist yet", () => {
    // The pool surfaces land in later units. An absent `from` glob must be a
    // no-op, not a failure, and must not be quietly deleted as dead config.
    const poolRule = RULES.find(
      (r) => r.id === "pool-never-imports-ownership-helpers",
    );
    expect(poolRule).toBeDefined();
    const targetsExist = poolRule!.to.some((glob) =>
      [...realFiles.keys()].some((f) => globToRegExp(glob).test(f)),
    );
    expect(targetsExist).toBe(true);
  });
});

describe("import boundaries: planted violations", () => {
  it("fails when a pool page imports tradeUtils", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/pages/Pool.tsx",
          `import { getCurrentOwners } from "../utils/tradeUtils";\nexport const Pool = () => null;`,
        ],
        [
          "src/utils/tradeUtils.ts",
          `export const getCurrentOwners = () => {};`,
        ],
      ]),
    );
    const violations = checkBoundaries(graph, RULES);
    expect(violations).toEqual([
      {
        ruleId: "pool-never-imports-ownership-helpers",
        chain: ["src/pages/Pool.tsx", "src/utils/tradeUtils.ts"],
      },
    ]);
  });

  it("fails when a pool component imports the draft cast grid", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/components/Pool/PoolCastPicker.tsx",
          `import { DraftCastGrid } from "../../pages/DraftCastGrid";`,
        ],
        [
          "src/pages/DraftCastGrid.tsx",
          `export const DraftCastGrid = () => null;`,
        ],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toHaveLength(1);
  });

  it("fails when a pool hook imports useCompetitionMeta", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/hooks/usePoolEntry.ts",
          `import { useCompetitionMeta } from "./useCompetitionMeta";`,
        ],
        [
          "src/hooks/useCompetitionMeta.ts",
          `export const useCompetitionMeta = () => {};`,
        ],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toHaveLength(1);
  });

  it("fails when Home.tsx reaches season data transitively", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/components/Home/Home.tsx",
          `import { HomePool } from "./HomePool";`,
        ],
        [
          "src/components/Home/HomePool.tsx",
          `import { getPoolSeason } from "../../utils/poolSeason";`,
        ],
        [
          "src/utils/poolSeason.ts",
          `import { SEASONS } from "../data/seasons";`,
        ],
        ["src/data/seasons.ts", `export const SEASONS = {};`],
      ]),
    );
    const violations = checkBoundaries(graph, RULES);
    expect(violations).toHaveLength(1);
    expect(violations[0].chain).toEqual([
      "src/components/Home/Home.tsx",
      "src/components/Home/HomePool.tsx",
      "src/utils/poolSeason.ts",
      "src/data/seasons.ts",
    ]);
  });

  it("fails when Home.tsx reaches a single season module transitively", () => {
    const graph = buildGraph(
      new Map([
        ["src/components/Home/Home.tsx", `import { x } from "./HomePool";`],
        [
          "src/components/Home/HomePool.tsx",
          `import { SEASON_51_PLAYERS } from "../../data/season_51";`,
        ],
        ["src/data/season_51/index.ts", `export const SEASON_51_PLAYERS = [];`],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toHaveLength(1);
  });

  it("fences the season_47 demo exception to the two edges that hold it", () => {
    // The homepage tolerates HomeDraftExample and HomeTradeExample reaching
    // season 47 for their static demo strips. A third homepage file doing the
    // same thing is exactly the accident the rule exists to catch.
    const graph = buildGraph(
      new Map([
        [
          "src/components/Home/Home.tsx",
          `import { HomePool } from "./HomePool";`,
        ],
        [
          "src/components/Home/HomePool.tsx",
          `import { SEASON_47_PLAYERS } from "../../data/season_47";`,
        ],
        ["src/data/season_47/index.ts", `export const SEASON_47_PLAYERS = [];`],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toHaveLength(1);
  });

  it("catches a lazy-loaded forbidden import", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/components/Home/Home.tsx",
          `const load = () => import("../../data/seasons");`,
        ],
        ["src/data/seasons.ts", `export const SEASONS = {};`],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toHaveLength(1);
  });

  it("catches a re-export of a forbidden module", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/components/Pool/index.ts",
          `export * from "../MyPlayers/MyPlayers";`,
        ],
        [
          "src/components/MyPlayers/MyPlayers.tsx",
          `export const MyPlayers = () => null;`,
        ],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toHaveLength(1);
  });
});

describe("import boundaries: the rules are not over-broad", () => {
  it("allows a non-pool file to import tradeUtils", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/components/Trades/TradePanel.tsx",
          `import { getCurrentOwners } from "../../utils/tradeUtils";`,
        ],
        [
          "src/utils/tradeUtils.ts",
          `export const getCurrentOwners = () => {};`,
        ],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toEqual([]);
  });

  it("allows a pool file to import the metadata-only season list", () => {
    const graph = buildGraph(
      new Map([
        [
          "src/pages/Pool.tsx",
          `import { SEASON_METADATA } from "../data/season-metadata";`,
        ],
        ["src/data/season-metadata.ts", `export const SEASON_METADATA = {};`],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toEqual([]);
  });

  it("allows a non-homepage page to import season data", () => {
    const graph = buildGraph(
      new Map([
        ["src/pages/Season.tsx", `import { SEASONS } from "../data/seasons";`],
        ["src/data/seasons.ts", `export const SEASONS = {};`],
      ]),
    );
    expect(checkBoundaries(graph, RULES)).toEqual([]);
  });

  it("does not treat src/data/seasons.ts as a season_* module or vice versa", () => {
    expect(
      globToRegExp("src/data/season_*/**").test("src/data/seasons.ts"),
    ).toBe(false);
    expect(
      globToRegExp("src/data/season_*/**").test("src/data/season_51/index.ts"),
    ).toBe(true);
    expect(
      globToRegExp("src/hooks/usePool*.ts").test("src/hooks/usePoolEntry.ts"),
    ).toBe(true);
    expect(
      globToRegExp("src/hooks/usePool*.ts").test("src/hooks/useUser.ts"),
    ).toBe(false);
  });
});

describe("parseImportSpecifiers", () => {
  it("finds static, type-only, side-effect, dynamic, and re-export specifiers", () => {
    const source = [
      `import a from "./a";`,
      `import type { B } from "./b";`,
      `import "./c";`,
      `import {`,
      `  d,`,
      `  e,`,
      `} from "./d";`,
      `export * from "./f";`,
      `export { g } from "./g";`,
      `const h = await import("./h");`,
    ].join("\n");
    expect(parseImportSpecifiers(source).sort()).toEqual([
      "./a",
      "./b",
      "./c",
      "./d",
      "./f",
      "./g",
      "./h",
    ]);
  });

  it("ignores a forbidden module named in a line comment", () => {
    // This is the workaround this checker exists to make unnecessary: prose in
    // src/utils/poolRanking.ts and src/utils/seasonPoints.ts should be free to
    // name tradeUtils without tripping anything.
    const source = `// Deliberately does not use tradeUtils; see KTD10.\nimport { rank } from "./rank";`;
    expect(parseImportSpecifiers(source)).toEqual(["./rank"]);
  });

  it("ignores a forbidden module named in a block comment", () => {
    const source = [
      `/**`,
      ` * Unlike src/utils/tradeUtils.ts, picks here are non-exclusive.`,
      ` * import { getCurrentOwners } from "../utils/tradeUtils";`,
      ` */`,
      `import { rank } from "./rank";`,
    ].join("\n");
    expect(parseImportSpecifiers(source)).toEqual(["./rank"]);
  });

  it("does not mistake a URL's double slash for a comment", () => {
    const source = `const docs = "https://example.com/x";\nimport { a } from "./a";`;
    expect(parseImportSpecifiers(source)).toEqual(["./a"]);
  });

  it("ignores bare package specifiers during resolution", () => {
    const graph = buildGraph(
      new Map([
        ["src/pages/Pool.tsx", `import { Button } from "@mantine/core";`],
      ]),
    );
    expect(graph.get("src/pages/Pool.tsx")).toEqual([]);
  });
});
