import {
  Accordion,
  Anchor,
  Button,
  Loader,
  Stack,
  Table,
  Text,
  TextInput,
  VisuallyHidden,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconSearch, IconX } from "@tabler/icons-react";
import { ref, remove } from "firebase/database";
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Board,
  EmptySlate,
  PageIntro,
  StatusBadge,
} from "../components/Layout";
import { SEASON_9_CHALLENGES, SEASON_9_ELIMINATIONS } from "../data/season_9";
import { SEASONS } from "../data/seasons";
import { db, rt_db } from "../firebase";
import { useCompetitions } from "../hooks/useCompetitions";
import { useSeasons } from "../hooks/useSeasons";
import { useUser } from "../hooks/useUser";
import { Competition } from "../types";
import classes from "./Admin.module.css";
import { AdminAccessDenied } from "./AdminAccessDenied";

const upload = async (label: string, fn: () => Promise<void>) => {
  try {
    await fn();
    notifications.show({
      title: `${label} uploaded successfully`,
      message: "",
      color: "green",
      icon: <IconCheck size={16} />,
    });
  } catch (err) {
    notifications.show({
      title: `${label} failed`,
      message: err instanceof Error ? err.message : "Unknown error",
      color: "red",
      icon: <IconX size={16} />,
    });
  }
};

