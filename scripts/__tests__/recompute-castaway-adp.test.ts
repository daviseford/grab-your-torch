import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SEASONS } from "../../src/data/seasons";
import type { CastawayId, Episode, Player, Season } from "../../src/types";
import {
  accountsFor,
  promoted,
} from "../../src/utils/__tests__/castawayAdpFixtures";
import type { AdpCompetitionSource } from "../../src/utils/castawayAdp";
import {
  type AccountReader,
  type CompetitionReader,
  describePlan,
  type DraftReader,
  type Fixture,
  isDirectRun,
  loadAccounts,
  loadCompetitions,
  parseArgs,
  planSeason,
  publishPlans,
  readFixture,
  resolvePremiereAirDate,
  type SummaryStore,
} from "../recompute-castaway-adp";

const CAST = ["US9001", "US9002", "US9003", "US9004"] as CastawayId[];

const season = (
  episodes: Partial<Episode>[] = [{ order: 1, air_date: "2026-09-23" }],
  id: Season["id"] = "season_51",
) =>
  ({
    id,
    order: Number(id.replace("season_", "")),
    players: CAST.map((castaway_id) => ({ castaway_id }) as Player),
    episodes: episodes as Episode[],
  }) as const;

describe("parseArgs", () => {
  it("accepts season numbers or ids and defaults to a dry run of both cohorts", () => {
    expect(parseArgs(["51", "season_50"])).toEqual({
      seasonIds: ["season_51", "season_50"],
      cohorts: ["pre_premiere", "all_drafts"],
      write: false,
      fixture: null,
      project: null,
    });
    expect(parseArgs(["51", "--fixture", "f.json"]).fixture).toBe("f.json");
    expect(parseArgs(["51", "--cohort", "all_drafts"]).cohorts).toEqual([
      "all_drafts",
    ]);
    expect(parseArgs(["51", "--write", "--project", "demo-x"])).toMatchObject({
      write: true,
      project: "demo-x",
    });
  });

  it("rejects anything it does not understand rather than guessing", () => {
    expect(() => parseArgs(["51", "--wrte"])).toThrow(/--wrte/);
    expect(() => parseArgs(["51", "--cohort", "everything"])).toThrow();
    expect(() => parseArgs(["51", "--project"])).toThrow(/needs a value/);
    expect(() => parseArgs(["51", "--project", "--write"])).toThrow();
  });
});

describe("resolvePremiereAirDate", () => {
  it("prefers the aired first episode, then the listing, the catalog, the sourced table", () => {
    expect(resolvePremiereAirDate(season())).toBe("2026-09-23");
    expect(
      resolvePremiereAirDate(season([]), {
        season_51: [{ order: 1, air_date: "2026-09-30" }],
      }),
    ).toBe("2026-09-30");
    expect(
      resolvePremiereAirDate(season([]), {}, {
        season_51: { premiere: "2026-10-07" },
      } as never),
    ).toBe("2026-10-07");
    expect(
      resolvePremiereAirDate(season([]), {}, {} as never, {
        season_51: "2026-10-14",
      }),
    ).toBe("2026-10-14");
    expect(resolvePremiereAirDate(season([]), {}, {} as never, {})).toBeNull();
  });

  it("knows the premiere of every season the app has hosted drafts for", () => {
    // The app's first commit is 2024-02-13, before Survivor 46 premiered.
    const expected: Partial<Record<Season["id"], string>> = {
      season_46: "2024-02-28",
      season_47: "2024-09-18",
      season_48: "2025-02-26",
      season_49: "2025-09-24",
      season_50: "2026-02-25",
      season_51: "2026-09-23",
    };
    for (const [id, date] of Object.entries(expected)) {
      const seasons = SEASONS as Partial<Record<Season["id"], Season>>;
      expect(resolvePremiereAirDate(seasons[id as Season["id"]]!)).toBe(date);
    }
  });
});

