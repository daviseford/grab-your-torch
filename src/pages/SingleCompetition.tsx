import {
  Accordion,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconArrowLeft, IconLogin, IconUserPlus } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AwaitingDataBanner } from "../components/AwaitingDataBanner";
import { EpisodeAdvanceControl } from "../components/EpisodeAdvanceControl";
import {
  Board,
  EmptySlate,
  PageIntro,
  RevealStrip,
  StandbySlate,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { PlayerGroupGrid } from "../components/MyPlayers";
import { MyTeamSection } from "../components/MyTeam";
import { PropBetScoring } from "../components/PropBetTables";
import {
  ParticipantScoreboard,
  PerSurvivorPerEpisodeDetailedScoringTable,
  PerUserPerEpisodeScoringTable,
  ScoringLegendTable,
} from "../components/ScoringTables";
import { SeasonStatsSection } from "../components/SeasonStats";
import { TradesSection } from "../components/Trades";
import { useAutoFinishCompetition } from "../hooks/useAutoFinishCompetition";
import { useChallenges } from "../hooks/useChallenges";
import { useCompetition } from "../hooks/useCompetition";
import { useEliminations } from "../hooks/useEliminations";
import { useEvents } from "../hooks/useEvents";
import { usePropBetScoring } from "../hooks/useGetPropBetScoring";
import { useSeason } from "../hooks/useSeason";
import { useSeasonStats } from "../hooks/useSeasonStats";
import { useTrades } from "../hooks/useTrades";
import { useUser } from "../hooks/useUser";
import {
  getCompetitionAwaitingDataEpisode,
  getLatestDataEpisode,
} from "../utils/episodeAirDate";
import {
  competitionBugContext,
  competitionContextLine,
  competitionModeBadge,
} from "./competitionSignals";
import classes from "./SingleCompetition.module.css";

const VALID_TABS = ["overview", "team", "trades", "stats"] as const;
type TabValue = (typeof VALID_TABS)[number];
const DEFAULT_TAB: TabValue = "overview";

const SectionHead = ({
  id,
  title,
  note,
}: {
  id?: string;
  title: string;
  note?: string;
}) => (
  <div className={classes.sectionHead}>
    <Title order={3} id={id}>
      {title}
    </Title>
    {note && <span className={classes.sectionNote}>{note}</span>}
  </div>
);

export const SingleCompetition = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabsRef = useRef<HTMLDivElement>(null);
  const { data: competition, isLoading: isCompetitionLoading } =
    useCompetition();
  const { slimUser, isAuthReady } = useUser();
  const { activeKeys: activePropBetKeys } = usePropBetScoring();
  const tradeState = useTrades(competition?.id);

  const { data: season } = useSeason(competition?.season_id);
  const { data: unfilteredEvents, isReady: areEventsReady } = useEvents(
    competition?.season_id,
  );
  const { data: challenges, isReady: areChallengesReady } = useChallenges(
    competition?.season_id,
  );
  const { data: eliminations, isReady: areEliminationsReady } = useEliminations(
    competition?.season_id,
  );
  const seasonStats = useSeasonStats();

  // My Team only exists for participants; a shared ?tab=team link opened by
  // anyone else lands on the overview instead of an empty panel.
  const isParticipant =
    !!slimUser && !!competition?.participant_uids.includes(slimUser.uid);
  const tabParam = searchParams.get("tab");
  const requestedTab: TabValue =
    tabParam && (VALID_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as TabValue)
      : DEFAULT_TAB;
  const activeTab: TabValue =
    requestedTab === "team" && !isParticipant ? DEFAULT_TAB : requestedTab;

  const handleTabChange = (value: string | null) => {
    if (!value || value === activeTab) return;

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("tab", value);
    setSearchParams(nextSearchParams);

    window.requestAnimationFrame(() => {
      tabsRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  };

  useAutoFinishCompetition({
    events: unfilteredEvents,
    competition,
    episodes: season?.episodes ?? [],
    slimUser,
  });

  // Competitions are readable only by signed-in users (firestore.rules), so a
  // signed-out visitor, typically arriving from a shared link, is sent
  // straight to sign-in. The modal closes itself on success; the cleanup also
  // closes it on navigation away and keeps Strict Mode's double-run from
  // stacking two modals.
  const requiresSignIn = isAuthReady && !slimUser;
  useEffect(() => {
    if (!requiresSignIn) return;
    const modalId = modals.openContextModal({
      modal: "AuthModal",
      innerProps: {
        initialMode: "login",
        actionDescription: "Sign in to view this competition",
      },
    });
    return () => modals.close(modalId);
  }, [requiresSignIn]);

  useBugContext(competition ? competitionBugContext(competition) : null);

  if (requiresSignIn) {
    return (
      <Center py="xl">
        <Stack align="center" gap="md">
          <Alert title="Sign in to view this competition">
            Competitions are only visible to signed-in users. Sign in to see the
            standings, or create a free account if you're new here.
          </Alert>
          <Group gap="sm">
            <Button
              leftSection={<IconLogin size={18} />}
              onClick={() =>
                modals.openContextModal({
                  modal: "AuthModal",
                  innerProps: {
                    initialMode: "login",
                    actionDescription: "Sign in to view this competition",
                  },
                })
              }
            >
              Sign in
            </Button>
            <Button
              variant="default"
              leftSection={<IconUserPlus size={18} />}
              onClick={() =>
                modals.openContextModal({
                  modal: "AuthModal",
                  innerProps: {
                    initialMode: "register",
                    actionDescription:
                      "Create an account to view this competition",
                  },
                })
              }
            >
              Create account
            </Button>
          </Group>
        </Stack>
      </Center>
    );
  }

  if (!competition && !isCompetitionLoading) {
    return (
      <StandbySlate
        code="Not found"
        actions={
          <Button component={Link} to="/competitions">
            Back to competitions
          </Button>
        }
      >
        <Title order={1}>Competition not found</Title>
        <Text c="dimmed" maw={420}>
          This competition doesn't exist or may have been removed.
        </Text>
      </StandbySlate>
    );
  }

  if (!competition || !season) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  const episodeCount = season.episodes?.length ?? 0;
  const isCreator = slimUser?.uid === competition.creator_uid;
  const isWatchAlong = competition.current_episode != null;
  const modeBadge = competitionModeBadge(competition);
  const showEpisodeControl = isWatchAlong || isCreator;
  const hasWinner = Object.values(unfilteredEvents).some(
    (e) => e.action === "win_survivor",
  );

  const latestDataEpisode = getLatestDataEpisode(
    challenges,
    eliminations,
    unfilteredEvents,
  );
  const isScoringDataReady =
    areChallengesReady && areEliminationsReady && areEventsReady;
  const awaitingDataEpisode = getCompetitionAwaitingDataEpisode({
    season,
    latestDataEpisode,
    isScoringDataReady,
    currentEpisode: competition.current_episode,
    finished: competition.finished,
    hasWinner,
  });
  const latestVisibleDataEpisode = isWatchAlong
    ? Math.min(latestDataEpisode, competition.current_episode ?? 0)
    : latestDataEpisode;
  const hasSeasonStats =
    latestVisibleDataEpisode > 0 &&
    seasonStats != null &&
    (seasonStats.castawayCards.length > 0 ||
      seasonStats.rosterStats.length > 0);
  const incomingTradeCount = slimUser?.uid
    ? tradeState.data.filter(
        (trade) =>
          trade.status === "pending" && trade.offered_to_uid === slimUser.uid,
      ).length
    : 0;
  const tradesTabLabel =
    incomingTradeCount > 0
      ? `Trades, ${incomingTradeCount} pending ${incomingTradeCount === 1 ? "offer" : "offers"}`
      : "Trades";

  // The reveal strip keys off the competition's own episode boundary. A live
  // competition has no boundary, so it shows how far results have been
  // entered instead, which is exactly what a live competition displays.
  const revealedThrough = isWatchAlong
    ? (competition.current_episode ?? 0)
    : Math.min(latestVisibleDataEpisode, episodeCount);
  const revealedEpisode = season.episodes?.find(
    (e) => e.order === revealedThrough,
  );
  const stripStatus = isWatchAlong
    ? revealedThrough === 0
      ? "Nothing revealed yet"
      : `Ep ${revealedThrough}${revealedEpisode?.name ? `: ${revealedEpisode.name}` : ""}`
    : revealedThrough === 0
      ? "No results yet"
      : `Results through episode ${revealedThrough}`;
  const participantCount = competition.participants.length;
  const participantLabel = `${participantCount} ${participantCount === 1 ? "participant" : "participants"}`;

  const episodeContext = isWatchAlong ? (
    revealedThrough === 0 ? (
      <span className={classes.episodeContext}>
        Nothing revealed yet
        {episodeCount > 0 && <span> · {episodeCount} episodes</span>}
      </span>
    ) : (
      <span className={classes.episodeContext}>
        Episode {revealedThrough} of {episodeCount}
        {revealedEpisode && <span> · {revealedEpisode.name}</span>}
      </span>
    )
  ) : episodeCount > 0 ? (
    <span className={classes.episodeContext}>
      {episodeCount} {episodeCount === 1 ? "episode" : "episodes"}
    </span>
  ) : null;

  return (
    <div className={classes.page}>
      <Button
        component={Link}
        to="/competitions"
        variant="subtle"
        size="compact-sm"
        color="gray"
        leftSection={<IconArrowLeft size={14} />}
        className={classes.back}
      >
        Back to competitions
      </Button>

      <PageIntro
        eyebrow="Competition"
        // The cyan context is a signal: it names the mode only while the
        // competition is still running; a finished one carries the facts in
        // its badges instead.
        context={competitionContextLine(competition)}
        title={competition.competition_name}
        meta={
          <>
            <StatusBadge kind="season">
              Season {competition.season_num}
            </StatusBadge>
            {modeBadge && <StatusBadge kind={modeBadge} />}
            <StatusBadge
              kind={competition.finished ? "complete" : "in-progress"}
            />
            <span className={classes.metaSep} aria-hidden="true" />
            <span className={classes.metaFact}>{participantLabel}</span>
            {episodeContext && (
              <>
                <span className={classes.metaSep} aria-hidden="true" />
                {episodeContext}
              </>
            )}
          </>
        }
        actions={
          <div className={classes.headerSide}>
            {episodeCount > 0 && (
              <RevealStrip
                total={episodeCount}
                revealedThrough={revealedThrough}
                label={isWatchAlong ? "Episode reveal" : "Results entered"}
                status={stripStatus}
                size="sm"
              />
            )}
            {showEpisodeControl && (
              <EpisodeAdvanceControl
                competition={competition}
                season={season}
                isCreator={isCreator}
                hasWinner={hasWinner}
              />
            )}
          </div>
        }
      />

      {awaitingDataEpisode && (
        <AwaitingDataBanner episode={awaitingDataEpisode} />
      )}

      <ParticipantScoreboard />

      <Box ref={tabsRef} className={classes.tabsAnchor}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          className={classes.tabs}
        >
          <Tabs.List
            aria-label="Competition sections"
            className={classes.tabsList}
          >
            <Tabs.Tab value="overview" className={classes.tab}>
              Overview
            </Tabs.Tab>
            {isParticipant && (
              <Tabs.Tab value="team" className={classes.tab}>
                My Team
              </Tabs.Tab>
            )}
            <Tabs.Tab
              value="trades"
              className={classes.tab}
              aria-label={tradesTabLabel}
            >
              <span className={classes.tabLabel}>
                Trades
                {incomingTradeCount > 0 && (
                  <span className={classes.tabCount} aria-hidden="true">
                    {incomingTradeCount > 99 ? "99+" : incomingTradeCount}
                  </span>
                )}
              </span>
            </Tabs.Tab>
            <Tabs.Tab value="stats" className={classes.tab}>
              Stats
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" className={classes.panel}>
            <div className={classes.overview}>
              <section className={classes.rosters} aria-labelledby="rosters-h">
                <SectionHead
                  id="rosters-h"
                  title="Rosters"
                  note="Castaways by participant. Accepted trades land at the next episode reveal"
                />
                <PlayerGroupGrid />
              </section>

              <div className={classes.rail}>
                <Paper className={classes.boardHost}>
                  <Board
                    title="Standings"
                    subtitle={
                      revealedThrough > 0
                        ? `Through episode ${revealedThrough}`
                        : "Points by participant"
                    }
                    aside={
                      modeBadge && <StatusBadge kind={modeBadge} size="sm" />
                    }
                    dense
                    flush
                  >
                    <PerUserPerEpisodeScoringTable />
                  </Board>
                </Paper>

                {activePropBetKeys.length > 0 && (
                  <Board
                    title="Prop Bets"
                    subtitle="Pre-season predictions and results"
                    dense
                    flush
                  >
                    <PropBetScoring />
                  </Board>
                )}
              </div>

              <div className={classes.scores}>
                <PerSurvivorPerEpisodeDetailedScoringTable />
              </div>

              <Accordion
                variant="separated"
                radius="md"
                className={classes.reference}
                classNames={{
                  item: classes.referenceItem,
                  control: classes.referenceControl,
                  panel: classes.referencePanel,
                  content: classes.referenceContent,
                }}
              >
                <Accordion.Item value="scoring-values">
                  <Accordion.Control>
                    <Title order={4} className={classes.referenceTitle}>
                      Scoring Reference
                    </Title>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <ScoringLegendTable />
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </div>
          </Tabs.Panel>

          {isParticipant && (
            <Tabs.Panel value="team" className={classes.panel}>
              <MyTeamSection trades={tradeState.data} />
            </Tabs.Panel>
          )}

          <Tabs.Panel value="trades" className={classes.panel}>
            <section className={classes.tabSection} aria-labelledby="trades-h">
              <SectionHead
                id="trades-h"
                title="Trades"
                note="Trade active castaways with other participants"
              />
              <TradesSection
                trades={tradeState.data}
                tradesLoaded={tradeState.loaded}
                tradesError={tradeState.error}
              />
            </section>
          </Tabs.Panel>

          <Tabs.Panel value="stats" className={classes.panel}>
            <section className={classes.tabSection} aria-labelledby="stats-h">
              <SectionHead
                id="stats-h"
                title="Season Stats"
                note={`Key storylines and standout performances${
                  revealedThrough > 0
                    ? ` · Through episode ${revealedThrough}`
                    : ""
                }`}
              />
              {!isScoringDataReady ? (
                <div className={classes.loading} role="status">
                  <Loader size="sm" aria-label="Loading season stats" />
                  <Text size="sm" c="dimmed">
                    Loading season stats…
                  </Text>
                </div>
              ) : hasSeasonStats ? (
                <SeasonStatsSection stats={seasonStats} />
              ) : (
                <EmptySlate title="Season stats are just getting started">
                  Highlights and roster trends will appear after the first
                  episode's scoring data is available.
                </EmptySlate>
              )}
            </section>
          </Tabs.Panel>
        </Tabs>
      </Box>
    </div>
  );
};