export const Admin = () => {
  const navigate = useNavigate();
  const { slimUser } = useUser();

  const { data: seasons, isLoading } = useSeasons();
  const { data: competitions } = useCompetitions();
  const [seasonSearch, setSeasonSearch] = useState("");

  const sortedSeasons = useMemo(
    () => seasons?.slice().sort((a, b) => b.order - a.order) ?? [],
    [seasons],
  );

  const latestSeason = sortedSeasons[0];

  const filteredSeasons = useMemo(() => {
    if (!seasonSearch.trim()) return sortedSeasons;
    const q = seasonSearch.toLowerCase();
    return sortedSeasons.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        String(s.order).includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [sortedSeasons, seasonSearch]);

  const handleDeleteCompetition = (competition: Competition) => {
    modals.openConfirmModal({
      title: `Delete "${competition.competition_name}"?`,
      children: (
        <Stack gap="xs">
          <Text size="sm">
            This removes the competition and its linked live draft data.{" "}
            <Text component="strong" fw={700} inherit>
              This action is permanent.
            </Text>
          </Text>
          <Text size="sm" c="dimmed">
            Season {competition.season_num} · {competition.participants.length}{" "}
            participants
          </Text>
        </Stack>
      ),
      labels: { confirm: "Delete competition", cancel: "Keep it" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "competitions", competition.id));
          await remove(ref(rt_db, `drafts/${competition.draft_id}`));
          notifications.show({
            title: "Competition deleted",
            message: `"${competition.competition_name}" removed`,
            color: "green",
            icon: <IconCheck size={16} />,
          });
        } catch (err) {
          notifications.show({
            title: "Failed to delete competition",
            message: err instanceof Error ? err.message : "Unknown error",
            color: "red",
            icon: <IconX size={16} />,
          });
        }
      },
    });
  };

  if (!slimUser?.isAdmin) {
    return <AdminAccessDenied />;
  }

  return (
    <div className={classes.page}>
      <PageIntro
        eyebrow="Control room"
        title="Admin Dashboard"
        description="Choose a season, update game data, and keep league operations in sync."
        actions={
          latestSeason ? (
            <>
              <Button
                variant="default"
                component={Link}
                to={`/admin/${latestSeason.id}?tab=events`}
              >
                Jump to S{latestSeason.order} Events
              </Button>
              <Button component={Link} to={`/admin/${latestSeason.id}`}>
                Open Latest Season
              </Button>
            </>
          ) : undefined
        }
      />

      <section aria-labelledby="admin-status-heading">
        <VisuallyHidden>
          <h2 id="admin-status-heading">Status</h2>
        </VisuallyHidden>
        <div className={classes.status}>
          <div className={classes.statusCell}>
            <span className={classes.statusLabel}>Latest Season</span>
            <div className={classes.statusValue}>
              {latestSeason?.name ?? "No seasons"}
            </div>
            <div className={classes.statusSub}>
              {latestSeason
                ? `${latestSeason.episodes?.length ?? 0} episodes · ${latestSeason.players?.length ?? 0} castaways`
                : "Add season data to get started."}
            </div>
          </div>
          <div className={classes.statusCell}>
            <span className={classes.statusLabel}>Competition Count</span>
            <div className={classes.statusValue}>{competitions.length}</div>
            <div className={classes.statusSub}>
              Active and archived competitions visible to admins.
            </div>
          </div>
          <div className={classes.statusCell}>
            <span className={classes.statusLabel}>Recommended Next Step</span>
            <div className={classes.statusValue}>
              {latestSeason ? `Open ${latestSeason.name}` : "Review seasons"}
              {latestSeason && (
                <Anchor
                  component={Link}
                  to={`/admin/${latestSeason.id}`}
                  className={classes.statusLink}
                >
                  Open workspace
                </Anchor>
              )}
            </div>
            <div className={classes.statusSub}>
              Start with episodes, then events, challenges, eliminations, and
              teams.
            </div>
          </div>
        </div>
      </section>

      <Board
        title="Seasons"
        subtitle={isLoading ? undefined : `· ${sortedSeasons.length}`}
        titleAs="h2"
        dense
        flush
        scroll
        className={classes.seasonsBoard}
        aside={
          <div className={classes.tools}>
            <span className={classes.sortNote}>Newest first</span>
            <TextInput
              className={classes.find}
              size="xs"
              aria-label="Search by season name, number, or id"
              placeholder="Search by season name, number, or id"
              leftSection={<IconSearch size={14} />}
              value={seasonSearch}
              onChange={(e) => setSeasonSearch(e.currentTarget.value)}
            />
          </div>
        }
      >
        {isLoading ? (
          <div className={classes.loadingRow} role="status" aria-live="polite">
            <Loader size="xs" />
            Loading seasons
          </div>
        ) : (
          <>
            <Table highlightOnHover className={classes.tableMid}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Season</Table.Th>
                  <Table.Th className={classes.numHead}>Episodes</Table.Th>
                  <Table.Th className={classes.numHead}>Castaways</Table.Th>
                  <Table.Th className={classes.actionsHead}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredSeasons.map((season) => (
                  <Table.Tr
                    key={season.id}
                    className={
                      season.id === latestSeason?.id
                        ? classes.latestRow
                        : undefined
                    }
                  >
                    <Table.Td>
                      <div className={classes.seasonCell}>
                        <span className={classes.logoChip} aria-hidden="true">
                          {season.img ? (
                            <img
                              src={season.img}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className={classes.logoChipText}>
                              {season.order}
                            </span>
                          )}
                        </span>
                        <StatusBadge kind="season" size="sm">
                          S{season.order}
                        </StatusBadge>
                        <span className={classes.seasonName}>
                          {season.name}
                        </span>
                      </div>
                    </Table.Td>
                    <Table.Td className={classes.num}>
                      {season.episodes?.length ?? 0}
                    </Table.Td>
                    <Table.Td className={classes.num}>
                      {season.players?.length ?? 0}
                    </Table.Td>
                    <Table.Td className={classes.actionsCell}>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => navigate(`/admin/${season.id}`)}
                        aria-label={`Manage ${season.name}`}
                      >
                        Manage
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {filteredSeasons.length === 0 && (
              <div className={classes.boardEmpty}>
                <EmptySlate
                  title={`No seasons match "${seasonSearch}"`}
                  actions={
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => setSeasonSearch("")}
                    >
                      Clear search
                    </Button>
                  }
                >
                  Try a season number or clear the search.
                </EmptySlate>
              </div>
            )}
          </>
        )}
      </Board>

      <Board
        title="Competitions"
        subtitle={`· ${competitions.length}`}
        titleAs="h2"
        dense
        flush
        scroll
      >
        <p className={classes.boardNote}>
          Delete competitions and their associated draft data. This action is
          permanent.
        </p>
        {competitions.length === 0 ? (
          <div className={classes.boardEmpty}>
            <EmptySlate title="No competitions found." />
          </div>
        ) : (
          <Table highlightOnHover className={classes.tableMid}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Season</Table.Th>
                <Table.Th>Participants</Table.Th>
                <Table.Th className={classes.actionsHead}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {competitions.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Text fw={600} size="sm" lineClamp={1}>
                      {c.competition_name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <StatusBadge kind="season" size="sm">
                      S{c.season_num}
                    </StatusBadge>
                  </Table.Td>
                  <Table.Td>
                    <span className={classes.participants}>
                      {c.participants
                        .map(
                          (p) =>
                            c.team_names?.[p.uid] ?? p.displayName ?? p.email,
                        )
                        .join(", ")}
                    </span>
                  </Table.Td>
                  <Table.Td className={classes.actionsCell}>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      className={classes.deleteBtn}
                      onClick={() => handleDeleteCompetition(c)}
                      aria-label={`Delete ${c.competition_name}`}
                    >
                      Delete
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Board>

      <Accordion
        order={2}
        classNames={{
          root: classes.collapse,
          item: classes.collapseItem,
          control: classes.collapseControl,
          label: classes.collapseLabel,
          chevron: classes.collapseChevron,
          panel: classes.collapsePanel,
          content: classes.collapseContent,
        }}
      >
        <Accordion.Item value="data-tools">
          <Accordion.Control>
            <span className={classes.collapseTitle}>Data Tools</span>
            <span className={classes.collapseHint}>· 3 one-off actions</span>
          </Accordion.Control>
          <Accordion.Panel>
            <Text c="dimmed" size="sm">
              One-off maintenance actions for known season uploads. Use these
              when a season record needs to be restored or refreshed.
            </Text>
            <div className={classes.toolRow}>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  upload("Season 9", async () => {
                    await setDoc(
                      doc(db, "seasons", "season_9"),
                      SEASONS.season_9,
                      { merge: true },
                    );
                    await setDoc(
                      doc(db, "challenges", "season_9"),
                      SEASON_9_CHALLENGES,
                      { merge: true },
                    );
                    await setDoc(
                      doc(db, "eliminations", "season_9"),
                      SEASON_9_ELIMINATIONS,
                      { merge: true },
                    );
                  })
                }
              >
                Restore Season 9
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  upload("Season 46", async () => {
                    await setDoc(
                      doc(db, "seasons", "season_46"),
                      SEASONS.season_46,
                      { merge: true },
                    );
                  })
                }
              >
                Restore Season 46
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() =>
                  upload("Season 50", async () => {
                    await setDoc(
                      doc(db, "seasons", "season_50"),
                      SEASONS.season_50,
                      { merge: true },
                    );
                  })
                }
              >
                Restore Season 50
              </Button>
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
};
