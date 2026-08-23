import { Table, Tooltip, VisuallyHidden } from "@mantine/core";
import { useRef } from "react";
import { PropBetQuestionKey, PropBetsQuestions } from "../../data/propbets";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useDragScroll } from "../../hooks/useDragScroll";
import { useScoringCalculations } from "../../hooks/useScoringCalculations";
import { useUser } from "../../hooks/useUser";
import { PropBetScores } from "../../utils/propBetUtils";
import classes from "./ScoringTables.module.css";

// Rank, participant, and points stay pinned while the episode columns scroll
// beneath them (desktop only; see the stylesheet). Offsets are the summed
// fixed widths of the columns before each one.
const STICKY_OFFSETS = { rank: 0, participant: 44, points: 220 } as const;

/**
 * The Standings board: participants ranked by points through the current
 * episode, with the roster summary, prop bet points, and per-episode totals.
 */
export const PerUserPerEpisodeScoringTable = () => {
  const { data: competition } = useCompetition();
  const { slimUser } = useUser();

  const {
    activePropBetKeys,
    filteredEpisodes,
    pointsByUserPerEpisodeWithPropBets,
    propBetScores,
  } = useScoringCalculations();
  const { survivorsByUserUid, eliminatedSurvivors, acquisitions } =
    useCompetitionMeta();

  const scrollRef = useRef<HTMLDivElement>(null);
  useDragScroll(scrollRef);

  const sortedEntries = Object.entries(pointsByUserPerEpisodeWithPropBets).sort(
    (a, b) => b[1].total - a[1].total,
  );

  // Ties share a rank (two participants on 27 points are both 1st), the same
  // way the scoreboard strip above the tabs ranks them.
  const rankOf = (total: number) =>
    1 + sortedEntries.filter(([, v]) => v.total > total).length;
  const hasPoints = sortedEntries.some(([, v]) => v.total > 0);

  const rows = sortedEntries.map(([uid, values]) => {
    const user = competition?.participants.find((x) => x.uid === uid);
    const isCurrentUser = uid === slimUser?.uid;
    const rank = rankOf(values.total);
    const isLeader = rank === 1 && hasPoints;
    const name =
      competition?.team_names?.[uid] || user?.displayName || user?.email;

    const roster = survivorsByUserUid[uid] ?? [];
    const numEliminated = roster.filter((p) =>
      eliminatedSurvivors.includes(p.castaway_id),
    ).length;
    const numAcquired = roster.filter(
      (p) => acquisitions[p.castaway_id],
    ).length;

    return (
      <Table.Tr
        key={uid}
        className={`${classes.row} ${isCurrentUser ? classes.rowMe : ""}`}
      >
        <Table.Td
          className={`${classes.stickyCell} ${classes.colRank}`}
          style={{ left: STICKY_OFFSETS.rank }}
        >
          {isLeader ? (
            <span className={`${classes.rankBlock} ${classes.rankFirst}`}>
              <VisuallyHidden>1st place</VisuallyHidden>
              <span aria-hidden="true">1</span>
            </span>
          ) : (
            <span className={classes.rankBlock}>{rank}</span>
          )}
        </Table.Td>
        <Table.Td
          className={`${classes.stickyCell} ${classes.colParticipant}`}
          style={{ left: STICKY_OFFSETS.participant }}
        >
          <div className={classes.name} title={name ?? undefined}>
            {name}
            {isCurrentUser && <span className={classes.youTag}>You</span>}
          </div>
          <div className={classes.caption}>
            {roster.length} on roster
            {numAcquired > 0 ? ` · ${numAcquired} via trade` : ""} ·{" "}
            {numEliminated} eliminated
          </div>
        </Table.Td>
        <Table.Td
          className={`${classes.stickyCell} ${classes.stickyDivider} ${classes.colPoints}`}
          style={{ left: STICKY_OFFSETS.points }}
        >
          <span className={classes.points}>
            {values.total}
            <small>pts</small>
          </span>
        </Table.Td>

        {activePropBetKeys.length > 0 && (
          <Table.Td className={classes.numCell}>
            <PropBetCell
              points={values.propBetPoints}
              scores={propBetScores[uid]}
              activeKeys={activePropBetKeys}
            />
          </Table.Td>
        )}

        {values.episodePoints.map((x, idx) => (
          <Table.Td key={idx} className={classes.numCell}>
            <span className={`${classes.num} ${x === 0 ? classes.zero : ""}`}>
              {x}
            </span>
          </Table.Td>
        ))}
      </Table.Tr>
    );
  });

  if (filteredEpisodes.length === 0) {
    return (
      <p className={classes.note}>Advance to Episode 1 to see standings</p>
    );
  }

  return (
    <Table.ScrollContainer minWidth={300} ref={scrollRef}>
      <Table
        highlightOnHover
        verticalSpacing="xs"
        horizontalSpacing="sm"
        className={classes.table}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th
              scope="col"
              className={`${classes.stickyHeaderCell} ${classes.colRank}`}
              style={{ left: STICKY_OFFSETS.rank }}
            >
              #
            </Table.Th>
            <Table.Th
              scope="col"
              className={`${classes.stickyHeaderCell} ${classes.colParticipant}`}
              style={{ left: STICKY_OFFSETS.participant }}
            >
              Participant
            </Table.Th>
            <Table.Th
              scope="col"
              className={`${classes.stickyHeaderCell} ${classes.stickyDivider} ${classes.colPoints}`}
              style={{ left: STICKY_OFFSETS.points }}
            >
              Points
            </Table.Th>
            {activePropBetKeys.length > 0 && (
              <Table.Th scope="col" className={classes.colEpisode}>
                Props
              </Table.Th>
            )}
            {filteredEpisodes.map((x) => (
              <Table.Th key={x.id} scope="col" className={classes.colEpisode}>
                Ep {x.order}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
};

function PropBetCell({
  points,
  scores,
  activeKeys,
}: {
  points: number;
  scores?: PropBetScores;
  activeKeys: PropBetQuestionKey[];
}) {
  const correctProps = activeKeys.filter(
    (key) => scores?.[key]?.status === "definitive_correct",
  );

  const label =
    correctProps.length > 0
      ? correctProps
          .map(
            (key) =>
              `${PropBetsQuestions[key].description} (+${PropBetsQuestions[key].point_value})`,
          )
          .join("\n")
      : undefined;

  const content = (
    <span
      className={`${classes.num} ${points === 0 ? classes.zero : ""}`}
      style={label ? { cursor: "default" } : undefined}
    >
      {points}
    </span>
  );

  if (!label) return content;

  return (
    <Tooltip label={label} multiline maw={300} withArrow>
      {content}
    </Tooltip>
  );
}
