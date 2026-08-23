import { Table } from "@mantine/core";
import { useMemo } from "react";
import { useCompetition } from "../../hooks/useCompetition";
import { useSeason } from "../../hooks/useSeason";
import { RosterStat, SeasonStatsResult } from "../../utils/seasonStats";
import { Board } from "../Layout";
import { SeasonStatsCard } from "./SeasonStatsCard";
import classes from "./SeasonStatsSection.module.css";

function getCellClass(
  value: number,
  best: number,
  worst: number,
  direction: "high" | "low",
): string | undefined {
  if (best === worst) return undefined;
  const isBest = direction === "high" ? value === best : value === worst;
  const isWorst = direction === "high" ? value === worst : value === best;
  if (isBest) return classes.cellBest;
  if (isWorst) return classes.cellWorst;
  return undefined;
}

function getRank(index: number): string {
  const n = index + 1;
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

const RosterStatRow = ({
  stat,
  showRank,
}: {
  stat: RosterStat;
  showRank: boolean;
}) => {
  const values = stat.rows.map((r) => r.value);
  const best = Math.max(...values);
  const worst = Math.min(...values);

  // Compute rank from value (sorted descending for "high", ascending for "low")
  const sorted = [...values].sort((a, b) =>
    stat.direction === "high" ? b - a : a - b,
  );
  const rankByValue = (v: number) => sorted.indexOf(v) + 1;

  return (
    <Table.Tr>
      <Table.Td className={classes.rosterLabel}>
        <div className={classes.rosterTitle}>{stat.title}</div>
        <div className={classes.rosterDescription}>{stat.description}</div>
      </Table.Td>
      {stat.rows.map((row) => {
        const mark = getCellClass(row.value, best, worst, stat.direction);
        const rank = showRank ? getRank(rankByValue(row.value) - 1) : null;
        return (
          <Table.Td key={row.uid} className={`${classes.cell} ${mark ?? ""}`}>
            {rank && <div className={classes.rank}>{rank}</div>}
            <div className={classes.cellValue}>
              {row.value} <span>{stat.unit}</span>
            </div>
            {row.detail && (
              <div className={classes.cellDetail}>{row.detail}</div>
            )}
          </Table.Td>
        );
      })}
    </Table.Tr>
  );
};

export const SeasonStatsSection = ({ stats }: { stats: SeasonStatsResult }) => {
  const { data: competition } = useCompetition();
  const { data: season } = useSeason(competition?.season_id);

  const portraits = useMemo(
    () =>
      Object.fromEntries(
        (season?.players ?? []).map((p) => [p.castaway_id, p.img]),
      ) as Record<string, string | undefined>,
    [season?.players],
  );

  const hasCastaway = stats.castawayCards.length > 0;
  const hasRoster = stats.rosterStats.length > 0;

  if (!hasCastaway && !hasRoster) return null;

  const participants = hasRoster ? stats.rosterStats[0].rows : [];
  const showRank = participants.length > 2;

  return (
    <div className={classes.root}>
      {hasCastaway && (
        <div>
          <h4 className={classes.groupLabel}>Castaway Stats</h4>
          <div className={classes.grid}>
            {stats.castawayCards.map((card) => (
              <SeasonStatsCard
                key={card.key}
                card={card}
                portraits={portraits}
              />
            ))}
          </div>
        </div>
      )}
      {hasRoster && (
        <Board title="Roster Stats" titleAs="h4" dense flush>
          <Table.ScrollContainer minWidth={500}>
            <Table verticalSpacing="xs" horizontalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Stat</Table.Th>
                  {participants.map((p) => (
                    <Table.Th key={p.uid} scope="col" ta="center">
                      {p.label}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {stats.rosterStats.map((stat) => (
                  <RosterStatRow
                    key={stat.key}
                    stat={stat}
                    showRank={showRank}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Board>
      )}
    </div>
  );
};
