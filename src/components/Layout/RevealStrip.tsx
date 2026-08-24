import { VisuallyHidden } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./RevealStrip.module.css";

type RevealStripProps = {
  /** Total episodes in the season. */
  total: number;
  /** Episodes revealed so far (0 means nothing revealed yet). */
  revealedThrough: number;
  /** Caps label on the left, e.g. "Episode reveal" or "Results entered". */
  label?: ReactNode;
  /** Caps status on the right, e.g. "Through episode 6". */
  status?: ReactNode;
  /** Show the Revealed / Next / Hidden legend. */
  legend?: boolean;
  size?: "sm" | "md";
  /** Makes cells buttons; called with the episode number. */
  onSelect?: (episode: number) => void;
  /** Accessible name for the whole strip. */
  ariaLabel?: string;
};

/**
 * The reveal strip: the signature component. A rail of one dot per episode;
 * watched episodes are filled dots on a colored rail, the next episode is a
 * large hollow ring with an "up next" caption, and hidden episodes are faint
 * dots. State is encoded by shape as well as color.
 */
export const RevealStrip = ({
  total,
  revealedThrough,
  label,
  status,
  legend = false,
  size = "md",
  onSelect,
  ariaLabel = "Episode reveal",
}: RevealStripProps) => {
  const episodes = Array.from({ length: total }, (_, i) => i + 1);
  const nextEpisode = revealedThrough + 1;
  const rootClass = [
    classes.root,
    size === "sm" && classes.sm,
    onSelect && classes.interactive,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} role="group" aria-label={ariaLabel}>
      {(label || status) && (
        <div className={classes.labelRow} aria-hidden="true">
          <span>{label}</span>
          {status && <b>{status}</b>}
        </div>
      )}
      <VisuallyHidden>
        {revealedThrough === 0
          ? `No episodes revealed yet of ${total}.`
          : `Episodes 1 to ${revealedThrough} of ${total} revealed.`}
      </VisuallyHidden>
      <div className={classes.cells}>
        {episodes.map((episode) => {
          const state =
            episode <= revealedThrough
              ? "revealed"
              : episode === nextEpisode
                ? "next"
                : "off";
          const cellClass = [
            classes.cell,
            classes[state],
            episode === total && classes.finale,
          ]
            .filter(Boolean)
            .join(" ");
          const title =
            state === "revealed"
              ? `Episode ${episode}, revealed`
              : state === "next"
                ? `Episode ${episode}, next`
                : `Episode ${episode}, hidden`;
          const content = (
            <>
              <i className={classes.dot} aria-hidden="true" />
              {episode}
              {state === "next" && (
                <span className={classes.caption} aria-hidden="true">
                  Up next
                </span>
              )}
            </>
          );
          return onSelect ? (
            <button
              key={episode}
              type="button"
              className={cellClass}
              onClick={() => onSelect(episode)}
              aria-label={title}
              aria-pressed={state === "revealed"}
            >
              {content}
            </button>
          ) : (
            <span key={episode} className={cellClass} aria-label={title}>
              {content}
            </span>
          );
        })}
      </div>
      {legend && (
        <div className={classes.legend} aria-hidden="true">
          <span>
            <i className={classes.revealed} /> Revealed
          </span>
          <span>
            <i className={classes.next} /> Next
          </span>
          <span>
            <i className={classes.off} /> Hidden
          </span>
          <span>
            <i className={classes.finale} /> Finale
          </span>
        </div>
      )}
    </div>
  );
};
