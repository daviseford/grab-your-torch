import {
  Button,
  SegmentedControl,
  TextInput,
  VisuallyHidden,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  EmptySlate,
  PageIntro,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { SEASON_METADATA, type SeasonMeta } from "../data/season-metadata";
import {
  formatPremiereDate,
  getSeasonAirStatus,
} from "../utils/seasonAirStatus";
import { SEASON_ERAS, type SeasonEraId } from "./SeasonEras";
import classes from "./Seasons.module.css";
import { SeasonTile } from "./SeasonTile";

type EraFilter = "all" | SeasonEraId;

const ERA_OPTIONS = [
  { label: "All", value: "all" },
  ...SEASON_ERAS.map((era) => ({
    label: `${era.label} ${era.range}`,
    value: era.id,
  })),
];

function matchesSearch(meta: SeasonMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    String(meta.order).includes(q) ||
    meta.name.toLowerCase().includes(q) ||
    (meta.subtitle?.toLowerCase().includes(q) ?? false) ||
    meta.location.toLowerCase().includes(q)
  );
}

function matchesEra(meta: SeasonMeta, filter: EraFilter): boolean {
  if (filter === "all") return true;
  const era = SEASON_ERAS.find((e) => e.id === filter);
  return !!era && meta.order >= era.min && meta.order <= era.max;
}

export const Seasons = () => {
  useBugContext("Seasons");
  const [search, setSearch] = useState("");
  const [era, setEra] = useState<EraFilter>("all");

  const allSeasons = useMemo(
    () => Object.values(SEASON_METADATA).sort((a, b) => b.order - a.order),
    [],
  );

  // The live season is the highest-order incomplete season that has
  // premiered; a registered season still waiting to air is "upcoming".
  const liveSeason = useMemo(
    () => allSeasons.find((m) => getSeasonAirStatus(m) === "live") ?? null,
    [allSeasons],
  );
  const upcomingSeason = useMemo(
    () => allSeasons.find((m) => getSeasonAirStatus(m) === "upcoming") ?? null,
    [allSeasons],
  );
  const liveSeasonId = liveSeason?.id ?? null;
  const upcomingSeasonId = upcomingSeason?.id ?? null;

  const introContext = liveSeason
    ? `On air · ${liveSeason.name}`
    : upcomingSeason?.premiere
      ? `Premieres ${formatPremiereDate(upcomingSeason.premiere)} · ${upcomingSeason.name}`
      : undefined;

  const marqueeSeasons = useMemo(() => allSeasons.slice(0, 2), [allSeasons]);

  const marqueeIds = useMemo(
    () => new Set(marqueeSeasons.map((m) => m.id)),
    [marqueeSeasons],
  );

  // The marquee seasons stay out of the guide grid so they are not listed
  // twice, except while searching: a search for "51" should find Survivor 51
  // rather than report that nothing matches.
  const isSearching = search.trim().length > 0;
  const browseSeasons = useMemo(() => {
    return allSeasons.filter(
      (meta) =>
        (isSearching || !marqueeIds.has(meta.id)) &&
        matchesSearch(meta, search) &&
        matchesEra(meta, era),
    );
  }, [allSeasons, marqueeIds, isSearching, search, era]);

  const clearFilters = () => {
    setSearch("");
    setEra("all");
  };

  return (
    <div className={classes.page}>
      <PageIntro
        eyebrow="Seasons"
        context={introContext}
        title="Pick a season"
        description="Choose a season, scout the castaways, and get a draft going with your friends."
        actions={
          <Button component={Link} to="/scoring" variant="outline">
            How scoring works
          </Button>
        }
      />

      {/* On-air slot: the two latest seasons as large cells */}
      <section aria-labelledby="seasons-onair" className={classes.section}>
        <div className={classes.sectionLabel}>
          <h2 id="seasons-onair" className={classes.sectionTitle}>
            {liveSeason ? "On air" : upcomingSeason ? "Coming up" : "Latest"}
          </h2>
          {liveSeason && <StatusBadge kind="live" size="sm" />}
        </div>
        <div className={classes.onAir}>
          {marqueeSeasons.map((meta) => {
            const live = meta.id === liveSeasonId;
            const upcoming = meta.id === upcomingSeasonId;
            return (
              <SeasonTile
                key={meta.id}
                meta={meta}
                live={live}
                size="lg"
                badges={
                  live ? (
                    <StatusBadge kind="live" size="sm" />
                  ) : upcoming ? (
                    <StatusBadge kind="pending" size="sm">
                      Upcoming
                    </StatusBadge>
                  ) : meta.complete ? (
                    <StatusBadge kind="complete" size="sm" />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      </section>

      {/* Find bar, era control, and the guide grid */}
      <section aria-labelledby="seasons-all" className={classes.section}>
        <VisuallyHidden>
          <h2 id="seasons-all">All seasons</h2>
        </VisuallyHidden>

        <div className={classes.findBar}>
          <TextInput
            placeholder="Search by name, number, or location..."
            leftSection={<IconSearch size={16} aria-hidden="true" />}
            aria-label="Search seasons"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            className={classes.search}
          />
          <div className={classes.scroller}>
            <SegmentedControl
              aria-label="Filter by era"
              value={era}
              onChange={(value) => setEra(value as EraFilter)}
              data={ERA_OPTIONS}
              withItemsBorders={false}
              classNames={{
                root: classes.segRoot,
                label: classes.segLabel,
                indicator: classes.segIndicator,
              }}
            />
          </div>
          <span className={classes.count} aria-live="polite">
            <b>{browseSeasons.length}</b>{" "}
            {browseSeasons.length === 1 ? "season" : "seasons"}
          </span>
        </div>

        {browseSeasons.length === 0 ? (
          <div role="status">
            <EmptySlate
              title="No seasons match"
              actions={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear search
                </Button>
              }
            >
              {search.trim()
                ? `Nothing matches "${search.trim()}". Try a season name, number, or location.`
                : "Nothing matches these filters. Try a season name, number, or location."}
            </EmptySlate>
          </div>
        ) : (
          <div className={classes.grid}>
            {browseSeasons.map((meta) => (
              <SeasonTile
                key={meta.id}
                meta={meta}
                live={meta.id === liveSeasonId}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