describe("loading", () => {
  it("joins each competition of the named seasons to its draft, with server times", async () => {
    const created = new Date("2026-09-20T12:00:00Z");
    const updated = new Date("2026-09-21T12:00:00Z");
    const db: CompetitionReader = {
      collection: () => ({
        get: async () => ({
          docs: [
            {
              id: "competition_a",
              data: () => ({ season_id: "season_51", draft_id: "draft_a" }),
              createTime: { toDate: () => created },
              updateTime: { toDate: () => updated },
            },
            {
              id: "competition_b",
              data: () => ({ season_id: "season_51", draft_id: "../users" }),
            },
            {
              id: "competition_other",
              data: () => ({ season_id: "season_50", draft_id: "draft_c" }),
            },
            { id: "competition_empty", data: () => undefined },
          ],
        }),
      }),
    };
    const read: string[] = [];
    const drafts: DraftReader = {
      ref: (path) => ({
        once: async () => {
          read.push(path);
          return { val: () => ({ id: "draft_a" }) };
        },
      }),
    };

    expect(await loadCompetitions(db, drafts, ["season_51"])).toEqual([
      {
        id: "competition_a",
        createdAt: created,
        updatedAt: updated,
        data: { season_id: "season_51", draft_id: "draft_a" },
        sourceDraft: { id: "draft_a" },
      },
      {
        id: "competition_b",
        createdAt: null,
        updatedAt: null,
        data: { season_id: "season_51", draft_id: "../users" },
        sourceDraft: null,
      },
    ]);
    // Only well-formed draft ids of the named seasons are read.
    expect(read).toEqual(["drafts/draft_a"]);
  });

  it("looks up participant accounts 100 at a time and skips unknown uids", async () => {
    const sources = Array.from({ length: 120 }, () => promoted(CAST));
    const calls: number[] = [];
    const auth: AccountReader = {
      getUsers: async (ids) => {
        calls.push(ids.length);
        return {
          users: ids
            .filter(({ uid }) => !uid.endsWith("_1"))
            .map(({ uid }) => ({
              uid,
              metadata: { creationTime: "Thu, 01 Jan 2026 00:00:00 GMT" },
            })),
        };
      },
    };
    const accounts = await loadAccounts(auth, sources);
    expect(calls).toEqual([100, 100, 40]);
    expect(accounts.size).toBe(120);
    expect(accounts.get(sources[0].data.creator_uid as string)).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
  });

  it("reads a fixture file's shape", () => {
    const { competitions, accounts } = readFixture({
      competitions: [
        {
          id: "competition_f",
          created_at: "2026-09-01T00:00:00Z",
          data: { season_id: "season_51" },
        },
      ],
      accounts: { uid_a: "2026-01-01T00:00:00Z" },
    });
    expect(competitions[0]).toMatchObject({
      createdAt: new Date("2026-09-01T00:00:00Z"),
      updatedAt: null,
      sourceDraft: null,
    });
    expect(accounts.get("uid_a")).toEqual(new Date("2026-01-01T00:00:00Z"));
  });
});

