import { getActivePropBetKeys, PropBetsQuestions } from "../../data/propbets";
import { useCompetition } from "../../hooks/useCompetition";
import { useDraft } from "../../hooks/useDraft";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import type { CastawayId, CastawayLookup } from "../../types";
import classes from "./PostDraftPropBetTable.module.css";

/** Resolve a prop bet answer to a display name if it's a castaway ID. */
const resolveAnswer = (answer: string, lookup?: CastawayLookup): string => {
  if (!answer || !lookup) return answer;
  return lookup[answer as CastawayId]?.full_name ?? answer;
};

type Entrant = { uid: string; name: string; isMe: boolean };

type AnswerGroup = {
  answer: string;
  entrants: Entrant[];
  /** No one answered this question, rendered last and muted. */
  blank: boolean;
};

/**
 * Group a question's answers by the value chosen, most-agreed first. The
 * comparison people actually want here is who agrees with whom, and a
 * participant-per-column matrix buries that: it runs one column per question,
 * which never fits and truncates the question itself.
 */
const groupAnswers = (
  entries: { uid: string; name: string; isMe: boolean; answer: string }[],
): AnswerGroup[] => {
  const byAnswer = new Map<string, AnswerGroup>();
  for (const entry of entries) {
    const answer = entry.answer.trim();
    const bucket = answer || "No answer";
    const group = byAnswer.get(bucket) ?? {
      answer: bucket,
      entrants: [],
      blank: !answer,
    };
    group.entrants.push({
      uid: entry.uid,
      name: entry.name,
      isMe: entry.isMe,
    });
    byAnswer.set(bucket, group);
  }
  return [...byAnswer.values()].sort((a, b) => {
    if (a.blank !== b.blank) return a.blank ? 1 : -1;
    if (a.entrants.length !== b.entrants.length)
      return b.entrants.length - a.entrants.length;
    return a.answer.localeCompare(b.answer);
  });
};

/**
 * Every participant's prop bets, one block per question with the answers
 * grouped by who picked what. Reads top to bottom at any width, so the caller
 * frames it in an ordinary board rather than a horizontal scroller.
 */
export const PostDraftPropBetTable = () => {
  const { draft } = useDraft();
  const { slimUser } = useUser();
  const { data: season } = useSeason(draft?.season_id);
  const { data: competition } = useCompetition(draft?.competiton_id);

  if (!draft?.prop_bets) return null;

  const lookup = season?.castawayLookup;
  const activeKeys = getActivePropBetKeys(draft.prop_bets);

  if (activeKeys.length === 0) return null;

  const entrants = draft.prop_bets.map((entry) => ({
    uid: entry.user_uid,
    name: competition?.team_names?.[entry.user_uid] || entry.user_name,
    isMe: entry.user_uid === slimUser?.uid,
    values: entry.values,
  }));

  return (
    <ul className={classes.questions}>
      {activeKeys.map((key) => {
        const question = PropBetsQuestions[key];
        const groups = groupAnswers(
          entrants.map((entrant) => ({
            uid: entrant.uid,
            name: entrant.name,
            isMe: entrant.isMe,
            answer: resolveAnswer(entrant.values[key] || "", lookup),
          })),
        );
        return (
          <li key={key} className={classes.question}>
            <div className={classes.questionHead}>
              <h3 className={classes.questionTitle}>{question.description}</h3>
              <span className={classes.points}>{question.point_value} pts</span>
            </div>
            <ul className={classes.answers}>
              {groups.map((group) => {
                const mine = group.entrants.some((entrant) => entrant.isMe);
                return (
                  <li
                    key={group.answer}
                    className={[
                      classes.answer,
                      group.blank && classes.answerBlank,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className={classes.answerName}>
                      {mine && (
                        <span className={classes.mine} aria-hidden="true" />
                      )}
                      {group.answer}
                    </span>
                    <span className={classes.entrants}>
                      {group.entrants.map((entrant, index) => (
                        <span key={entrant.uid}>
                          {index > 0 && <span aria-hidden="true">, </span>}
                          <span
                            className={entrant.isMe ? classes.entrantMe : ""}
                          >
                            {entrant.name}
                            {entrant.isMe && (
                              <span className={classes.you}> (you)</span>
                            )}
                          </span>
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
};
