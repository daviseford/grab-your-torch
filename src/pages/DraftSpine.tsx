import { Title } from "@mantine/core";
import type { ReactNode } from "react";
import { useId } from "react";
import classes from "./Draft.module.css";

type DraftSpineProps = {
  /** Caps line above the title; pass `live` to lead with the signal dot. */
  eyebrow: ReactNode;
  live?: boolean;
  title: ReactNode;
  description?: ReactNode;
  /** Right side of the head: the share plate, the Start slate, the turn marker. */
  tools?: ReactNode;
  /** One line under the board. */
  foot?: ReactNode;
  /** The board (or nothing for the form steps). */
  children?: ReactNode;
  /** In light mode, sit on the studio panel instead of the navy plate. */
  studio?: boolean;
};

/**
 * The board spine: the page's navy plate carrying the lower-third and the
 * draft board. Every draft phase opens with it so the surface keeps one
 * grammar from lobby to summary.
 */
export const DraftSpine = ({
  eyebrow,
  live = false,
  title,
  description,
  tools,
  foot,
  children,
  studio = false,
}: DraftSpineProps) => {
  const titleId = useId();
  return (
    <section
      className={
        studio ? `${classes.spine} ${classes.spineStudio}` : classes.spine
      }
      aria-labelledby={titleId}
    >
      <div className={classes.head}>
        <div className={classes.headText}>
          <p className={classes.eyebrow}>
            {live && <span className={classes.liveDot} aria-hidden="true" />}
            {eyebrow}
          </p>
          <Title order={1} id={titleId} className={classes.title}>
            {title}
          </Title>
          {description && <p className={classes.sub}>{description}</p>}
        </div>
        {tools && <div className={classes.tools}>{tools}</div>}
      </div>
      {children}
      {foot && <p className={classes.foot}>{foot}</p>}
    </section>
  );
};
