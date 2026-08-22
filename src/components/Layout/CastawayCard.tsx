import type { ReactNode } from "react";
import classes from "./CastawayCard.module.css";

type CastawayCardProps = {
  name: string;
  /** Portrait URL; an empty string renders the initials plate instead. */
  img?: string;
  /** One short line under the name: age and hometown, pick number, points. */
  meta?: ReactNode;
  /** Struck out: eliminated (or otherwise out of play). */
  out?: boolean;
  /** Selected or owned emphasis (a League Blue outline). */
  picked?: boolean;
  /** Small slate in the top-left corner of the portrait, e.g. "Pick 3". */
  tag?: ReactNode;
  /** Marker in the top-right corner, e.g. the via-trade mark. */
  marker?: ReactNode;
  /** Controls under the meta line (a Draft slate, a link). */
  actions?: ReactNode;
  /** Renders the portrait smaller for dense grids. */
  compact?: boolean;
  className?: string;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

/**
 * The castaway slate: portrait on top, name and one meta line below. State
 * is a mark, not a hue alone: out castaways are desaturated and struck with
 * an Ember diagonal; picked castaways carry a blue outline.
 */
export const CastawayCard = ({
  name,
  img,
  meta,
  out = false,
  picked = false,
  tag,
  marker,
  actions,
  compact = false,
  className,
}: CastawayCardProps) => {
  const rootClass = [
    classes.root,
    out && classes.out,
    picked && classes.picked,
    compact && classes.compact,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={rootClass}>
      <div className={classes.portrait}>
        {img ? (
          <img src={img} alt={name} loading="lazy" decoding="async" />
        ) : (
          <span className={classes.initials} aria-hidden="true">
            {initials(name)}
          </span>
        )}
        {tag && <span className={classes.tag}>{tag}</span>}
        {marker && <span className={classes.marker}>{marker}</span>}
      </div>
      <div className={classes.body}>
        <div className={classes.name}>{name}</div>
        {meta && <div className={classes.meta}>{meta}</div>}
        {actions && <div className={classes.actions}>{actions}</div>}
      </div>
    </article>
  );
};
