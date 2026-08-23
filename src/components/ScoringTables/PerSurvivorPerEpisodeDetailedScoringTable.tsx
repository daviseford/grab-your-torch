import { Badge, Select, Table, Tooltip, UnstyledButton } from "@mantine/core";
import {
  IconArrowRight,
  IconArrowsExchange,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { BASE_PLAYER_SCORING, ScoringCategory } from "../../data/scoring";
import { useCompetition } from "../../hooks/useCompetition";
import { useCompetitionMeta } from "../../hooks/useCompetitionMeta";
import { useDragScroll } from "../../hooks/useDragScroll";
import { useScoringCalculations } from "../../hooks/useScoringCalculations";
import { useSeason } from "../../hooks/useSeason";
import { useUser } from "../../hooks/useUser";
import { CastawayId, PlayerAction } from "../../types";
import { getNumberWithOrdinal, getParticipantName } from "../../utils/misc";
import {
  getAcquisitionLabel,
  getUpcomingMoveLabel,
} from "../../utils/tradeUtils";
import { Board } from "../Layout";
import { PlayerHoverCard } from "./PlayerHoverCard";
import classes from "./ScoringTables.module.css";

type SortField = "rank" | "player" | "total" | "draft";
type SortDir = "asc" | "desc";

// Rank, castaway, total, and pick stay pinned while the episode columns
// scroll beneath them (desktop only). Offsets are the summed fixed widths.
const STICKY_OFFSETS = { rank: 0, player: 56, total: 256, pick: 324 } as const;

// Scoring category colors stay semantic (the same five as the scoring
// reference and the homepage): Challenges blue, Milestones teal, Idols
// yellow, Advantages grape, Other gray.
const CATEGORY_COLORS: Record<ScoringCategory, string> = {
  Challenges: "blue",
  Milestones: "teal",
  Idols: "yellow",
  Advantages: "grape",
  Other: "gray",
};
const CATEGORY_ORDER: ScoringCategory[] = [
  "Challenges",
  "Milestones",
  "Idols",
  "Advantages",
  "Other",
];

const categoryByAction = BASE_PLAYER_SCORING.reduce(
  (accum, entry) => {
    accum[entry.action] = entry.category;
    return accum;
  },
  {} as Partial<Record<PlayerAction, ScoringCategory>>,
);

const getBadgeColor = (action: PlayerAction) =>
  CATEGORY_COLORS[categoryByAction[action] ?? "Other"];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

const SortableHeader = ({
  label,
  field,
  sortField,
  sortDir,
  onSort,
  className,
  style,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
  style?: React.CSSProperties;
}) => {
  const isActive = sortField === field;
  const Icon = isActive && sortDir === "desc" ? IconChevronDown : IconChevronUp;
  const ariaSortValue = isActive
    ? sortDir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <Table.Th
      scope="col"
      aria-sort={ariaSortValue}
      className={className}
      style={style}
    >
      <UnstyledButton
        onClick={() => onSort(field)}
        className={classes.sortButton}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {isActive && <Icon size={12} />}
      </UnstyledButton>
    </Table.Th>
  );
};

/**
 * The Player Scores board: every drafted castaway with their points per
 * revealed episode as category-colored event slates. Episode columns run only
 * through the competition's current episode.
 */
