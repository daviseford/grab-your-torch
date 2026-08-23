import { SEASON_47_PLAYERS } from "../../data/season_47";
import draft from "../../pages/Draft.module.css";
import { DraftBoard } from "../../pages/DraftBoard";
import type { DraftPick, SlimUser } from "../../types";
import { StatusBadge } from "../Layout";
import classes from "./Home.module.css";

/**
 * The live draft board exactly as the draft page renders it, on a four-person
 * draft of the Survivor 47 cast. The participants are fictional; the viewer is
 * on the clock for pick 7 so the "your turn" state shows.
 */
const PARTICIPANTS: SlimUser[] = [
  {
    uid: "example-marisol",
    displayName: "Marisol",
    email: null,
    isAdmin: false,
  },
  { uid: "example-theo", displayName: "Theo", email: null, isAdmin: false },
  { uid: "example-jordan", displayName: "Jordan", email: null, isAdmin: false },
  { uid: "example-priya", displayName: "Priya", email: null, isAdmin: false },
];
const VIEWER_UID = "example-jordan";
const TOTAL_PICKS = 16;
const ROUNDS = TOTAL_PICKS / PARTICIPANTS.length;
const CURRENT_PICK = 7;
const CURRENT_ROUND = Math.ceil(CURRENT_PICK / PARTICIPANTS.length);

/** Picks 1 to 6 in round-robin order, each taking the next castaway in the cast list. */
const PICKS: DraftPick[] = SEASON_47_PLAYERS.slice(0, CURRENT_PICK - 1).map(
  (player, index) => {
    const picker = PARTICIPANTS[index % PARTICIPANTS.length];
    return {
      season_id: "season_47",
      season_num: 47,
      order: index + 1,
      user_uid: picker.uid,
      user_name: picker.displayName ?? picker.uid,
      castaway_id: player.castaway_id,
      player_name: player.full_name,
    };
  },
);

const nextPicker = PARTICIPANTS[CURRENT_PICK % PARTICIPANTS.length];

export const HomeDraftExample = () => (
  <figure className={classes.draftExample}>
    <div className={draft.spine}>
      <div className={draft.head}>
        <div className={draft.headText}>
          <p className={draft.eyebrow}>
            <span className={draft.liveDot} aria-hidden="true" />
            Round {CURRENT_ROUND} of {ROUNDS} · {nextPicker.displayName} picks
            next
          </p>
          <p className={draft.title}>Your turn to pick!</p>
        </div>
        <div className={draft.tools}>
          <div className={draft.marker}>
            <StatusBadge kind="live" size="md">
              Your turn
            </StatusBadge>
            <span className={draft.markerMeta}>
              Pick {CURRENT_PICK} of {TOTAL_PICKS} · Round {CURRENT_ROUND} of{" "}
              {ROUNDS}
            </span>
          </div>
        </div>
      </div>
      <DraftBoard
        columns={PARTICIPANTS}
        rounds={ROUNDS}
        totalPicks={TOTAL_PICKS}
        picks={PICKS}
        players={SEASON_47_PLAYERS}
        currentPickNumber={CURRENT_PICK}
        currentPickerUid={VIEWER_UID}
        viewerUid={VIEWER_UID}
        ariaLabel="Example draft board"
      />
    </div>
    <figcaption className={classes.draftExampleCaption}>
      A four-person draft of the Survivor 47 cast, on the clock for pick 7.
    </figcaption>
  </figure>
);
