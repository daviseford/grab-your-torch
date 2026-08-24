import { VisuallyHidden } from "@mantine/core";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useScoringCalculations } from "../../hooks/useScoringCalculations";
import { useUser } from "../../hooks/useUser";
import { getParticipantName } from "../../utils/misc";
import classes from "./ParticipantScoreboard.module.css";
import shared from "./ScoringTables.module.css";

/**
 * The scoreboard strip under the competition header: one scorebug per
 * participant with rank, points through the current episode, the points
 * scored in the last revealed episode, and the roster as a status count
 * (alive / out / via trade). Portraits were too small to recognize anyone,
 * so the strip reports roster health instead of faces.
 */
export const ParticipantScoreboard = () => {
  const { data: competition } = useCompetition();
  const { slimUser } = useUser();
  const { filteredEpisodes, filteredEvents, pointsByUserPerEpisodeWithPropBets } =
    useScoringCalculations();
  const { survivorsByUserUid, eliminatedSurvivors, acquisitions } =
    useCompetitionMeta();

  if (!competition || competition.participants.length === 0) return null;

  const { participants, team_names: teamNames } = competition;
  const lastIndex = filteredEpisodes.length - 1;
  const lastEpisode = lastIndex >= 0 ? filteredEpisodes[lastIndex] : null;

  // Episode-filtered, so the tag only appears once this competition has
  // revealed the finale — no spoiling slower watch-along groups.
  const winnerCastawayId =
    Object.values(filteredEvents).find((e) => e.action === "win_survivor")
      ?.castaway_id ?? null;

  const entries = participants
    .map((participant) => {
      const scores = pointsByUserPerEpisodeWithPropBets[participant.uid];
      return {
        uid: participant.uid,
        name: getParticipantName(participants, participant.uid, teamNames),
        total: scores?.total ?? 0,
        last: lastEpisode ? (scores?.episodePoints[lastIndex] ?? 0) : null,
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const rankOf = (total: number) =>
    1 + entries.filter((entry) => entry.total > total).length;
  const hasPoints = entries.some((entry) => entry.total !== 0);

  return (
    <section className={classes.root} aria-label="Scoreboard">
      <ul className={classes.list} role="list">
        {entries.map((entry) => {
          const rank = rankOf(entry.total);
          const isFirst = rank === 1 && hasPoints;
          const isMe = entry.uid === slimUser?.uid;
          const roster = survivorsByUserUid[entry.uid] ?? [];
          // The Sole Survivor is a castaway, not the participant — the chip
          // names the castaway whose ownership is being claimed here.
          const soleSurvivor = roster.find(
            (p) => p.castaway_id === winnerCastawayId,
          );
          const outCount = roster.filter((p) =>
            eliminatedSurvivors.includes(p.castaway_id),
          ).length;
          const tradeCount = roster.filter(
            (p) => !!acquisitions[p.castaway_id],
          ).length;
          // The winner is never "out" but isn't merely alive either.
          const aliveCount =
            roster.length - outCount - (soleSurvivor ? 1 : 0);
          return (
            <li
              key={entry.uid}
              className={`${classes.bug} ${isMe ? classes.me : ""}`}
              role="listitem"
            >
              <span
                className={`${classes.rank} ${shared.rankBlock} ${isFirst ? shared.rankFirst : ""}`}
              >
                <VisuallyHidden>Rank </VisuallyHidden>
                {rank}
              </span>
              <div className={classes.name}>
                {entry.name}
                {isMe && <em className={classes.you}>You</em>}
              </div>
              <div className={classes.pts}>
                {entry.total}
                <VisuallyHidden> points</VisuallyHidden>
                {lastEpisode && entry.last != null && (
                  <small
                    className={`${classes.delta} ${entry.last > 0 ? classes.gain : ""}`}
                  >
                    {entry.last > 0 ? `+${entry.last}` : entry.last} Ep{" "}
                    {lastEpisode.order}
                  </small>
                )}
              </div>
              {roster.length > 0 &&
                (winnerCastawayId != null ? (
                  // Season's over: the only roster fact that matters is who
                  // owns the Sole Survivor. Everyone else is out.
                  soleSurvivor && (
                    <div className={classes.strip}>
                      <span className={classes.winner}>Sole Survivor</span>
                      <span>{soleSurvivor.full_name}</span>
                    </div>
                  )
                ) : (
                  <div className={classes.strip}>
                    <span>{aliveCount} alive</span>
                    {outCount > 0 && (
                      <span className={classes.out}>{outCount} out</span>
                    )}
                    {tradeCount > 0 && (
                      <span className={classes.trade}>
                        {tradeCount} via trade
                      </span>
                    )}
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