describe("planSeason and describePlan", () => {
  const sources = [
    promoted(CAST, { createdAt: new Date("2026-09-01T00:00:00Z") }),
    promoted([CAST[1], CAST[0], CAST[2], CAST[3]], {
      createdAt: new Date("2026-09-02T00:00:00Z"),
    }),
    promoted(CAST, { createdAt: new Date("2026-10-01T00:00:00Z") }),
  ];
  const accounts = accountsFor(sources);
  const thresholds = { minDrafts: 1, minCreators: 1 };

  it("refuses a pre-premiere cut with no known premiere, but not all-drafts", () => {
    const noPremiere = season([], "season_9");
    expect(
      planSeason(
        noPremiere,
        "season_9",
        "pre_premiere",
        sources,
        accounts,
        "now",
      ),
    ).toMatchObject({ ok: false });
    expect(
      planSeason(
        noPremiere,
        "season_9",
        "all_drafts",
        sources,
        accounts,
        "now",
      ),
    ).toMatchObject({ ok: true });
    expect(
      planSeason(
        undefined,
        "season_99",
        "all_drafts",
        sources,
        accounts,
        "now",
      ),
    ).toEqual({
      seasonId: "season_99",
      cohort: "all_drafts",
      ok: false,
      reason: "not a registered season",
    });
  });

  it("plans each cohort and reports counts without naming anyone or any figure", () => {
    const pre = planSeason(
      season(),
      "season_51",
      "pre_premiere",
      sources,
      accounts,
      "now",
      thresholds,
    );
    const all = planSeason(
      season(),
      "season_51",
      "all_drafts",
      sources,
      accounts,
      "now",
      thresholds,
    );
    if (!pre.ok || !all.ok) throw new Error("expected plans");
    expect(pre.plan.summary.draft_count).toBe(2);
    expect(pre.plan.excluded.after_premiere).toBe(1);
    expect(all.plan.summary.draft_count).toBe(3);

    const report = [...describePlan(pre), ...describePlan(all)].join("\n");
    expect(report).toContain("season_51 pre_premiere: 2 qualifying draft(s)");
    expect(report).toContain("season_51 all_drafts: 3 qualifying draft(s)");
    expect(report).not.toMatch(/competition_|uid_|draft_\d|someone|US\d{4}/);
  });
});

describe("publishPlans", () => {
  const sources: AdpCompetitionSource[] = [promoted(CAST)];
  const planFor = (computedAt: string) =>
    (["pre_premiere", "all_drafts"] as const).map((cohort) =>
      planSeason(
        season(),
        "season_51",
        cohort,
        sources,
        accountsFor(sources),
        computedAt,
        { minDrafts: 1, minCreators: 1 },
      ),
    );

  const memoryStore = () => {
    const docs = new Map<string, unknown>();
    const writes: string[] = [];
    const store: SummaryStore = {
      read: async (id) => docs.get(id),
      write: async (id, summary) => {
        writes.push(id);
        docs.set(id, JSON.parse(JSON.stringify(summary)));
      },
    };
    return { docs, writes, store };
  };

  it("writes each named cohort once and skips a rerun with the same numbers", async () => {
    const { writes, store, docs } = memoryStore();
    docs.set("season_50_pre_premiere", { untouched: true });

    const first = await publishPlans(planFor("2026-09-21T00:00:00Z"), store);
    expect(first).toEqual([
      "Published castaway_adp/season_51_pre_premiere.",
      "Published castaway_adp/season_51_all_drafts.",
    ]);

    const second = await publishPlans(planFor("2026-09-22T00:00:00Z"), store);
    expect(second).toEqual([
      "Unchanged castaway_adp/season_51_pre_premiere: not written.",
      "Unchanged castaway_adp/season_51_all_drafts: not written.",
    ]);
    expect(writes).toEqual(["season_51_pre_premiere", "season_51_all_drafts"]);
    // Documents outside the run are never touched.
    expect(docs.get("season_50_pre_premiere")).toEqual({ untouched: true });
  });

  it("rewrites only a document whose numbers changed", async () => {
    const { writes, store } = memoryStore();
    await publishPlans(planFor("2026-09-21T00:00:00Z"), store);
    sources.push(promoted([CAST[1], CAST[0], CAST[2], CAST[3]]));
    const [pre, all] = planFor("2026-09-22T00:00:00Z");
    await publishPlans([pre, all], store);
    expect(writes.slice(2)).toEqual([
      "season_51_pre_premiere",
      "season_51_all_drafts",
    ]);
  });

  it("never writes a refused plan", async () => {
    const { writes, store } = memoryStore();
    await publishPlans(
      [
        {
          seasonId: "season_9",
          cohort: "pre_premiere",
          ok: false,
          reason: "no premiere",
        },
      ],
      store,
    );
    expect(writes).toEqual([]);
  });
});

