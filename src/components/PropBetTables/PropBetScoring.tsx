import { Badge, Table } from "@mantine/core";
import { PropBetQuestionKey, PropBetsQuestions } from "../../data/propbets";
import { useCompetition } from "../../hooks/useCompetition";
import { usePropBetScoring } from "../../hooks/useGetPropBetScoring";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import type { CastawayId, CastawayLookup } from "../../types";
import { PropBetAnswer, PropBetScores } from "../../utils/propBetUtils";
import { StatusBadge } from "../Layout";
import classes from "../ScoringTables/ScoringTables.module.css";

/** Resolve a prop bet answer to a display name if it's a castaway ID. */
const resolveAnswer = (answer: string, lookup?: CastawayLookup): string => {
  if (!answer || !lookup) return answer;
  return lookup[answer as CastawayId]?.full_name ?? answer;
};

const AnswerDisplay = ({
  score,
  lookup,
}: {
  score: PropBetAnswer;
  lookup?: CastawayLookup;
}) => {
  const display = resolveAnswer(score.answer, lookup);

  if (score.status === "definitive_correct") {
    return (
      <div className={classes.propAnswer}>
        <b className={classes.propName}>{display}</b>
        <Badge color="green" variant="filled" size="xs">
          +{score.points_awarded}
        </Badge>
      </div>
    );
  }

  if (score.status === "definitive_incorrect") {
    return (
      <div className={classes.propAnswer}>
        <b className={`${classes.propName} ${classes.propWrong}`}>{display}</b>
        <Badge color="red" variant="outline" size="xs">
          Incorrect
        </Badge>
      </div>
    );
  }

  if (score.status === "leading") {
    return (
      <div className={classes.propAnswer}>
        <b className={`${classes.propName} ${classes.propLeading}`}>
          {display}
        </b>
        <Badge variant="outline" color="yellow" size="xs">
          Leading
        </Badge>
      </div>
    );
  }

  if (!display) {
    return (
      <span className={`${classes.propName} ${classes.propPending}`}>
        No answer
      </span>
    );
  }

  return (
    <div className={classes.propAnswer}>
      <b className={`${classes.propName} ${classes.propPending}`}>{display}</b>
      <StatusBadge kind="pending" size="xs" />
    </div>
  );
};

const getFirstAnswer = (
  scores: PropBetScores,
  activeKeys: PropBetQuestionKey[],
): PropBetAnswer => scores[activeKeys[0]];

/**
 * The Prop Bets board: one row per active question, one column per
 * participant, the points row at the foot. Wide sets scroll inside the board.
 */
export const PropBetScoring = () => {
  const { slimUser } = useUser();
  const { data: scores, activeKeys } = usePropBetScoring();
  const { data: competition } = useCompetition();
  const { data: season } = useSeason(competition?.season_id);

  if (!slimUser || !competition || activeKeys.length === 0) return null;

  const lookup = season?.castawayLookup;
  const users = Object.entries(scores);

  return (
    <Table.ScrollContainer minWidth={300}>
      <Table
        verticalSpacing="xs"
        horizontalSpacing="sm"
        className={classes.table}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th
              scope="col"
              className={`${classes.stickyHeaderCell} ${classes.stickyDivider}`}
              style={{ left: 0 }}
            >
              Question
            </Table.Th>
            {users.map(([uid, s]) => (
              <Table.Th scope="col" key={uid}>
                {getFirstAnswer(s, activeKeys).user_name}
                {uid === slimUser.uid && (
                  <span className={classes.youTag}>You</span>
                )}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {activeKeys.map((key) => {
            const question = PropBetsQuestions[key];
            return (
              <Table.Tr key={key} className={classes.row}>
                <Table.Th
                  scope="row"
                  className={`${classes.stickyCell} ${classes.stickyDivider} ${classes.rowHeader} ${classes.propQuestion}`}
                  style={{ left: 0 }}
                >
                  {question.description}
                  <span className={classes.propValue}>
                    +{question.point_value}
                  </span>
                </Table.Th>
                {users.map(([uid, s]) => (
                  <Table.Td key={uid}>
                    <AnswerDisplay score={s[key]} lookup={lookup} />
                  </Table.Td>
                ))}
              </Table.Tr>
            );
          })}
          <Table.Tr className={`${classes.row} ${classes.propTotalRow}`}>
            <Table.Th
              scope="row"
              className={`${classes.stickyCell} ${classes.stickyDivider} ${classes.rowHeader} ${classes.propQuestion}`}
              style={{ left: 0 }}
            >
              Prop points
            </Table.Th>
            {users.map(([uid, s]) => (
              <Table.Td key={uid}>
                <span className={classes.points}>{s.total}</span>
              </Table.Td>
            ))}
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
};
