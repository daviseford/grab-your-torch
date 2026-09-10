import { Button } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import type { CastawayId, PoolPick } from "../../types";
import { isPoolPickSelected, nextPoolSwapTarget } from "../../utils/poolPicks";
import { CastawayCard } from "../Layout";
import classes from "./PoolCastPicker.module.css";
import type { PoolCastDetail } from "./poolCastDetails";

/**
 * The pool cast picker.
 *
 * Deliberately NOT the draft cast grid. That component renders one owner per
 * castaway, desaturates the ones already taken, and is keyed off a one-owner
 * map. None of that has meaning here: picks are non-exclusive, any number of
 * entrants may hold the same castaway, and no castaway is ever unavailable
 * (R3). The list semantics and the narrow-width treatment are the only things
 * carried across.
 *
 * At the pick limit every unselected card stays fully enabled. Selecting one
 * replaces the earliest pick, and the swap is named on screen before it
 * happens and announced after. Greying the rest out would contradict R3 in
 * front of the entrant, and swallowing the tap would read as a broken page at
 * the moment they are deciding whether to finish.
 *
 * NO-TEST EXCEPTION: this repo has no React Testing Library and no `.test.tsx`
 * (only pure-function vitest), so keyboard operability and the 375px compact
 * layout are not covered by a unit test. Every decision this component makes
 * is in `src/utils/poolPicks.ts` and is tested there. The replacement
 * verification for the rendering itself is `yarn e2e:screenshot`, which
 * captures the route at desktop and phone widths; a later unit adds a
 * dedicated Playwright spec for the keyboard path.
 */
export type PoolCastPickerProps = {
  /** The cast, straight off the pool configuration document. */
  cast: readonly PoolPick[];
  /** Portraits and bios, joined from local season data. May be empty. */
  details: Map<CastawayId, PoolCastDetail>;
  picks: readonly PoolPick[];
  limit: number;
  seasonName: string;
  onToggle: (pick: PoolPick) => void;
  /** What just happened, for the live region. Owned by the page. */
  announcement?: string | null;
};

const castMeta = (detail: PoolCastDetail | undefined) => {
  if (!detail) return null;
  const { age, profession, hometown } = detail;
  if (!age && !profession && !hometown) return null;
  return (
    <>
      {age && <>{age}</>}
      {age && profession && " · "}
      {profession && <>{profession}</>}
      {(age || profession) && hometown && <br />}
      {hometown && <>{hometown}</>}
    </>
  );
};

export const PoolCastPicker = ({
  cast,
  details,
  picks,
  limit,
  seasonName,
  onToggle,
  announcement,
}: PoolCastPickerProps) => {
  // Two columns at 375px: square portraits keep the first row's control
  // inside the first screen, and the counter above stays in view.
  const compact = useMediaQuery("(max-width: 36em)") ?? false;
  const swapTarget = nextPoolSwapTarget(picks, limit);
  const remaining = limit - picks.length;

  const note =
    announcement ??
    (swapTarget
      ? `Your picks are set. Choosing another castaway replaces ${swapTarget.full_name}.`
      : remaining > 0
        ? `Choose ${remaining} more.`
        : null);

  return (
    <div className={classes.root}>
      <p className={classes.counter} role="status" aria-live="polite">
        <span
          className={[classes.count, remaining === 0 && classes.complete]
            .filter(Boolean)
            .join(" ")}
        >
          {picks.length} of {limit} picks chosen
        </span>
        {note && <span className={classes.countNote}>{note}</span>}
      </p>
      <ul className={classes.grid} aria-label={`${seasonName} cast`}>
        {cast.map((castaway) => {
          const detail = details.get(castaway.castaway_id);
          const picked = isPoolPickSelected(picks, castaway.castaway_id);
          return (
            <li key={castaway.castaway_id}>
              <CastawayCard
                name={castaway.full_name}
                img={detail?.img}
                meta={castMeta(detail)}
                picked={picked}
                compact={compact}
                actions={
                  // Every card stays enabled at the limit: nothing in a pool
                  // is ever unavailable (R3), and the swap is named above.
                  <Button
                    fullWidth
                    size="xs"
                    variant={picked ? "filled" : "default"}
                    aria-pressed={picked}
                    aria-label={
                      picked
                        ? `Remove ${castaway.full_name}`
                        : `Pick ${castaway.full_name}`
                    }
                    onClick={() => onToggle(castaway)}
                  >
                    {picked ? "Remove" : "Pick"}
                  </Button>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
};
