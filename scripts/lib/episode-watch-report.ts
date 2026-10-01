/**
 * The tracking issue the episode watch keeps up to date: one issue per
 * season and episode, found again by its title, so repeated runs edit it
 * instead of opening duplicates.
 */

import type {
  EpisodeWatchConfig,
  EpisodeWatchDecision,
  EpisodeWatchObservation,
} from "./episode-watch.js";

export interface WatchEvidence {
  checkedAt: string;
  upstreamSha: string;
  upstreamCommitUrl: string;
  upstreamTablesUrl: string;
  seasonDocUrl: string;
  poolDocUrl: string;
  runUrl?: string;
}

export function watchIssueTitle(config: EpisodeWatchConfig): string {
  return `Episode watch: Season ${config.seasonNum} episode ${config.episodeNum}`;
}

function nextSteps(
  config: EpisodeWatchConfig,
  decision: EpisodeWatchDecision,
): string[] {
  const s = config.seasonNum;
  switch (decision.state) {
    case "ready_to_import":
      return [
        "Publishing is a human step. The watch does not import or push.",
        "",
        "1. In a fresh worktree from `origin/main`, run `yarn tsx scripts/sync-season.ts --no-push`, then `yarn format`.",
        `2. Run \`yarn remap-castaway-ids ${s}\` and \`yarn repair-pool-picks ${s}\` (both read-only). Expect a finalized cutover and no changes.`,
        "3. Open a PR with the season file. Wait for the required `ci` check and review, then merge. Hosting deploys on merge.",
        `4. From the merged \`main\`, run \`yarn tsx scripts/push-seasons.ts ${s} --dry-run\`, then the same command without \`--dry-run\`.`,
        `5. Run \`gh workflow run recompute-pool-standings.yml -f pool=${s}\`, or wait for its schedule.`,
        "",
        "Note: the daily `Sync survivoR data` workflow (14:00 UTC) will also import a complete episode on its own, pushing Firestore before its PR is reviewed. Disable it first if the reviewed path above must be the only route.",
      ];
    case "awaiting_publication":
      return [
        `\`main\` has the episode. Push it with \`yarn tsx scripts/push-seasons.ts ${s}\` from \`main\` if the season document is behind, and run \`gh workflow run recompute-pool-standings.yml -f pool=${s}\` if standings are behind.`,
      ];
    case "inconsistent":
      return [
        "The app shows this episode but survivoR does not have all of it. Check whether a partial import was published, and compare the bundle and production with the survivoR snapshot linked below.",
      ];
    case "expired":
      return [
        "The watch has stopped and disabled itself. To keep watching, set a new deadline in the `EPISODE_WATCH` repository variable and enable the workflow again.",
      ];
    case "published":
      return ["Nothing left to do. The watch has disabled itself."];
    default:
      return ["No action yet. The watch checks again in three hours."];
  }
}

export function buildWatchIssue(
  config: EpisodeWatchConfig,
  obs: EpisodeWatchObservation,
  decision: EpisodeWatchDecision,
  evidence: WatchEvidence,
): { title: string; body: string } {
  const c = obs.upstream.counts;
  const lines = [
    `<!-- episode-watch:season_${config.seasonNum}:episode_${config.episodeNum} -->`,
    `**State:** \`${decision.state}\``,
    "",
    decision.summary,
    "",
    "### Next step",
    ...nextSteps(config, decision),
    "",
    "### survivoR rows for this episode",
    "| episodes | challenge_results | vote_history | castaways out | advantage_movement | journeys |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${c.episodes} | ${c.challengeResults} | ${c.voteHistory} | ${c.castawaysOut} | ${c.advantageMovement} | ${c.journeys} |`,
    "",
    ...(obs.upstream.missing.length > 0
      ? ["Not yet complete:", ...obs.upstream.missing.map((m) => `- ${m}`), ""]
      : []),
    "### App",
    `- Episodes on \`main\`: ${obs.bundleEpisodes}`,
    `- Episodes in production \`seasons/season_${config.seasonNum}\`: ${obs.firestoreEpisodes}`,
    `- Pool standings latest episode: ${obs.poolLatestEpisode ?? "no pool"}`,
    "",
    "### Evidence",
    `- survivoR commit: ${evidence.upstreamCommitUrl}`,
    `- survivoR tables at that commit: ${evidence.upstreamTablesUrl}`,
    `- Production season document: ${evidence.seasonDocUrl}`,
    `- Production pool document: ${evidence.poolDocUrl}`,
    ...(evidence.runUrl ? [`- Watch run: ${evidence.runUrl}`] : []),
    `- Checked: ${evidence.checkedAt}`,
    `- Deadline: ${config.deadline}`,
  ];
  return { title: watchIssueTitle(config), body: lines.join("\n") + "\n" };
}
