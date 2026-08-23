import {
  Button,
  SegmentedControl,
  Select,
  Skeleton,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  EmptySlate,
  PageIntro,
  StandbySlate,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { useCompetitions } from "../hooks/useCompetitions";
import { useIsMobile } from "../hooks/useIsMobile";
import { useMyCompetitions } from "../hooks/useMyCompetitions";
import { useUser } from "../hooks/useUser";
import { Competition } from "../types";
import classes from "./Competitions.module.css";

type SortField = "name" | "season" | "participants" | "type" | "status";

const badgeClassNames = { label: classes.badgeLabel };
type SortDir = "asc" | "desc";

const SortableHeader = ({
  label,
  field,
  sortField,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}) => {
  const isActive = sortField === field;
  const Icon = isActive && sortDir === "desc" ? IconChevronDown : IconChevronUp;
  const ariaSortValue = isActive
    ? sortDir === "asc"
      ? "ascending"
      : "descending"
    : undefined;
  return (
    <Table.Th scope="col" aria-sort={ariaSortValue} className={className}>
      <UnstyledButton
        onClick={() => onSort(field)}
        className={classes.sortButton}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <Icon size={12} style={{ opacity: isActive ? 1 : 0.3 }} />
      </UnstyledButton>
    </Table.Th>
  );
};

const creatorName = (comp: Competition) =>
  comp.team_names?.[comp.creator_uid] ??
  comp.participants.find((p) => p.uid === comp.creator_uid)?.displayName;

const CompetitionBadges = ({ comp }: { comp: Competition }) => (
  <>
    <Tooltip
      label={`Season ${comp.season_num}`}
      events={{ hover: true, focus: true, touch: true }}
    >
      <span>
        <StatusBadge kind="season" size="sm" classNames={badgeClassNames}>
          S{comp.season_num}
        </StatusBadge>
      </span>
    </Tooltip>
    <StatusBadge
      kind={comp.current_episode != null ? "watch-along" : "live"}
      size="sm"
      classNames={badgeClassNames}
    />
    <StatusBadge
      kind={comp.finished ? "complete" : "in-progress"}
      size="sm"
      classNames={badgeClassNames}
    />
  </>
);

export const Competitions = () => {
  const { slimUser } = useUser();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const { data: competitions, isLoading } = useMyCompetitions();
  const { data: allCompetitions } = useCompetitions();

  const [sortField, setSortField] = useState<SortField>("season");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [seasonFilter, setSeasonFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const _comps = useMemo(
    () => (allCompetitions?.length ? allCompetitions : competitions) || [],
    [allCompetitions, competitions],
  );

  const seasonOptions = useMemo(() => {
    const nums = [...new Set(_comps.map((c) => c.season_num))].sort(
      (a, b) => b - a,
    );
    return nums.map((n) => ({ value: String(n), label: `Season ${n}` }));
  }, [_comps]);

  const filtered = useMemo(() => {
    return _comps.filter((c) => {
      if (seasonFilter && c.season_num !== Number(seasonFilter)) return false;
      if (statusFilter === "complete" && !c.finished) return false;
      if (statusFilter === "in_progress" && c.finished) return false;
      return true;
    });
  }, [_comps, seasonFilter, statusFilter]);

  const sorted = useMemo(() => {
    const compareFn = (a: Competition, b: Competition) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.competition_name.localeCompare(b.competition_name);
          break;
        case "season":
          cmp = a.season_num - b.season_num;
          break;
        case "participants":
          cmp = a.participants.length - b.participants.length;
          break;
        case "type":
          cmp =
            Number(a.current_episode != null) -
            Number(b.current_episode != null);
          break;
        case "status":
          cmp = Number(a.finished) - Number(b.finished);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    };
    return filtered.slice().sort(compareFn);
  }, [filtered, sortField, sortDir]);

  const formatParticipants = (comp: Competition) =>
    comp.participants
      .map((p) => comp.team_names?.[p.uid] ?? p.displayName ?? p.email)
      .join(", ");

  const hasFilters = !!seasonFilter || statusFilter !== "all";
  const clearFilters = () => {
    setSeasonFilter(null);
    setStatusFilter("all");
  };

  useBugContext("Competitions");

  if (!slimUser) {
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
          Competitions require an account
        </Title>
        <Text size="sm">
          Competitions track your draft scores against friends across a whole
          season. Create a free account to start one, or sign in to view yours.
        </Text>
      </StandbySlate>
    );
  }

  const rows = sorted.map((x) => (
    <Table.Tr
      onClick={() => navigate(`/competitions/${x.id}`)}
      key={x.id}
      className={classes.clickableRow}
      tabIndex={0}
      role="row"
      aria-label={x.competition_name}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          navigate(`/competitions/${x.id}`);
        }
      }}
    >
      <Table.Td>
        <div className={classes.name}>{x.competition_name}</div>
        <div className={classes.creator}>
          <VisuallyHidden>Created by: </VisuallyHidden>
          {creatorName(x)}
        </div>
      </Table.Td>
      <Table.Td className={classes.badgeCell}>
        <Tooltip
          label={`Season ${x.season_num}`}
          events={{ hover: true, focus: true, touch: true }}
        >
          <span>
            <StatusBadge kind="season" size="sm" classNames={badgeClassNames}>
              S{x.season_num}
            </StatusBadge>
          </span>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <div className={classes.people}>{formatParticipants(x)}</div>
      </Table.Td>
      <Table.Td className={classes.badgeCell}>
        <StatusBadge
          kind={x.current_episode != null ? "watch-along" : "live"}
          size="sm"
          classNames={badgeClassNames}
        />
      </Table.Td>
      <Table.Td className={classes.badgeCell}>
        <StatusBadge
          kind={x.finished ? "complete" : "in-progress"}
          size="sm"
          classNames={badgeClassNames}
        />
      </Table.Td>
      <Table.Td className={classes.chevronCell} role="presentation">
        <IconChevronRight
          size={16}
          className={classes.chevron}
          aria-hidden="true"
        />
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <div className={classes.page}>
      <PageIntro
        eyebrow="Your league"
        title={
          <>
            Competitions
            {sorted.length > 0 && (
              <span className={classes.count}>
                <VisuallyHidden>, </VisuallyHidden>
                {sorted.length}
                <VisuallyHidden>
                  {" "}
                  {sorted.length === 1 ? "competition" : "competitions"}
                </VisuallyHidden>
              </span>
            )}
          </>
        }
        description="Your active and past competitions"
        actions={
          <div className={classes.filters}>
            <Select
              placeholder="All seasons"
              aria-label="Filter by season"
              data={seasonOptions}
              value={seasonFilter}
              onChange={setSeasonFilter}
              clearable
              size="sm"
              className={classes.seasonSelect}
            />
            <SegmentedControl
              size="sm"
              aria-label="Filter by status"
              value={statusFilter}
              onChange={setStatusFilter}
              classNames={{
                root: classes.segmented,
                indicator: classes.segmentedIndicator,
                label: classes.segmentedLabel,
              }}
              data={[
                { label: "All", value: "all" },
                { label: "In progress", value: "in_progress" },
                { label: "Complete", value: "complete" },
              ]}
            />
            <Button component={Link} to="/seasons" size="sm">
              Create a competition
            </Button>
          </div>
        }
      />

      {isLoading && (
        <div className={classes.board}>
          <div className={classes.skeletons}>
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </div>
        </div>
      )}

      {!isLoading &&
        sorted.length === 0 &&
        (hasFilters ? (
          <EmptySlate
            title="No competitions match your filters"
            actions={
              <Button variant="default" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          >
            Try another season or status.
          </EmptySlate>
        ) : (
          <EmptySlate
            title="No competitions yet"
            actions={
              <Button component={Link} to="/seasons" size="sm">
                Create a competition
              </Button>
            }
          >
            Pick a season, start a draft, and see who has the best Survivor
            instincts.
          </EmptySlate>
        ))}

      {!isLoading && sorted.length > 0 && isMobile && (
        <div className={classes.board}>
          <ul className={classes.list} role="list">
            {sorted.map((x) => (
              <li key={x.id}>
                <Link
                  to={`/competitions/${x.id}`}
                  className={classes.row}
                  aria-label={x.competition_name}
                >
                  <div className={classes.rowName}>
                    <div className={classes.name}>{x.competition_name}</div>
                    <div className={classes.creator}>
                      <VisuallyHidden>Created by: </VisuallyHidden>
                      {creatorName(x)}
                    </div>
                  </div>
                  <div className={classes.rowBadges}>
                    <CompetitionBadges comp={x} />
                  </div>
                  <div className={classes.rowPeople}>
                    {formatParticipants(x)}
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
        </div>
      )}

      {!isLoading && sorted.length > 0 && !isMobile && (
        <div className={classes.board}>
          <Table.ScrollContainer minWidth={640}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <SortableHeader
                    label="Name"
                    field="name"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Season"
                    field="season"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Participants"
                    field="participants"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Type"
                    field="type"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Status"
                    field="status"
                    sortField={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <Table.Th scope="col">
                    <VisuallyHidden>Navigate</VisuallyHidden>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>{rows}</Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </div>
      )}
    </div>
  );
};
