import { Board, StatusBadge } from "../components/Layout";
import { ScoringLegendTable } from "../components/ScoringTables";
import type { SlimUser } from "../types";
import classes from "./Draft.module.css";
import { initialOf, participantName } from "./DraftNames";

type DraftParticipantsProps = {
  participants: SlimUser[];
  creatorUid: string;
  viewerUid?: string;
  castCount: number;
  /** Picks per participant for the group that has joined so far. */
  picksEach: number | null;
  /** Castaways left undrafted because the cast does not split evenly. */
  undraftedCount?: number;
};

/** The lobby's participant board: one slate per friend who has joined. */
export const DraftParticipants = ({
  participants,
  creatorUid,
  viewerUid,
  castCount,
  picksEach,
  undraftedCount = 0,
}: DraftParticipantsProps) => (
  <Board
    title="Participants"
    subtitle={`${participants.length} joined`}
    titleAs="h2"
    aside={
      <span className={classes.hint}>
        {castCount} castaways
        {picksEach !== null && ` · ${picksEach} picks each`}
        {picksEach !== null &&
          undraftedCount > 0 &&
          ` · ${undraftedCount} undrafted`}
      </span>
    }
  >
    <ul className={classes.people} aria-label="Participants">
      {participants.map((participant) => {
        const name = participantName(participant);
        const isHost = participant.uid === creatorUid;
        return (
          <li
            key={participant.uid}
            className={[
              classes.person,
              participant.uid === viewerUid && classes.personMe,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className={classes.personAvatar} aria-hidden="true">
              {initialOf(name)}
            </span>
            <span className={classes.personName}>{name}</span>
            {isHost ? (
              <StatusBadge kind="season" size="sm">
                Host
              </StatusBadge>
            ) : (
              <StatusBadge kind="complete" size="sm">
                Joined
              </StatusBadge>
            )}
          </li>
        );
      })}
      <li className={`${classes.person} ${classes.personEmpty}`}>
        <span className={classes.personSlot} aria-hidden="true" />
        <span className={classes.personName}>
          {participants.length
            ? "Share the invite link to add a friend."
            : "No one has joined yet. Share the invite link to get started."}
        </span>
      </li>
    </ul>
  </Board>
);

const HOW_IT_WORKS = [
  {
    title: "Join & Invite",
    text: "Everyone joins the lobby, then the host starts the draft.",
  },
  {
    title: "Random Order",
    text: "Pick order is randomly shuffled when the draft starts. No peeking!",
  },
  {
    title: "Draft Players",
    text: "Take turns picking Survivor contestants for your team.",
  },
  {
    title: "Earn Points",
    text: "Score points as your players win challenges, find idols, and survive.",
  },
];

/** The lobby's rundown of the draft: four numbered steps, no icon tiles. */
export const DraftHowItWorks = () => (
  <section aria-labelledby="draft-how-it-works" className={classes.stack}>
    <div className={classes.sectionHead}>
      <h2 id="draft-how-it-works" className={classes.sectionTitle}>
        How it works
      </h2>
    </div>
    <ol className={classes.howSteps}>
      {HOW_IT_WORKS.map((step, index) => (
        <li key={step.title} className={classes.howStep}>
          <span className={classes.howNum} aria-hidden="true">
            {index + 1}
          </span>
          <b>{step.title}</b>
          <span>{step.text}</span>
        </li>
      ))}
    </ol>
  </section>
);

/** The scoring reference as a collapsed board. */
export const DraftScoringReference = () => (
  <details className={classes.details}>
    <summary>
      <span className={classes.sectionTitle}>Scoring Reference</span>
      <span className={classes.detailsHint} aria-hidden="true">
        <span className={classes.detailsHintClosed}>Expand</span>
        <span className={classes.detailsHintOpen}>Collapse</span>
      </span>
    </summary>
    <div className={classes.detailsBody}>
      <ScoringLegendTable />
    </div>
  </details>
);
