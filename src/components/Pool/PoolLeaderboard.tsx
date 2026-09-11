import { Button } from "@mantine/core";
import type { ReactNode } from "react";
import {
  describePoolStandingsAsOf,
  groupPoolStandingsRows,
  type PoolStandingsView,
} from "../../utils/poolStandingsRead";
import { EmptySlate } from "../Layout";
import classes from "./PoolLeaderboard.module.css";

/**
 * The public leaderboard (U8).
 *
 * Handles, totals and ranks. Nothing else (R17): no castaway, no elimination
 * state, no per-castaway breakdown. That bound is applied upstream by
 * `projectPoolStandingsRows`, which is why this component receives a
 * `PoolStandingsView` rather than raw documents. There is no prop through
 * which a castaway name could arrive.
 *
 * It renders one of exactly four things, and never invents a fifth:
 *
 *  - nothing at all, when `display_mode` hid the leaderboard, when the config
 *    read is still in flight, or when there is no pool. The caller owns the
 *    placeholder in the pending case, because only it knows the footprint;
 *  - an empty slate, when nothing is published yet or the published document
 *    is absent. Never a field of zeroes (KTD8): an absent document means the
 *    recompute has not run, not that everyone scored nothing;
 *  - the standings, with their as-of stamp;
 *  - the standings plus a note, when the stamp says they are behind.
 *
 * SHARED RANKS ARE THE ORDINARY CASE (KD4). Prop bets break ties and they
 * award points only when definitively correct, so most of the field shares
 * rank one in the first weeks. A column of identical numbers reads as a
 * rendering fault, so a run of tied entrants shows its position once and the
 * rest of the run is marked as tied, with the position still announced to a
 * screen reader on every row.
 *
 * NOT UNIT TESTED, deliberately: this repo has no React Testing Library and no
 * `.test.tsx` files. Everything it decides is a pure function tested in
 * `src/hooks/__tests__/usePoolStandings.test.ts`, and the rendered result is
 * verified by `yarn e2e --project=chromium-signed-out`.
 */
export type PoolLeaderboardProps = {
  view: PoolStandingsView;
  /** Ask for the full field. Omit on a surface that should stay compact. */
  onExpand?: () => void;
  /** True when there are overflow pages that are not on screen yet. */
  canExpand?: boolean;
  /** True while those pages are in flight. */
  isExpanding?: boolean;
  /** Five-row preview with tighter type and spacing for the homepage (KD6). */
  compact?: boolean;
  /** Overrides for the empty-state copy, so each caller can word its own. */
  emptyTitle?: string;
  emptyBody?: ReactNode;
};

const EMPTY_COPY: Record<
  "not-scored" | "absent",
  { title: string; body: string }
> = {
  "not-scored": {
    title: "Standings start after the first episode",
    body: "Nothing has been scored yet. Totals appear here once the first episode's data lands.",
  },
  absent: {
    title: "Standings are not published yet",
    body: "The latest update has not landed. Every entry is safe: totals appear here as soon as the next update runs.",
  },
};

export const PoolLeaderboard = ({
  view,
  onExpand,
  canExpand = false,
  isExpanding = false,
  compact = false,
  emptyTitle,
  emptyBody,
}: PoolLeaderboardProps) => {
  if (view.kind === "hidden" || view.kind === "pending") return null;

  if (view.kind === "empty") {
    // No pool at all is the caller's story to tell, not a leaderboard state.
    if (view.reason === "no-pool") return null;
    const copy = EMPTY_COPY[view.reason];
    return (
      <EmptySlate title={emptyTitle ?? copy.title}>
        {emptyBody ?? copy.body}
      </EmptySlate>
    );
  }

  const asOf = describePoolStandingsAsOf(view);
  const allGrouped = groupPoolStandingsRows(view.rows);
  const grouped = compact ? allGrouped.slice(0, 5) : allGrouped;
  const shown = grouped.length;
  const hidden = Math.max(view.totalRows - shown, 0);

  return (
    <section
      className={[classes.root, compact ? classes.compact : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={asOf.label}
    >
      <header className={classes.header}>
        <h3 className={classes.label}>{asOf.label}</h3>
        <p className={classes.count}>
          {shown < view.entryCount && `Showing ${shown} of `}
          {view.entryCount === 1 ? "1 entrant" : `${view.entryCount} entrants`}
        </p>
      </header>

      {asOf.note && (
        <p className={classes.note} role="status">
          {asOf.note}
        </p>
      )}

      <div className={classes.tableWrap}>
        <table className={classes.table}>
          <caption className={classes.caption}>
            {asOf.label}. Handles, total points and position.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={classes.rankCol}>
                Rank
              </th>
              <th scope="col">Handle</th>
              <th scope="col" className={classes.pointsCol}>
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(({ row, showRank, tiedCount }, index) => (
              <tr
                // Handles are not unique and rows carry no id, so position in
                // the published order is the only stable key there is. That
                // order is deterministic by construction (R14).
                key={`${index}-${row.handle}`}
                className={showRank ? classes.groupStart : classes.tiedRow}
              >
                <td className={classes.rankCol}>
                  {showRank ? (
                    <span className={classes.rank}>{row.rank}</span>
                  ) : (
                    <span className={classes.tiedMark} aria-hidden="true" />
                  )}
                  {tiedCount > 1 && (
                    <span className={classes.srOnly}>
                      {` Rank ${row.rank}, tied with ${tiedCount - 1} ${
                        tiedCount === 2 ? "other entrant" : "other entrants"
                      }.`}
                    </span>
                  )}
                </td>
                <td className={classes.handle}>{row.handle}</td>
                <td className={classes.pointsCol}>{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canExpand && onExpand && (
        <div className={classes.expand}>
          <Button
            type="button"
            size="xs"
            variant="default"
            disabled={isExpanding}
            onClick={onExpand}
          >
            {isExpanding
              ? "Loading..."
              : hidden > 0
                ? `Show all ${view.totalRows} entrants`
                : "Show every entrant"}
          </Button>
        </div>
      )}
    </section>
  );
};
