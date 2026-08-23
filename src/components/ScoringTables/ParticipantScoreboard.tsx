import { VisuallyHidden } from "@mantine/core";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useScoringCalculations } from "../../hooks/useScoringCalculations";
import { useUser } from "../../hooks/useUser";
import { getParticipantName } from "../../utils/misc";
import classes from "./ParticipantScoreboard.module.css";
import shared from "./ScoringTables.module.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

/**
 * The scoreboard strip under the competition header: one scorebug per
 * participant with rank, points through the current episode, the points
 * scored in the last revealed episode, and the roster as a strip of
 * portraits (eliminated struck, via-trade ringed in cyan).
 */
export const ParticipantScoreboard = () => {
  const { data: competition } = useCompetition();
  const { slimUser } = useUser();
  const { filteredEpisodes, pointsByUserPerEpisodeWithPropBets } =
    useScoringCalculations();
  const { survivorsByUserUid, eliminatedSurvivors, acquisitions } =
    useCompetitionMeta();

  if (!competition || competition.participants.length === 0) return null;

  const { participants, team_names: teamNames } = competition;
  const lastIndex = filteredEpisodes.length - 1;
  const lastEpisode = lastIndex >= 0 ? filteredEpisodes[lastIndex] : null;

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
              {roster.length > 0 && (
                <div
                  className={classes.strip}
                  role="group"
                  aria-label={`${entry.name}'s roster`}
                >
                  {roster.map((player) => {
                    const isOut = eliminatedSurvivors.includes(
                      player.castaway_id,
                    );
                    const viaTrade = !!acquisitions[player.castaway_id];
                    const stateClass = isOut
                      ? classes.out
                      : viaTrade
                        ? classes.trade
                        : "";
                    const alt = `${player.full_name}${
                      isOut ? ", eliminated" : viaTrade ? ", via trade" : ""
                    }`;
                    return player.img ? (
                      <img
                        key={player.castaway_id}
                        src={player.img}
                        alt={alt}
                        width={22}
                        height={28}
                        loading="lazy"
                        decoding="async"
                        className={`${classes.face} ${stateClass}`}
                      />
                    ) : (
                      <span
                        key={player.castaway_id}
                        className={`${classes.initials} ${stateClass}`}
                        role="img"
                        aria-label={alt}
                      >
                        {initials(player.full_name)}
                      </span>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
