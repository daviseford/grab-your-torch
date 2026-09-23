import { Button, Skeleton, Table, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Board,
  EmptySlate,
  Notice,
  PageIntro,
  StandbySlate,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { useIsMobile } from "../hooks/useIsMobile";
import { useMyStatsData } from "../hooks/useMyStatsData";
import { getNumberWithOrdinal } from "../utils/misc";
import {
  PODIUM_MIN_FIELD,
  PROP_BET_MIN_RESOLVED,
  type CompetitionOutcome,
  type MyStats as MyStatsData,
  type UnavailableReason,
} from "../utils/myStats";
import classes from "./MyStats.module.css";

const PLACEHOLDER = "—";

const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  season_results: "Season results could not be loaded.",
  trades: "Trades could not be loaded, so ownership is unknown.",
  not_a_participant: "You are not on this competition's participant list.",
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const formatPoints = (n: number) =>
  `${Number.isInteger(n) ? n : n.toFixed(1)} pts`;

const Tile = ({
  label,
  value,
  context,
  gold = false,
}: {
  label: string;
  value: ReactNode;
  context: ReactNode;
  gold?: boolean;
}) => (
  <div className={classes.tile}>
    <dt className={classes.tileLabel}>{label}</dt>
    <dd className={`${classes.tileValue} ${gold ? classes.tileGold : ""}`}>
      {value}
    </dd>
    <dd className={classes.tileContext}>{context}</dd>
  </div>
);

const RecordBoard = ({ stats }: { stats: MyStatsData }) => {
  const none = stats.completed === 0;
  const waiting = "Finish a competition to see this.";
  const { podiums, bestFinish, averageFinish, highestTotal } = stats;

  return (
    <Board
      title="Record"
      subtitle="Finished competitions"
      titleAs="h2"
      aside={
        stats.smallSample ? (
          <span className={classes.sample}>
            Based on {plural(stats.completed, "completed competition")}
          </span>
        ) : undefined
      }
    >
      <dl className={classes.tiles}>
        <Tile
          label="Competitions"
          value={stats.entered}
          context={`${stats.active} active · ${stats.finished} finished`}
        />
        <Tile
          label="Wins"
          gold={stats.wins > 0}
          value={none ? PLACEHOLDER : stats.wins}
          context={none ? waiting : `of ${stats.completed} finished`}
        />
        <Tile
          label="Win rate"
          value={
            stats.winRate === null
              ? PLACEHOLDER
              : `${Math.round(stats.winRate * 100)}%`
          }
          context={none ? waiting : "Wins divided by finished competitions"}
        />
        <Tile
          label="Podiums"
          value={podiums.eligible === 0 ? PLACEHOLDER : podiums.count}
          context={
            podiums.eligible === 0
              ? `Counts fields of ${PODIUM_MIN_FIELD} or more`
              : `Top 3 in ${podiums.eligible} eligible ${podiums.eligible === 1 ? "competition" : "competitions"} of ${PODIUM_MIN_FIELD}+`
          }
        />
        <Tile
          label="Best finish"
          value={
            bestFinish ? getNumberWithOrdinal(bestFinish.rank) : PLACEHOLDER
          }
          context={
            bestFinish
              ? `of ${bestFinish.fieldSize} · ${bestFinish.competition.competition_name}`
              : waiting
          }
        />
        <Tile
          label="Average finish"
          value={averageFinish ? averageFinish.rank.toFixed(1) : PLACEHOLDER}
          context={
            averageFinish
              ? `In fields averaging ${averageFinish.fieldSize.toFixed(1)}`
              : waiting
          }
        />
        <Tile
          label="Highest total"
          value={highestTotal ? formatPoints(highestTotal.total) : PLACEHOLDER}
          context={
            highestTotal
              ? `${highestTotal.competition.competition_name} · Season ${highestTotal.competition.season_num}. One competition, not a career sum.`
              : waiting
          }
        />
      </dl>
      <Text size="xs" c="dimmed" className={classes.footnote}>
        Ties share a rank and the next rank is skipped, so co-champions each
        count as a win. Podiums only count competitions of {PODIUM_MIN_FIELD} or
        more participants, because a top 3 in a smaller field is automatic.
        Points depend on the season, the field, and the roster size, so they are
        only comparable inside one competition and are never added together.
      </Text>
    </Board>
  );
};

const PropBetBoard = ({ stats }: { stats: MyStatsData }) => {
  const { correct, resolved, sufficient } = stats.propBets;
  return (
    <Board title="Prop bets" subtitle="Finished competitions" titleAs="h2">
      {sufficient ? (
        <p className={classes.propLine}>
          <strong className={classes.propValue}>
            {correct} of {resolved}
          </strong>{" "}
          prop bets right ({Math.round((correct / resolved) * 100)}%)
        </p>
      ) : (
        <p className={classes.propLine}>
          {resolved === 0
            ? "No settled prop bets yet."
            : `${plural(resolved, "prop bet")} settled so far.`}{" "}
          <span className={classes.propHint}>
            Accuracy shows once {PROP_BET_MIN_RESOLVED} or more have settled.
          </span>
        </p>
      )}
    </Board>
  );
};

const CompetitionBadges = ({ outcome }: { outcome: CompetitionOutcome }) => {
  const { competition: c } = outcome;
  return (
    <>
      <StatusBadge kind="season" size="sm">
        S{c.season_num}
      </StatusBadge>
      <StatusBadge
        kind={c.current_episode != null ? "watch-along" : "live"}
        size="sm"
      />
      <StatusBadge kind={c.finished ? "complete" : "in-progress"} size="sm" />
    </>
  );
};

const Finish = ({ outcome }: { outcome: CompetitionOutcome }) => {
  if (outcome.kind === "unavailable") {
    return (
      <span className={classes.unavailable}>
        Data unavailable
        <span className={classes.unavailableWhy}>
          {UNAVAILABLE_COPY[outcome.reason]}
        </span>
      </span>
    );
  }
  const { competition: c, rank, fieldSize } = outcome;
  if (!c.finished && !outcome.started) {
    return <span className={classes.finishText}>Not started</span>;
  }
  const isWin = c.finished && rank === 1;
  return (
    <span className={classes.finish}>
      <span className={`${classes.rank} ${isWin ? classes.rankGold : ""}`}>
        {rank}
      </span>
      <span className={classes.finishText}>
        {c.finished ? "" : "Currently "}
        {getNumberWithOrdinal(rank)} of {fieldSize}
        {!c.finished && (
          <span className={classes.through}>
            {c.current_episode != null
              ? ` · through episode ${c.current_episode}`
              : " · live"}
          </span>
        )}
      </span>
    </span>
  );
};

const Points = ({ outcome }: { outcome: CompetitionOutcome }) =>
  outcome.kind === "scored" ? (
    <span className={classes.points}>{formatPoints(outcome.total)}</span>
  ) : (
    <span className={classes.points}>{PLACEHOLDER}</span>
  );

const CompetitionRecord = ({
  outcomes,
}: {
  outcomes: CompetitionOutcome[];
}) => {
  const isMobile = useIsMobile();
  return (
    <Board
      title="Competition record"
      subtitle="Every competition you are in"
      titleAs="h2"
      flush
    >
      {isMobile ? (
        <ul className={classes.list} role="list">
          {outcomes.map((o) => (
            <li key={o.competition.id}>
              <Link
                to={`/competitions/${o.competition.id}`}
                className={classes.row}
              >
                <div className={classes.rowName}>
                  {o.competition.competition_name}
                </div>
                <div className={classes.rowBadges}>
                  <CompetitionBadges outcome={o} />
                </div>
                <div className={classes.rowFinish}>
                  <Finish outcome={o} />
                  <Points outcome={o} />
                </div>
                <IconChevronRight
                  size={16}
                  className={classes.rowChevron}
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Table.ScrollContainer minWidth={680}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Competition</Table.Th>
                <Table.Th scope="col">Type</Table.Th>
                <Table.Th scope="col">Finish</Table.Th>
                <Table.Th scope="col" ta="right">
                  Points
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {outcomes.map((o) => (
                <Table.Tr key={o.competition.id}>
                  <Table.Td>
                    <Link
                      to={`/competitions/${o.competition.id}`}
                      className={classes.nameLink}
                    >
                      {o.competition.competition_name}
                    </Link>
                  </Table.Td>
                  <Table.Td className={classes.badgeCell}>
                    <span className={classes.badges}>
                      <CompetitionBadges outcome={o} />
                    </span>
                  </Table.Td>
                  <Table.Td>
                    <Finish outcome={o} />
                  </Table.Td>
                  <Table.Td ta="right">
                    <Points outcome={o} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Board>
  );
};

const LoadingBoards = () => (
  <div
    className={classes.stack}
    aria-busy="true"
    aria-label="Loading your stats"
  >
    <Skeleton height={220} />
    <Skeleton height={64} />
    <Skeleton height={260} />
  </div>
);

export const MyStats = () => {
  const data = useMyStatsData();
  useBugContext("My Stats");

  if (data.status === "signed-out") {
    return (
      <StandbySlate
        code="Sign in required"
        actions={
          <>
            <Button
              onClick={() =>
                modals.openContextModal({
                  modal: "AuthModal",
                  innerProps: { initialMode: "register" },
                })
              }
            >
              Create account
            </Button>
            <Button
              variant="outline"
              color="dark.0"
              onClick={() =>
                modals.openContextModal({
                  modal: "AuthModal",
                  innerProps: { initialMode: "login" },
                })
              }
            >
              Sign in
            </Button>
          </>
        }
      >
        <Title order={1} size="h2">
          My Stats require an account
        </Title>
        <Text size="sm">
          Your record is built from the competitions you play in. Sign in to see
          how you have finished.
        </Text>
      </StandbySlate>
    );
  }

  return (
    <div className={classes.page}>
      <PageIntro
        eyebrow="Your record"
        title="My Stats"
        description="How you have finished across your competitions"
      />

      {data.status === "loading" && <LoadingBoards />}

      {data.status === "error" && (
        <Notice
          label="Could not load"
          tone="danger"
          role="alert"
          actions={
            <Button size="xs" variant="default" onClick={data.retry}>
              Try again
            </Button>
          }
        >
          Your competitions could not be read, so nothing is shown rather than a
          record of zeros.
        </Notice>
      )}

      {data.status === "ready" && data.outcomes.length === 0 && (
        <EmptySlate
          title="No competitions yet"
          actions={
            <Button component={Link} to="/seasons" size="sm">
              Create a competition
            </Button>
          }
        >
          Finish a competition and your wins, finishes, and prop-bet accuracy
          show up here.
        </EmptySlate>
      )}

      {data.status === "ready" && data.outcomes.length > 0 && (
        <div className={classes.stack}>
          {data.stats.unavailable > 0 && (
            <Notice
              label="Some data missing"
              tone="warning"
              role="status"
              actions={
                <Button size="xs" variant="default" onClick={data.retry}>
                  Try again
                </Button>
              }
            >
              {plural(data.stats.unavailable, "competition")} could not be
              loaded and {data.stats.unavailable === 1 ? "is" : "are"} left out
              of every number below.
            </Notice>
          )}
          <RecordBoard stats={data.stats} />
          <PropBetBoard stats={data.stats} />
          <CompetitionRecord outcomes={data.outcomes} />
        </div>
      )}
    </div>
  );
};
