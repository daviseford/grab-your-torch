import {
  Alert,
  Anchor,
  Button,
  Loader,
  Select,
  Tabs,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconArrowLeft } from "@tabler/icons-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ChallengeCRUDTable, CreateChallenge } from "../components/Challenges";
import {
  CreateElimination,
  EliminationCRUDTable,
} from "../components/Eliminations";
import { CreateEpisode, EpisodeCRUDTable } from "../components/Episodes";
import { CreateGameEvent, GameEventsCRUDTable } from "../components/GameEvents";
import { RevealStrip } from "../components/Layout";
import {
  CreateTeam,
  TeamCRUDTable,
  TeamPlayerManager,
} from "../components/Teams";
import { useChallenges } from "../hooks/useChallenges";
import { useEliminations } from "../hooks/useEliminations";
import { useEvents } from "../hooks/useEvents";
import { useSeason } from "../hooks/useSeason";
import { useSeasons } from "../hooks/useSeasons";
import { useTeams } from "../hooks/useTeams";
import { useUser } from "../hooks/useUser";
import { AdminAccessDenied } from "./AdminAccessDenied";
import classes from "./SeasonAdmin.module.css";

const VALID_TABS = [
  "episodes",
  "events",
  "challenges",
  "eliminations",
  "teams",
] as const;
type TabValue = (typeof VALID_TABS)[number];
const DEFAULT_TAB: TabValue = "episodes";

const TAB_LABELS: Record<TabValue, string> = {
  episodes: "Episodes",
  events: "Events",
  challenges: "Challenges",
  eliminations: "Eliminations",
  teams: "Teams",
};

/** Highest episode number that has any entered result, capped to the season. */
const highestEpisodeWithResults = (
  total: number,
  ...collections: Record<string, { episode_num: number }>[]
) => {
  let highest = 0;
  for (const collection of collections) {
    for (const record of Object.values(collection)) {
      if (record.episode_num > highest) highest = record.episode_num;
    }
  }
  return Math.min(total, highest);
};

export const SeasonAdmin = () => {
  const { slimUser } = useUser();
  const { seasonId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab");
  const activeTab: TabValue =
    tabParam && (VALID_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as TabValue)
      : DEFAULT_TAB;

  const { data: season, isLoading: isSeasonLoading } = useSeason();
  const { data: seasons, isLoading: isSeasonsLoading } = useSeasons();
  const { data: events } = useEvents(season?.id);
  const { data: challenges } = useChallenges(season?.id);
  const { data: eliminations } = useEliminations(season?.id);
  const { data: teams } = useTeams(season?.id);

  if (!slimUser?.isAdmin) {
    return <AdminAccessDenied />;
  }

  if (isSeasonLoading || isSeasonsLoading) {
    return (
      <div className={classes.loading} role="status" aria-live="polite">
        <Loader size="lg" />
      </div>
    );
  }

  if (!season) {
    return (
      <div className={classes.page}>
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          title="Season not found"
        >
          No season matched "{seasonId}".
        </Alert>
        <Button component={Link} to="/admin" variant="default" w="fit-content">
          Back to dashboard
        </Button>
      </div>
    );
  }

  const seasonOptions =
    seasons
      ?.slice()
      .sort((a, b) => b.order - a.order)
      .map((s) => ({
        value: s.id,
        label: s.name,
      })) ?? [];

  const handleSeasonChange = (value: string | null) => {
    if (value) {
      navigate(`/admin/${value}?tab=${activeTab}`);
    }
  };

  const handleTabChange = (value: string | null) => {
    if (value) {
      setSearchParams({ tab: value }, { replace: true });
    }
  };

  const episodeCount = season.episodes?.length ?? 0;
  const castawayCount = season.players?.length ?? 0;
  const counts: Record<TabValue, number> = {
    episodes: episodeCount,
    events: Object.keys(events).length,
    challenges: Object.keys(challenges).length,
    eliminations: Object.keys(eliminations).length,
    teams: Object.keys(teams).length,
  };
  const resultsThrough = highestEpisodeWithResults(
    episodeCount,
    events,
    challenges,
    eliminations,
  );
  const stripStatus =
    resultsThrough === 0
      ? "Nothing entered yet"
      : resultsThrough >= episodeCount
        ? `Through episode ${resultsThrough}`
        : `Through episode ${resultsThrough} · Next up: ${resultsThrough + 1}`;

  return (
    <div className={classes.page}>
      <Anchor component={Link} to="/admin" className={classes.back}>
        <IconArrowLeft size={14} aria-hidden="true" />
        Back to admin dashboard
      </Anchor>

      <header className={classes.plate}>
        <div className={classes.logoPlate} aria-hidden="true">
          {season.img ? (
            <img src={season.img} alt="" decoding="async" />
          ) : (
            <span className={classes.logoNumber}>{season.order}</span>
          )}
        </div>
        <div className={classes.plateText}>
          <span className={classes.plateLabel}>
            Season {season.order} · Workspace
          </span>
          <Title order={1} className={classes.plateTitle}>
            Manage {season.name}
          </Title>
          <div className={classes.plateMeta}>
            <span>
              <b>{episodeCount}</b> episodes
            </span>
            <span>
              <b>{castawayCount}</b> castaways
            </span>
            <span>
              <b>{counts.teams}</b> tribes
            </span>
            <span>
              <b>{resultsThrough}</b> episodes with results
            </span>
          </div>
        </div>
        <Select
          className={classes.plateSwitch}
          label="Switch season"
          placeholder="Switch season"
          data={seasonOptions}
          value={seasonId ?? null}
          onChange={handleSeasonChange}
          size="sm"
          clearable={false}
        />
      </header>

      {episodeCount > 0 && (
        <div className={classes.strip}>
          <RevealStrip
            total={episodeCount}
            revealedThrough={resultsThrough}
            label="Results entered"
            status={stripStatus}
            size="sm"
            ariaLabel="Episodes with results entered"
          />
        </div>
      )}

      <p className={classes.note}>
        Update the season in order: <b>episodes first</b>, then events,
        challenges, eliminations, and team state.
      </p>

      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        color="signal"
        classNames={{ list: classes.tabList, tab: classes.tab }}
      >
        <Tabs.List aria-label="Season data management">
          {VALID_TABS.map((tab) => (
            <Tabs.Tab key={tab} value={tab} aria-label={TAB_LABELS[tab]}>
              {TAB_LABELS[tab]}
              <span className={classes.count}>{counts[tab]}</span>
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel value="episodes" className={classes.panel}>
          <CreateEpisode />
          <EpisodeCRUDTable />
        </Tabs.Panel>

        <Tabs.Panel value="events" className={classes.panel}>
          <CreateGameEvent />
          <GameEventsCRUDTable />
        </Tabs.Panel>

        <Tabs.Panel value="challenges" className={classes.panel}>
          <CreateChallenge />
          <ChallengeCRUDTable />
        </Tabs.Panel>

        <Tabs.Panel value="eliminations" className={classes.panel}>
          <CreateElimination />
          <EliminationCRUDTable />
        </Tabs.Panel>

        <Tabs.Panel value="teams" className={classes.panel}>
          <CreateTeam />
          <TeamCRUDTable />
          <TeamPlayerManager />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
};
