import { Button } from "@mantine/core";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePool, usePoolCounters } from "../../hooks/usePool";
import { usePoolStandings } from "../../hooks/usePoolStandings";
import { seasonIdForNum } from "../../utils/poolIds";
import {
  describePoolModule,
  getPoolModuleState,
  type PoolModuleState,
} from "../../utils/poolModuleState";
// Imported from the module rather than from `../Pool`, deliberately. The
// barrel re-exports `poolCastDetails`, which imports `src/data/season_51` for
// the entry page's cast; pulling the barrel in here would put a season module
// in the homepage's import closure and fail the transitive boundary rule in
// `src/utils/__tests__/importBoundaries.test.ts` (R22, and megabytes in the
// entry chunk). The leaderboard itself imports nothing but pure helpers.
import { PoolLeaderboard } from "../Pool/PoolLeaderboard";
import classes from "./HomePool.module.css";

/**
 * The homepage pool module (U9).
 *
 * WHICH SEASON. One, named here as a constant. Rolling the module from one
 * season's pool to the next is explicitly deferred to follow-up work by the
 * plan, and the obvious shortcut is worse than the constant: deriving "the
 * upcoming season" from `SEASON_METADATA` would work until the premiere and
 * then silently remove the module on exactly the day KD6 says it should demote
 * to a leaderboard, because the season stops being upcoming at that moment.
 * A constant is edited once per season, by hand, with intent.
 *
 * WHAT IT READS. Three documents: the pool config, its counters, and the
 * published standings summary. No season document (R22), no `events`,
 * `challenges` or `eliminations`, and no cast: the open state renders from the
 * config's roster length and the cast itself lives at `/pool/:seasonId`. This
 * is the plan's headline claim and the reason for the `chromium-signed-out`
 * Playwright project, which asserts it on real request traffic rather than on
 * the promise in this comment.
 *
 * WHERE IT SITS. In the hero, next to the product identity and the start path
 * rather than stacked above them (KD6): dominant while entry is open, and a
 * compact leaderboard once the pool freezes. It never offers to expand to the
 * full field, so the payload on the highest-traffic public page in the product
 * stays constant in the entrant count; the full field is one link away.
 *
 * NOT UNIT TESTED, in line with the rest of this repo. Every decision and
 * every string is a pure function in `src/utils/poolModuleState.ts`, tested
 * beside it; what remains here is markup.
 */

/** The one pool the homepage shows. See "WHICH SEASON" above. */
const HOME_POOL_SEASON_NUM = 51;
const HOME_POOL_SEASON_ID = seasonIdForNum(HOME_POOL_SEASON_NUM);

/**
 * How often the clock is re-read, matching `src/pages/Pool.tsx`. The module
 * changes state at the freeze instant, and a homepage left open across it
 * should stop offering entry without waiting for a navigation. Nothing here is
 * a security boundary: the rules are (KTD4).
 */
const FREEZE_TICK_MS = 30_000;

export type HomePoolProps = {
  /**
   * Rendered in the module's place when there is no pool, or when the
   * `display_mode` lever has hidden it. The homepage passes its brand emblem,
   * so the hero looks exactly as it did before this module existed.
   */
  fallback?: ReactNode;
};

/** The freeze instant in the visitor's own timezone, named (KTD9, R11). */
const formatFreeze = (freezeAtMs: number): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(freezeAtMs));
  } catch {
    return new Date(freezeAtMs).toISOString();
  }
};

const EYEBROW: Record<
  Exclude<PoolModuleState["kind"], "pending" | "hidden" | "no-pool">,
  string
> = {
  open: "Season pool",
  frozen: "Season pool",
  "aired-unscored": "Season pool",
  "mid-season": "Season pool standings",
  complete: "Season pool standings",
};

export const HomePool = ({ fallback }: HomePoolProps) => {
  const { poolId, data: pool, isLoaded } = usePool(HOME_POOL_SEASON_ID);
  const { data: counters } = usePoolCounters(poolId);
  // No `dataRevision`: supplying one would mean reading a season document,
  // which is exactly what R22 forbids here. See the header of
  // `src/utils/poolStandingsRead.ts`.
  const { view } = usePoolStandings({ pool, isPoolLoaded: isLoaded });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FREEZE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const state = getPoolModuleState({
    pool,
    poolLoaded: isLoaded,
    counters,
    standings: view,
    displayMode: pool?.display_mode,
    now,
  });

  if (state.kind === "pending") {
    // A fixed-height stand-in occupying the open state's footprint. Without it
    // the dominant element pops in on every cold load and pushes the product
    // identity and the start path down the page as it arrives.
    return (
      <div
        className={`${classes.card} ${classes.dominant} ${classes.placeholder}`}
        aria-hidden="true"
      >
        <span className={classes.ghostEyebrow} />
        <span className={classes.ghostTitle} />
        <span className={classes.ghostLine} />
        <span className={classes.ghostLineShort} />
        <span className={classes.ghostAction} />
      </div>
    );
  }

  if (state.kind === "no-pool" || state.kind === "hidden") {
    return <>{fallback}</>;
  }

  const copy = describePoolModule(state);
  if (!copy) return <>{fallback}</>;

  return (
    <section
      aria-labelledby="home-pool-title"
      className={`${classes.card} ${copy.dominant ? classes.dominant : classes.compact}`}
    >
      <p className={classes.eyebrow}>{EYEBROW[state.kind]}</p>
      <h2 id="home-pool-title" className={classes.title}>
        {copy.headline}
      </h2>
      <p className={classes.support}>{copy.support}</p>

      {state.kind === "open" && (
        <p className={classes.deadline}>
          Entries close {formatFreeze(state.facts.freezeAtMs)}.
        </p>
      )}

      {/*
        The action comes before the explanatory note while entry is open and
        after the standings once they exist: the thing to do next is entering
        in the first case and reading the field in the second, and the button
        follows whichever that is.
      */}
      {copy.standings.kind !== "none" && (
        <div className={classes.standings}>
          {/* No expand affordance on purpose: the summary document is constant
              in size whatever the entrant count, and the full field is a link
              away rather than an extra fetch on the busiest public page. */}
          <PoolLeaderboard
            view={view}
            compact
            emptyTitle={
              copy.standings.kind === "awaiting"
                ? copy.standings.title
                : undefined
            }
            emptyBody={
              copy.standings.kind === "awaiting"
                ? copy.standings.body
                : undefined
            }
          />
        </div>
      )}

      <div className={classes.action}>
        <Button
          component={Link}
          to={copy.action.to}
          size={copy.dominant ? "lg" : "sm"}
          variant={copy.dominant ? "filled" : "outline"}
          // The torch, not the league blue. The hero already carries a filled
          // primary button, and two of them in one viewport would leave R20's
          // "dominant element" as a claim rather than something a visitor can
          // see. The open state's action is the one thing on this page that
          // takes a person from arriving to playing, so it gets the brand
          // accent and the hero's own button size; every later state drops to
          // an outline, because by then the leaderboard is the point.
          color={copy.dominant ? "ember" : undefined}
        >
          {copy.action.label}
        </Button>
      </div>

      {copy.standings.kind === "none" && (
        <p className={classes.note}>{copy.standings.note}</p>
      )}
    </section>
  );
};
