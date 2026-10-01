/**
 * Bounded, read-only watch for one episode's survivoR data.
 *
 * Reads survivoR at one pinned commit, the committed season bundle, and the
 * public production documents (`seasons/{id}` and the season pool), then
 * writes `watch-result.json` and `watch-issue.md` for
 * `.github/workflows/watch-episode.yml`. It never imports, writes or pushes
 * anything; see lib/episode-watch.ts for the states.
 *
 * Usage:
 *   EPISODE_WATCH='{"season":51,"episode":2,"deadline":"2026-10-15T14:00:00Z"}' \
 *     yarn tsx scripts/watch-episode.ts
 *   yarn tsx scripts/watch-episode.ts --season 51 --episode 2 --deadline 2026-10-15T14:00:00Z
 */

import * as fs from "fs";
import * as path from "path";
import { assessEpisodeReadiness } from "./lib/episode-readiness.js";
import {
  buildWatchIssue,
  type WatchEvidence,
} from "./lib/episode-watch-report.js";
import {
  decideEpisodeWatch,
  parseWatchConfig,
  type EpisodeWatchConfig,
} from "./lib/episode-watch.js";
import { fetchSeasonData } from "./lib/survivor-client.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const RESULT_PATH = path.join(PROJECT_ROOT, "watch-result.json");
const ISSUE_PATH = path.join(PROJECT_ROOT, "watch-issue.md");
const FIREBASE_PROJECT =
  process.env.VITE_FIREBASE_PROJECT_ID || "survivor-fantasy-51c4b";
const FIRESTORE_DOCS = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readConfig(): EpisodeWatchConfig {
  const season = argValue("--season");
  if (season) {
    return parseWatchConfig(
      JSON.stringify({
        season: Number(season),
        episode: Number(argValue("--episode")),
        deadline: argValue("--deadline"),
      }),
    );
  }
  const raw = process.env.EPISODE_WATCH;
  if (!raw)
    throw new Error("Set EPISODE_WATCH or pass --season/--episode/--deadline");
  return parseWatchConfig(raw);
}

/** Pin one upstream commit so every table comes from the same snapshot. */
async function upstreamHead(): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(
    "https://api.github.com/repos/doehm/survivoR/commits/master",
    { headers },
  );
  if (!res.ok) throw new Error(`survivoR head lookup failed: ${res.status}`);
  const { sha } = (await res.json()) as { sha?: string };
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("survivoR head lookup returned no commit sha");
  }
  return sha;
}

/** Same pattern sync-season.ts counts with: episode definitions only. */
function countBundleEpisodes(seasonNum: number): number {
  const file = path.join(
    PROJECT_ROOT,
    "src",
    "data",
    `season_${seasonNum}`,
    "index.ts",
  );
  if (!fs.existsSync(file)) return 0;
  const content = fs.readFileSync(file, "utf-8");
  return content.match(/^\s+id: "episode_\d+",$/gm)?.length ?? 0;
}

/** Public REST read; null when the document does not exist. */
async function readPublicDoc(
  docPath: string,
  fields: string[],
): Promise<Record<string, unknown> | null> {
  const mask = fields.map((f) => `mask.fieldPaths=${f}`).join("&");
  const res = await fetch(`${FIRESTORE_DOCS}/${docPath}?${mask}`);
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`Firestore read ${docPath} failed: ${res.status}`);
  const body = (await res.json()) as { fields?: Record<string, unknown> };
  return body.fields ?? {};
}

async function main(): Promise<void> {
  const config = readConfig();
  const { seasonNum, episodeNum } = config;
  const now = new Date();

  const sha = await upstreamHead();
  const data = await fetchSeasonData(seasonNum, sha);
  const upstream = assessEpisodeReadiness(data, seasonNum, episodeNum);

  const seasonDoc = await readPublicDoc(`seasons/season_${seasonNum}`, [
    "episodes",
  ]);
  const episodesField = seasonDoc?.episodes as
    | { arrayValue?: { values?: unknown[] } }
    | undefined;
  const firestoreEpisodes = episodesField?.arrayValue?.values?.length ?? 0;

  const poolDoc = await readPublicDoc(`pools/pool_season_${seasonNum}`, [
    "latest_episode_num",
  ]);
  const latest = poolDoc?.latest_episode_num as
    | { integerValue?: string }
    | undefined;
  const poolLatestEpisode =
    poolDoc === null ? null : Number(latest?.integerValue ?? 0);

  const observation = {
    upstream,
    bundleEpisodes: countBundleEpisodes(seasonNum),
    firestoreEpisodes,
    poolLatestEpisode,
  };
  const decision = decideEpisodeWatch(config, observation, now);

  const evidence: WatchEvidence = {
    checkedAt: now.toISOString(),
    upstreamSha: sha,
    upstreamCommitUrl: `https://github.com/doehm/survivoR/commit/${sha}`,
    upstreamTablesUrl: `https://github.com/doehm/survivoR/tree/${sha}/dev/json`,
    seasonDocUrl: `${FIRESTORE_DOCS}/seasons/season_${seasonNum}?mask.fieldPaths=episodes`,
    poolDocUrl: `${FIRESTORE_DOCS}/pools/pool_season_${seasonNum}?mask.fieldPaths=latest_episode_num`,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
  };

  const issue = buildWatchIssue(config, observation, decision, evidence);
  fs.writeFileSync(
    RESULT_PATH,
    JSON.stringify(
      { config, decision, observation, evidence, issueTitle: issue.title },
      null,
      2,
    ),
  );
  fs.writeFileSync(ISSUE_PATH, issue.body);

  console.log(`State: ${decision.state}`);
  console.log(decision.summary);
  console.log(`Upstream: ${evidence.upstreamCommitUrl}`);
  console.log(JSON.stringify(observation.upstream.counts));
}

main().catch((err) => {
  console.error("Episode watch failed:", err);
  process.exit(1);
});
