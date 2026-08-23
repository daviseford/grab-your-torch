import { useReducedMotion } from "@mantine/hooks";
import { useEffect, useRef } from "react";
import type { DraftPick, Player, SlimUser } from "../types";
import classes from "./Draft.module.css";
import { firstNameOf, initialOf, participantName } from "./DraftNames";

type DraftBoardProps = {
  /** Participants in column order (the pick order once the draft starts). */
  columns: SlimUser[];
  /** Rounds (rows) to render. */
  rounds: number;
  /** Total picks in the draft; cells past it stay blank. */
  totalPicks: number;
  picks: DraftPick[];
  players: Player[];
  /** The pick on the clock; set only while the draft is live. */
  currentPickNumber?: number;
  currentPickerUid?: string | null;
  viewerUid?: string;
  /** Lobby: a trailing dashed column for the next friend to join. */
  openColumn?: boolean;
  /** Print pick numbers in empty cells (off in the lobby, where order is unknown). */
  numbered?: boolean;
  /** Live drafting: window the board on narrow screens and keep the current row in view. */
  windowed?: boolean;
  ariaLabel?: string;
};

/**
 * The draft board: rounds by participants, filling live from realtime
 * state. Your column carries the League Blue bar, the pick just made is
 * marked in Ember, and the cell on the clock pulses Signal Cyan. Pick order
 * is round-robin, so pick n lands in column (n - 1) mod participants.
 */
export const DraftBoard = ({
  columns,
  rounds,
  totalPicks,
  picks,
  players,
  currentPickNumber,
  currentPickerUid,
  viewerUid,
  openColumn = false,
  numbered = true,
  windowed = false,
  ariaLabel = "Draft board",
}: DraftBoardProps) => {
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);

  const isLive = currentPickNumber !== undefined;
  const columnCount = columns.length + (openColumn ? 1 : 0);
  const pickByOrder = new Map(picks.map((pick) => [pick.order, pick]));
  const playerById = new Map(players.map((p) => [p.castaway_id, p]));
  const freshOrder = isLive && picks.length ? picks[picks.length - 1].order : 0;

  // Turn change: bring the cell on the clock into the board's own scroll
  // window. The page itself is never scrolled.
  useEffect(() => {
    if (!windowed) return;
    const scroller = scrollRef.current;
    const cell = nowRef.current;
    if (!scroller || !cell) return;
    const overflows =
      scroller.scrollHeight > scroller.clientHeight ||
      scroller.scrollWidth > scroller.clientWidth;
    if (!overflows) return;
    scroller.scrollTo({
      top: Math.max(
        0,
        cell.offsetTop - scroller.clientHeight / 2 + cell.offsetHeight / 2,
      ),
      left: Math.max(
        0,
        cell.offsetLeft - scroller.clientWidth / 2 + cell.offsetWidth / 2,
      ),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [windowed, currentPickNumber, reduceMotion]);

  return (
    <div
      ref={scrollRef}
      className={[classes.boardScroll, windowed && classes.boardWindowed]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        role="table"
        aria-label={ariaLabel}
        className={classes.board}
        style={{ "--board-cols": columnCount } as React.CSSProperties}
      >
        <div role="row" style={{ display: "contents" }}>
          <div
            role="columnheader"
            className={`${classes.rd} ${classes.corner}`}
          >
            Rd
          </div>
          {columns.map((user) => {
            const name = participantName(user);
            const isNow = isLive && user.uid === currentPickerUid;
            return (
              <div
                key={user.uid}
                role="columnheader"
                className={[classes.hd, isNow && classes.hdNow]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className={classes.avatar} aria-hidden="true">
                  {initialOf(name)}
                </span>
                <span className={classes.hdName}>
                  {name}
                  {user.uid === viewerUid && <small> (you)</small>}
                </span>
              </div>
            );
          })}
          {openColumn && (
            <div
              role="columnheader"
              className={`${classes.hd} ${classes.hdOpen}`}
            >
              <span className={classes.slot} aria-hidden="true" />
              <span className={classes.hdName}>Open</span>
            </div>
          )}
        </div>

        {Array.from({ length: rounds }, (_, roundIndex) => {
          const round = roundIndex + 1;
          return (
            <div key={round} role="row" style={{ display: "contents" }}>
              <div role="rowheader" className={classes.rd}>
                R{round}
              </div>
              {columns.map((user, columnIndex) => {
                const order = roundIndex * columns.length + columnIndex + 1;
                if (order > totalPicks) {
                  return (
                    <div
                      key={user.uid}
                      role="cell"
                      className={`${classes.cell} ${classes.cellEmpty}`}
                    />
                  );
                }
                const pick = pickByOrder.get(order);
                if (pick) {
                  const player = playerById.get(pick.castaway_id);
                  const isMine = pick.user_uid === viewerUid;
                  const isFresh = pick.order === freshOrder;
                  return (
                    <div
                      key={user.uid}
                      role="cell"
                      aria-label={`Pick ${order}: ${pick.player_name}`}
                      title={pick.player_name}
                      className={[
                        classes.cell,
                        isMine && classes.cellMe,
                        isFresh && classes.cellFresh,
                        isFresh && classes.cellFlash,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {player?.img ? (
                        <img
                          className={classes.thumb}
                          src={player.img}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className={classes.thumb} aria-hidden="true">
                          {initialOf(pick.player_name)}
                        </span>
                      )}
                      <span className={classes.cellText}>
                        <span className={classes.cellName}>
                          {firstNameOf(pick.player_name)}
                        </span>
                        <small className={classes.cellNum}>{order}</small>
                      </span>
                    </div>
                  );
                }
                if (isLive && order === currentPickNumber) {
                  const isYou = user.uid === viewerUid;
                  return (
                    <div
                      key={user.uid}
                      ref={nowRef}
                      role="cell"
                      aria-current="true"
                      className={`${classes.cell} ${classes.cellNow}`}
                    >
                      <span className={classes.liveDot} aria-hidden="true" />
                      <span className={classes.cellText}>
                        <span className={classes.cellName}>
                          {isYou ? "Your pick" : participantName(user)}
                        </span>
                        <small className={classes.cellNum}>{order}</small>
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={user.uid}
                    role="cell"
                    className={`${classes.cell} ${classes.cellEmpty}`}
                  >
                    {numbered ? order : null}
                  </div>
                );
              })}
              {openColumn && (
                <div
                  role="cell"
                  className={`${classes.cell} ${classes.cellEmpty}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