describe("running the script", () => {
  const SCRIPT = fileURLToPath(
    new URL("../recompute-castaway-adp.ts", import.meta.url),
  );
  const REPO = path.resolve(path.dirname(SCRIPT), "..");
  const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
  const run = promisify(execFile);

  /** The script's stdout and exit code, run the way the workflow runs it. */
  const cli = async (args: string[]) => {
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        [TSX_CLI, SCRIPT, ...args],
        { cwd: REPO, timeout: 90_000 },
      );
      return { code: 0, stdout, stderr };
    } catch (error) {
      const failed = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        code: failed.code ?? -1,
        stdout: failed.stdout ?? "",
        stderr: failed.stderr ?? "",
      };
    }
  };

  it("recognises its own entry path on this platform, and nothing else", () => {
    // On the Linux runner these are POSIX paths, the case the old guard got
    // wrong; on Windows they are drive paths.
    expect(isDirectRun(pathToFileURL(SCRIPT).href, SCRIPT)).toBe(true);
    expect(
      isDirectRun(
        pathToFileURL(SCRIPT).href,
        path.join(REPO, "scripts", "recompute-pool-standings.ts"),
      ),
    ).toBe(false);
    expect(isDirectRun(pathToFileURL(SCRIPT).href, undefined)).toBe(false);
  });

  it("runs main() when started directly, printing counts from a fixture", async () => {
    const s51 = SEASONS.season_51;
    // Eight castaways: an even board two people can split.
    const cast = s51.players.slice(0, 8).map((player) => player.castaway_id);
    const creators = 5;
    const drafts = Array.from({ length: 10 }, (_, i) =>
      promoted(i % 2 ? cast : [...cast].reverse(), {
        uids: [`uid_creator_${i % creators}`, `uid_partner_${i}`],
      }),
    );
    // A legacy record written after the premiere: all-drafts only.
    drafts.push(
      promoted(cast, {
        uids: ["uid_late_a", "uid_late_b"],
        updatedAt: new Date("2026-10-15T00:00:00Z"),
      }),
    );
    const fixture: Fixture = {
      competitions: drafts.map((draft) => ({
        id: draft.id,
        created_at: draft.createdAt?.toISOString() ?? null,
        updated_at: draft.updatedAt?.toISOString() ?? null,
        data: draft.data,
        source_draft: draft.sourceDraft,
      })),
      accounts: Object.fromEntries(
        [...accountsFor(drafts)].map(([uid, at]) => [uid, at.toISOString()]),
      ),
    };
    const dir = mkdtempSync(path.join(tmpdir(), "adp-cli-"));
    const file = path.join(dir, "fixture.json");
    writeFileSync(file, JSON.stringify(fixture));
    try {
      const { code, stdout } = await cli(["51", "--fixture", file]);
      expect(code).toBe(0);
      expect(stdout).toContain(`Reading competitions from the fixture`);
      expect(stdout).toMatch(
        /season_51 pre_premiere: 10 qualifying draft\(s\) saved before \S+ and not written since\./,
      );
      expect(stdout).toContain("edited_after_premiere 1");
      expect(stdout).toContain("season_51 all_drafts: 11 qualifying draft(s).");
      expect(stdout).toMatch(/Castaways published: [1-9]\d*;/);
      expect(stdout).toContain("Dry run: nothing written.");
      // Counts only: no uid, competition, draft, or castaway id.
      expect(stdout).not.toMatch(/uid_|competition_|draft_\d|US\d{4}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("refuses to run without a season, and refuses --fixture with --write", async () => {
    const none = await cli([]);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain("Refusing to run: no season given");
    const both = await cli(["51", "--fixture", "x.json", "--write"]);
    expect(both.code).toBe(1);
    expect(both.stderr).toContain("--fixture and --write cannot be combined");
  }, 120_000);

  it("does nothing when imported rather than run", async () => {
    const { stdout, stderr } = await run(
      process.execPath,
      [
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href,
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); console.log("imported");`,
      ],
      { cwd: REPO, timeout: 90_000 },
    );
    expect(stdout.trim()).toBe("imported");
    expect(stderr).not.toContain("Refusing");
  }, 120_000);
});
