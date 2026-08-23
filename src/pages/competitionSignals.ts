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

/** The header bug context: season, then the revealed episode or Live. */
export const competitionBugContext = (competition: CompetitionSignals) => {
  const { season_num, current_episode } = competition;
  const mode =
    current_episode == null
      ? "Live"
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