export const PerSurvivorPerEpisodeDetailedScoringTable = () => {
  const { data: competition } = useCompetition();
  const { data: season } = useSeason(competition?.season_id);
  const { slimUser } = useUser();

  const {
    filteredChallenges,
    filteredEpisodes,
    filteredEliminations: eliminations,
    filteredEvents: events,
    survivorPointsByEpisode,
    survivorPointsTotalSeason,
  } = useScoringCalculations();

  const challengesArray = useMemo(
    () => Object.values(filteredChallenges),
    [filteredChallenges],
  );

  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // SingleCompetition stays mounted when the route's competition id changes,
  // so plain state would carry one competition's roster filter (a uid that may
  // name the same user elsewhere) into the next and silently filter its table.
  // Key the filter to the competition, like TradesSection's historyVisibility.
  const [rosterFilter, setRosterFilter] = useState<{
    competitionId: string | undefined;
    uid: string | null;
  }>({ competitionId: undefined, uid: null });
  const filterUserUid =
    rosterFilter.competitionId === competition?.id ? rosterFilter.uid : null;
  const handleFilterChange = (uid: string | null) =>
    setRosterFilter({ competitionId: competition?.id, uid });

  // Two different questions get asked of ownership in this table, and after a
  // trade they have different answers: "who drafted this castaway" (the Pick
  // column and the draft-order sort, which stay on draft_picks because draft
  // history does not change) and "whose roster is this on" (the caption under
  // each name, the participant filter, and the my-roster highlight). Ownership
  // here is as of the episode the competition is on -- an accepted trade whose
  // cutoff has not been revealed keeps the previous owner in the caption, with
  // an arrow flagging where the castaway goes next episode.
  const { displayOwners, acquisitions, upcomingMoves } = useCompetitionMeta();

  const userFilterOptions = useMemo(
    () =>
      (competition?.participants ?? []).map((p) => ({
        value: p.uid,
        label:
          competition?.team_names?.[p.uid] || p.displayName || p.email || p.uid,
      })),
    [competition?.participants, competition?.team_names],
  );

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "total" ? "desc" : "asc");
    }
  };

  // Build a sortable array from the scoring data
  const entries = useMemo(() => {
    return Object.entries(survivorPointsByEpisode)
      .map(([castawayId, episodeScores]) => {
        const total = survivorPointsTotalSeason[castawayId] ?? 0;
        const draftPick = competition?.draft_picks.find(
          (x) => x.castaway_id === castawayId,
        );
        const displayName =
          season?.castawayLookup[castawayId as CastawayId]?.full_name ??
          castawayId;
        return {
          castawayId: castawayId as CastawayId,
          displayName,
          episodeScores,
          total,
          draftOrder: draftPick?.order ?? 999,
        };
      })
      .sort((a, b) => b.total - a.total) // default rank order
      .map((entry, i) => ({ ...entry, defaultRank: i + 1 }));
  }, [
    survivorPointsByEpisode,
    survivorPointsTotalSeason,
    competition?.draft_picks,
    season?.castawayLookup,
  ]);

  const sorted = useMemo(() => {
    const compareFn = (
      a: (typeof entries)[number],
      b: (typeof entries)[number],
    ) => {
      let cmp = 0;
      switch (sortField) {
        case "rank":
          cmp = a.defaultRank - b.defaultRank;
          break;
        case "player":
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case "total":
          cmp = b.total - a.total; // higher total = better rank
          break;
        case "draft":
          cmp = a.draftOrder - b.draftOrder;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    };
    return entries.slice().sort(compareFn);
  }, [entries, sortField, sortDir]);

  const visibleEntries = useMemo(() => {
    if (!filterUserUid) return sorted;
    return sorted.filter(
      (entry) => displayOwners[entry.castawayId] === filterUserUid,
    );
  }, [sorted, filterUserUid, displayOwners]);

  const scoringDescriptionLookup = useMemo(
    () =>
      BASE_PLAYER_SCORING.reduce(
        (accum, score) => {
          accum[score.action] = score.description;
          return accum;
        },
        {} as Record<PlayerAction, string>,
      ),
    [],
  );

  const rows = visibleEntries.map((entry) => {
    const {
      castawayId,
      displayName,
      episodeScores,
      total,
      defaultRank,
      draftOrder,
    } = entry;
    const playerData = season?.players.find(
      (x) => x.castaway_id === castawayId,
    );

    const participants = competition?.participants ?? [];
    const teamNames = competition?.team_names;
    const ownerUid = displayOwners[castawayId];
    const ownedBy = ownerUid
      ? getParticipantName(participants, ownerUid, teamNames)
      : null;

    const upcomingMove = upcomingMoves[castawayId];
    const upcomingLabel = upcomingMove
      ? getUpcomingMoveLabel(upcomingMove, participants, teamNames)
      : null;

    const acquisition = acquisitions[castawayId];
    const acquisitionLabel = acquisition
      ? getAcquisitionLabel(
          acquisition,
          competition?.draft_picks.find((x) => x.castaway_id === castawayId)
            ?.user_uid,
          participants,
          teamNames,
        )
      : null;

    const playerElimination = Object.values(eliminations).find(
      (x) => x.castaway_id === castawayId,
    );

    const eliminationLabel = playerElimination
      ? playerElimination.variant === "medical"
        ? "Evacuated"
        : playerElimination.variant === "quitter"
          ? "Quit"
          : playerElimination.variant === "ejected"
            ? "Ejected"
            : `Out ${getNumberWithOrdinal(playerElimination.order)}`
      : null;

    const isNonVotedOut =
      playerElimination &&
      (playerElimination.variant === "medical" ||
        playerElimination.variant === "quitter" ||
        playerElimination.variant === "ejected");

    const isWinner = Object.values(events).some(
      (x) => x.castaway_id === castawayId && x.action === "win_survivor",
    );

    const isOwnedByCurrentUser =
      !!slimUser?.uid && displayOwners[castawayId] === slimUser.uid;

    const rowClass = [
      classes.row,
      isOwnedByCurrentUser && classes.rowMe,
      playerElimination && !isWinner && classes.rowOut,
    ]
      .filter(Boolean)
      .join(" ");

    const portrait = playerData?.img ? (
      <img
        src={playerData.img}
        alt=""
        width={26}
        height={32}
        loading="lazy"
        decoding="async"
        className={`${classes.face} ${playerElimination ? classes.faceOut : ""}`}
      />
    ) : (
      <span className={classes.facePlaceholder} aria-hidden="true">
        {initials(displayName)}
      </span>
    );

    return (
      <Table.Tr key={castawayId} className={rowClass}>
        <Table.Td
          className={`${classes.stickyCell} ${classes.colRankWide}`}
          style={{ left: STICKY_OFFSETS.rank }}
        >
          <span className={classes.rankPlain}>{defaultRank}</span>
        </Table.Td>
        <Table.Td
          className={`${classes.stickyCell} ${classes.colCastaway}`}
          style={{ left: STICKY_OFFSETS.player }}
        >
          <div className={classes.who}>
            <PlayerHoverCard
              playerData={playerData}
              castawayId={castawayId}
              total={total}
              episodeScores={episodeScores}
              challenges={challengesArray}
              eliminationLabel={eliminationLabel}
              isNonVotedOut={!!isNonVotedOut}
            >
              {portrait}
            </PlayerHoverCard>
            <div className={classes.whoText}>
              <div
                className={`${classes.name} ${playerElimination && !isWinner ? classes.struck : ""}`}
                title={displayName}
              >
                {displayName}
              </div>
              {(ownedBy || playerElimination || isWinner) && (
                <div className={classes.caption}>
                  {ownedBy ?? ""}
                  {acquisitionLabel && (
                    <Tooltip label={acquisitionLabel}>
                      <span
                        className={classes.tradeMark}
                        role="img"
                        aria-label={acquisitionLabel}
                      >
                        <IconArrowsExchange size={9} stroke={2.5} />
                      </span>
                    </Tooltip>
                  )}
                  {upcomingLabel && (
                    <Tooltip label={upcomingLabel}>
                      <IconArrowRight
                        size={12}
                        role="img"
                        aria-label={upcomingLabel}
                        className={classes.moveMark}
                      />
                    </Tooltip>
                  )}
                  {isWinner && (
                    <span className={classes.winnerTag}>Sole Survivor</span>
                  )}
                  {ownedBy && playerElimination && !isWinner && " · "}
                  {eliminationLabel && !isWinner && (
                    <span
                      style={
                        isNonVotedOut
                          ? {
                              color: "var(--mantine-color-red-6)",
                              fontWeight: 600,
                            }
                          : undefined
                      }
                    >
                      {eliminationLabel}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </Table.Td>

        <Table.Td
          className={`${classes.stickyCell} ${classes.colTotal}`}
          style={{ left: STICKY_OFFSETS.total }}
        >
          <span className={`${classes.num} ${total === 0 ? classes.zero : ""}`}>
            {total}
          </span>
        </Table.Td>

        <Table.Td
          className={`${classes.stickyCell} ${classes.stickyDivider} ${classes.colPick}`}
          style={{ left: STICKY_OFFSETS.pick }}
        >
          <span className={`${classes.num} ${classes.zero}`}>
            {draftOrder === 999 ? "—" : getNumberWithOrdinal(draftOrder)}
          </span>
        </Table.Td>

        {episodeScores.map((s, idx) => (
          <Table.Td key={idx} className={classes.colEvents}>
            {s.actions.length > 0 && (
              <div className={classes.events}>
                {s.actions.map((x, actionIdx) => (
                  <Tooltip
                    label={scoringDescriptionLookup[x.action]}
                    key={actionIdx}
                  >
                    <Badge
                      size="xs"
                      variant="filled"
                      color={getBadgeColor(x.action)}
                      className={classes.eventBadge}
                    >
                      {x.action.replace(/_/g, " ")} +{x.points_awarded}
                    </Badge>
                  </Tooltip>
                ))}
              </div>
            )}
          </Table.Td>
        ))}
      </Table.Tr>
    );
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  useDragScroll(scrollRef);

  return (
    <Board
      title="Player Scores"
      subtitle="Per castaway, per episode"
      aside={
        userFilterOptions.length > 0 ? (
          <Select
            size="xs"
            w={180}
            placeholder="All rosters"
            data={userFilterOptions}
            value={filterUserUid}
            onChange={handleFilterChange}
            clearable
            allowDeselect
            aria-label="Filter players by roster owner"
          />
        ) : undefined
      }
      dense
      flush
    >
      <div className={classes.legend}>
        {CATEGORY_ORDER.map((category) => (
          <Badge
            key={category}
            size="xs"
            variant="filled"
            color={CATEGORY_COLORS[category]}
          >
            {category}
          </Badge>
        ))}
        <span className={classes.legendMark}>
          <span className={classes.struck}>Eliminated</span>
        </span>
        <span className={classes.legendMark}>
          <span className={classes.winnerTag}>Sole Survivor</span>
        </span>
      </div>
      <Table.ScrollContainer
        minWidth={356 + filteredEpisodes.length * 150}
        ref={scrollRef}
      >
        <Table
          highlightOnHover
          verticalSpacing="xs"
          horizontalSpacing="sm"
          className={classes.table}
        >
          <Table.Thead>
            <Table.Tr>
              <SortableHeader
                label="Rank"
                field="rank"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className={`${classes.stickyHeaderCell} ${classes.colRankWide}`}
                style={{ left: STICKY_OFFSETS.rank }}
              />
              <SortableHeader
                label="Castaway"
                field="player"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className={`${classes.stickyHeaderCell} ${classes.colCastaway}`}
                style={{ left: STICKY_OFFSETS.player }}
              />
              <SortableHeader
                label="Total"
                field="total"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className={`${classes.stickyHeaderCell} ${classes.colTotal}`}
                style={{ left: STICKY_OFFSETS.total }}
              />
              <SortableHeader
                label="Pick"
                field="draft"
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                className={`${classes.stickyHeaderCell} ${classes.stickyDivider} ${classes.colPick}`}
                style={{ left: STICKY_OFFSETS.pick }}
              />
              {filteredEpisodes.map((x) => (
                <Table.Th
                  key={x.id}
                  scope="col"
                  className={classes.colEvents}
                  title={x.name}
                >
                  Ep {x.order}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>{rows}</Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Board>
  );
};
