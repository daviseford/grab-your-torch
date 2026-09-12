import { useMemo, type ReactNode } from "react";
import type { Player } from "../../types";
import { CastawayCard } from "./CastawayCard";
import classes from "./CastGallery.module.css";

/** Age and hometown on one line, profession on the next, where present. */
const castawayMeta = (player: Player): ReactNode => {
  const line = [player.age, player.hometown].filter(Boolean).join(" · ");
  if (!line && !player.profession) return undefined;
  return (
    <>
      {line && <span>{line}</span>}
      {line && player.profession && <br />}
      {player.profession && <span>{player.profession}</span>}
    </>
  );
};

type CastGalleryProps = {
  /** The cast to show, already in the order the page wants it. */
  cast: readonly Player[];
};

/**
 * The cast as a dense read-only gallery: portraits open the photo viewer,
 * which browses the whole cast from there. For pages that need to show who
 * is in the season without offering anything to do with them.
 */
export const CastGallery = ({ cast }: CastGalleryProps) => {
  const photoGallery = useMemo(
    () =>
      cast.flatMap((player) =>
        player.img
          ? [
              {
                id: player.castaway_id,
                name: player.full_name,
                img: player.img,
                meta: castawayMeta(player),
              },
            ]
          : [],
      ),
    [cast],
  );

  return (
    <ul className={classes.grid}>
      {cast.map((player) => (
        <li key={player.castaway_id}>
          <CastawayCard
            name={player.full_name}
            img={player.img}
            meta={castawayMeta(player)}
            compact
            photoGallery={photoGallery}
          />
        </li>
      ))}
    </ul>
  );
};
