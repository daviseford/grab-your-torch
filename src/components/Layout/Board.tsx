import type { HTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import classes from "./Board.module.css";

type BoardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  /** Caps title in the board's head row. */
  title: ReactNode;
  /** Muted caps qualifier after the title, e.g. "Through episode 6". */
  subtitle?: ReactNode;
  /** Right side of the head row: badges, controls. */
  aside?: ReactNode;
  /** Heading level for the title (boards are usually sections under an h2). */
  titleAs?: "h2" | "h3" | "h4" | "div";
  /** Remove body padding (tables and lists that run edge to edge). */
  flush?: boolean;
  /** Wrap the body in a local horizontal scroller (wide tables). */
  scroll?: boolean;
  /** Tighter rows for operational tables. */
  dense?: boolean;
  children: ReactNode;
};

/**
 * The board: a titled panel for tables, lists, and grouped data. The head
 * carries identity; the body carries the data; wide content scrolls inside
 * the board rather than the page.
 */
export const Board = ({
  title,
  subtitle,
  aside,
  titleAs: TitleTag = "h3",
  flush = false,
  scroll = false,
  dense = false,
  children,
  className,
  ...rest
}: BoardProps) => {
  const titleId = useId();
  const bodyClass = [
    classes.body,
    flush && classes.flush,
    scroll && classes.scroll,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section
      className={[classes.root, dense && classes.dense, className]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby={titleId}
      {...rest}
    >
      <div className={classes.head}>
        <div className={classes.titleGroup}>
          <TitleTag id={titleId} className={classes.title}>
            {title}
          </TitleTag>
          {subtitle && <span className={classes.subtitle}>{subtitle}</span>}
        </div>
        {aside && <div className={classes.aside}>{aside}</div>}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
};
