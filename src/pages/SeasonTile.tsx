import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../components/Layout";
import type { SeasonMeta } from "../data/season-metadata";
import { getSeasonArt, getSeasonDisplayTitle } from "./SeasonEras";
import classes from "./SeasonTile.module.css";

type SeasonTileProps = {
  meta: SeasonMeta;
  /** The season airing now: a live slate replaces the number marker. */
  live?: boolean;
  /** Large cell for the on-air slot. */
  size?: "md" | "lg";
  /** One line under the name; defaults to location and year. */
  metaLine?: ReactNode;
  /** Badges on the right of the body (large cells only). */
  badges?: ReactNode;
};

/**
 * The program-guide cell: a season logo on a navy art plate, the name and
 * one meta line below. A missing or broken logo prints as a numbered plate
 * rather than a broken image.
 */
export const SeasonTile = ({
  meta,
  live = false,
  size = "md",
  metaLine,
  badges,
}: SeasonTileProps) => {
  const [failed, setFailed] = useState(false);
  const art = getSeasonArt(meta);
  const showArt = Boolean(art) && !failed;
  const rootClass = [classes.root, size === "lg" && classes.lg]
    .filter(Boolean)
    .join(" ");

  return (
    <Link to={`/seasons/${meta.id}`} className={rootClass}>
      <div className={classes.art}>
        {live ? (
          <StatusBadge kind="live" className={classes.corner} />
        ) : (
          <span className={classes.plateNum} aria-hidden="true">
            S{meta.order}
          </span>
        )}
        {showArt ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className={classes.fallback} aria-hidden="true">
            <b>{meta.order}</b>
            {meta.subtitle && <small>{meta.subtitle}</small>}
          </span>
        )}
      </div>
      <div className={classes.body}>
        <span className={classes.name}>{getSeasonDisplayTitle(meta)}</span>
        <span className={classes.meta}>
          {metaLine ?? (
            <>
              {meta.location} &middot; {meta.year}
            </>
          )}
        </span>
        {badges && <span className={classes.badges}>{badges}</span>}
      </div>
    </Link>
  );
};
