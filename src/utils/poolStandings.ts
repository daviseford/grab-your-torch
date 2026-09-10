import {
  PoolStandings,
  PoolStandingsPage,
  PoolStandingsRow,
  PoolStandingsStamp,
} from "../types";

/**
 * How the published leaderboard is split across documents.
 *
 * The summary document is the one a signed-out homepage visit reads, so it
 * holds a fixed number of rows and stays roughly constant on the wire
 * whatever the entrant count. Reads are not the binding constraint here,
 * egress is: at 1,000 entrants an unpaginated document is roughly 200 KB a
 * visit, and a traffic spike would spend a month's Spark egress in a day.
 *
 * At the 24-character handle cap a row is about 120 bytes, so an unpaginated
 * document would pass the 1 MiB limit near 7,100 entrants. Overflow rows live
 * in `pages/{n}` and are fetched only when a visitor expands the leaderboard.
 */
export const POOL_STANDINGS_SUMMARY_ROWS = 50;
export const POOL_STANDINGS_PAGE_ROWS = 500;

/**
 * Split already-ranked rows into the documents that get published.
 *
 * Rows arrive in final published order: the caller has already ranked them,
 * broken ties on prop bet points, and applied the deterministic uid tie-break
 * before dropping the uid. No uid reaches either document -- standings are
 * world-readable and no collection in this project publishes Firebase uids to
 * signed-out readers.
 */
export function buildPoolStandingsDocuments(
  rows: readonly PoolStandingsRow[],
  stamp: PoolStandingsStamp,
): { summary: PoolStandings; pages: PoolStandingsPage[] } {
  const pages: PoolStandingsPage[] = [];

  if (rows.length > POOL_STANDINGS_SUMMARY_ROWS) {
    for (
      let start = 0;
      start < rows.length;
      start += POOL_STANDINGS_PAGE_ROWS
    ) {
      pages.push({
        ...stamp,
        page: pages.length,
        rows: rows.slice(start, start + POOL_STANDINGS_PAGE_ROWS),
      });
    }
  }

  return {
    summary: {
      ...stamp,
      entry_count: rows.length,
      rows: rows.slice(0, POOL_STANDINGS_SUMMARY_ROWS),
      page_count: pages.length,
    },
    pages,
  };
}
