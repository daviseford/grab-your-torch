import type { Competition } from "../types";

/**
 * The Signal rule for a competition page: Signal Cyan names live, current,
 * or yours, so the live signal shows only while the competition is still
 * running. Watch-along is a mode rather than a signal and always applies.
 */
type CompetitionSignals = Pick<
  Competition,
  "season_num" | "current_episode" | "finished"
>;

/**
 * The header bug context: season, then the revealed episode or the live
 * state. A finished live competition is complete, not live.
 */
export const competitionBugContext = (competition: CompetitionSignals) => {
  const { season_num, current_episode, finished } = competition;
  const mode =
    current_episode == null
      ? finished
        ? "Complete"
        : "Live"
      : current_episode > 0
        ? `Ep ${current_episode} · Watch-along`
        : "Watch-along";
  return `S${season_num} · ${mode}`;
};

/** The mode badge to show, or null when the live signal must stay off. */
export const competitionModeBadge = (
  competition: CompetitionSignals,
): "watch-along" | "live" | null => {
  if (competition.current_episode != null) return "watch-along";
  return competition.finished ? null : "live";
};

/** The cyan lower-third context, carried only while the competition runs. */
export const competitionContextLine = (competition: CompetitionSignals) => {
  const mode = competitionModeBadge(competition);
  if (!mode) return undefined;
  return `Season ${competition.season_num} · ${mode === "live" ? "Live" : "Watch-along"}`;
};

/**
 * How far a watch-along group has watched, from the competition's own
 * `current_episode` boundary: "Pre-season" at 0, then "Episode N". A live
 * competition has no boundary of its own (results appear as they air), so it
 * gets null rather than the season's latest episode.
 */
export const competitionEpisodeLabel = (
  competition: Pick<Competition, "current_episode">,
): string | null => {
  const { current_episode } = competition;
  if (current_episode == null) return null;
  return current_episode > 0 ? `Episode ${current_episode}` : "Pre-season";
};

/**
 * Sort key for the episode column: watch-along groups by how far they have
 * watched, pre-season ahead of live competitions, which have no episode.
 */
export const competitionEpisodeSortKey = (
  competition: Pick<Competition, "current_episode">,
) => competition.current_episode ?? -1;
