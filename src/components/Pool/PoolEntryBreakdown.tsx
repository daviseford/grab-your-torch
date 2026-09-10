import {
  poolEntryEpisodeTotals,
  type PoolEntryScores,
} from "../../utils/poolEntryScoring";
import { EmptySlate } from "../Layout";
import classes from "./PoolEntryBreakdown.module.css";

/**
 * The entrant's own picks, week by week (U16, R26).
 *
 * PRIVATE BY CONSTRUCTION
 * -----------------------
 * This renders castaway names, exit weeks and per-castaway points, every one
 * of which R17 forbids on a PUBLIC pool surface. R26 puts the entrant's own
 * entry outside that bound because only they can see it, and R25 warns that
 * anything later added to a public surface inherits R17. So: this component
 * belongs on the entrant's own entry and nowhere else. It must never be
 * mounted on the leaderboard, the homepage module, or any other surface a
 * non-owner can reach. The owner decision is made upstream by
 * `resolvePoolEntryBreakdownAccess`, and the data cannot arrive here at all
 * for a non-owner because rules deny reading another entrant's entry.
 *
 * NO SPOILER BOUNDARY (KD7). Every competition surface in this codebase
 * filters against the competition's `current_episode`. This one does not: a
 * pool entrant is watching the season live, so the newest scored episode is
 * the right answer here and only here.
 *
 * IT REUSES THE POOL'S OWN PRESENTATION, not the competition scoring tables.
 * Those assume a castaway has exactly one owner and speak in draft vocabulary,
 * which the pool retired: picks are non-exclusive and any number of entrants
 * can hold the same castaway (KTD10, U10).
 *
 * NOT UNIT TESTED, deliberately: this repo has no React Testing Library and no
 * `.test.tsx` files. Everything it decides is a pure function tested in
 * `src/hooks/__tests__/usePoolEntryScores.test.ts`, including the agreement
 * with the published leaderboard total; the rendered result is verified by
 * `yarn e2e`.
 */

export type PoolEntryBreakdownProps = {
  scores: PoolEntryScores | undefined;
  /** True while the season read is still in flight. */
  isLoading?: boolean;
};

/** Whole points read as integers; halves keep their one decimal place. */
const formatPoints = (points: number): string =>
  Number.isInteger(points) ? String(points) : points.toFixed(1);

export const PoolEntryBreakdown = ({
  scores,
  isLoading = false,
}: PoolEntryBreakdownProps) => {
  if (isLoading || !scores) return null;

  if (scores.kind === "awaiting-data") {
    // Season 51's normal state today: no season document, no episodes, no
    // results. Scoring has not started, which is a different thing from
    // everyone having scored nothing, so this is never a table of zeros.
    return (
      <EmptySlate title="Scoring starts after the first episode">
        Your picks are locked in. Points appear here week by week once the
        premiere airs and its results land.
      </EmptySlate>
    );
  }

  const episodeTotals = poolEntryEpisodeTotals(scores);
  const lastEpisode = scores.episodes[scores.episodes.length - 1];

  return (
    <div className={classes.root}>
      <header className={classes.header}>
        <h3 className={classes.label}>
          Your points through episode {lastEpisode.order}
        </h3>
        <p className={classes.total}>
          {formatPoints(scores.total)}{" "}
          <span className={classes.totalUnit}>points</span>
        </p>
      </header>

      <div className={classes.tableWrap}>
        <table className={classes.table}>
          <caption className={classes.caption}>
            Your picks and the points each earned, episode by episode, through
            episode {lastEpisode.order}.
          </caption>
          <thead>
            <tr>
              <th scope="col" className={classes.pickCol}>
                Pick
              </th>
              {scores.episodes.map((episode) => (
                <th
                  key={episode.id}
                  scope="col"
                  className={classes.episodeCol}
                  title={episode.name}
                >
                  <span aria-hidden="true">{episode.order}</span>
                  <span className={classes.srOnly}>
                    Episode {episode.order}
                  </span>
                </th>
              ))}
              <th scope="col" className={classes.totalCol}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {scores.picks.map((pick) => (
              <tr key={pick.castaway_id}>
                <th scope="row" className={classes.pick}>
                  <span className={classes.name}>{pick.full_name}</span>
                  {pick.out_episode_num !== null && (
                    <span className={classes.out}>
                      Out in episode {pick.out_episode_num}
                    </span>
                  )}
                </th>
                {pick.per_episode.map((points, index) => (
                  <td
                    key={scores.episodes[index].id}
                    className={
                      points === 0
                        ? `${classes.points} ${classes.zero}`
                        : classes.points
                    }
                  >
                    {points === 0 ? (
                      <>
                        <span aria-hidden="true">&ndash;</span>
                        <span className={classes.srOnly}>0 points</span>
                      </>
                    ) : (
                      formatPoints(points)
                    )}
                  </td>
                ))}
                <td className={classes.pickTotal}>
                  {formatPoints(pick.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className={classes.pick}>
                Weekly total
              </th>
              {episodeTotals.map((points, index) => (
                <td key={scores.episodes[index].id} className={classes.points}>
                  {formatPoints(points)}
                </td>
              ))}
              <td className={classes.pickTotal}>
                {formatPoints(scores.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className={classes.note}>
        This is yours alone. The public leaderboard shows handles, totals and
        positions only.
      </p>
    </div>
  );
};
