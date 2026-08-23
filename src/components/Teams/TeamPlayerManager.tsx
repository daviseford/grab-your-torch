import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Select,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconCheck, IconX } from "@tabler/icons-react";
import { doc, setDoc } from "firebase/firestore";
import { CSSProperties, useId, useState } from "react";
import { db } from "../../firebase";
import { useEliminations } from "../../hooks/useEliminations";
import { useSeason } from "../../hooks/useSeason";
import { useTeamAssignments } from "../../hooks/useTeamAssignments";
import { useTeams } from "../../hooks/useTeams";
import { CastawayId, Team, TeamAssignmentSnapshot } from "../../types";
import classes from "./Teams.module.css";

const NO_TEAM_ID = "__no_team__";

const DraggablePlayerCard = ({
  castawayId,
  displayName,
  img,
}: {
  castawayId: CastawayId;
  displayName: string;
  img?: string;
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: castawayId });

  const style = {
    transform: transform
      ? `translate(${transform.x}px, ${transform.y}px)`
      : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[classes.chip, isDragging && classes.chipDragging]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={classes.grip} aria-hidden="true" />
      {img && (
        <img
          src={img}
          alt=""
          className={classes.chipImg}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
      <span className={classes.chipName}>{displayName}</span>
    </div>
  );
};

const PlayerDragOverlay = ({ displayName }: { displayName: string }) => (
  <div className={`${classes.chip} ${classes.chipOverlay}`}>
    <span className={classes.grip} aria-hidden="true" />
    <span className={classes.chipName}>{displayName}</span>
  </div>
);

type DroppableColumnProps = {
  id: string;
  title: string;
  color: string | null;
  players: CastawayId[];
  resolveName: (id: CastawayId) => string;
  resolveImg: (id: CastawayId) => string | undefined;
};

const DroppableColumn = ({
  id,
  title,
  color,
  players,
  resolveName,
  resolveImg,
}: DroppableColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      role="group"
      aria-label={title}
      className={[
        classes.col,
        color ? classes.colTribe : classes.colNone,
        isOver && classes.colOver,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--tribe": color ?? undefined } as CSSProperties}
    >
      <div className={classes.colHead}>
        {color && (
          <span
            className={classes.swatch}
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        )}
        {title}
        <span className={classes.colCount}>{players.length}</span>
      </div>

      <div className={classes.colList}>
        {players.map((cid) => (
          <DraggablePlayerCard
            key={cid}
            castawayId={cid}
            displayName={resolveName(cid)}
            img={resolveImg(cid)}
          />
        ))}

        {players.length === 0 && (
          <div className={classes.colEmpty}>Drop players here</div>
        )}
      </div>
    </div>
  );
};

export const TeamPlayerManager = () => {
  const { data: season } = useSeason();
  const { data: teams } = useTeams(season?.id);
  const { data: assignments } = useTeamAssignments(season?.id);
  const { data: eliminations } = useEliminations(season?.id);
  const headingId = useId();

  const [episodeNum, setEpisodeNum] = useState<number>(1);
  const [localAssignments, setLocalAssignments] =
    useState<TeamAssignmentSnapshot | null>(null);
  const [activePlayer, setActivePlayer] = useState<CastawayId | null>(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const teamList = Object.values(teams || {});

  // Filter out players eliminated before this episode (players eliminated
  // during this episode were still on a team at the start of the episode)
  const eliminatedBefore = new Set(
    Object.values(eliminations)
      .filter((e) => e.episode_num < episodeNum)
      .map((e) => e.castaway_id),
  );
  const castawayIds = (season?.players.map((p) => p.castaway_id) ?? []).filter(
    (cid) => !eliminatedBefore.has(cid),
  );

  const resolveName = (cid: CastawayId): string =>
    season?.castawayLookup?.[cid]?.full_name ?? cid;

  const resolveImg = (cid: CastawayId): string | undefined =>
    season?.players.find((p) => p.castaway_id === cid)?.img || undefined;

  // Build snapshot: prefer local edits, then saved data, then all null
  const getSnapshot = (): TeamAssignmentSnapshot => {
    if (localAssignments) return localAssignments;

    const saved = assignments[String(episodeNum)];
    if (saved) return saved;

    // Default: all players unassigned
    const snapshot: TeamAssignmentSnapshot = {};
    castawayIds.forEach((cid) => {
      snapshot[cid] = null;
    });
    return snapshot;
  };

  const snapshot = getSnapshot();

  // Group players by team
  const getPlayersByContainer = (): Record<string, CastawayId[]> => {
    const groups: Record<string, CastawayId[]> = {};

    teamList.forEach((t) => {
      groups[t.id] = [];
    });
    groups[NO_TEAM_ID] = [];

    castawayIds.forEach((cid) => {
      const teamId = snapshot[cid];
      if (teamId && groups[teamId]) {
        groups[teamId].push(cid);
      } else {
        groups[NO_TEAM_ID].push(cid);
      }
    });

    return groups;
  };

  const playersByContainer = getPlayersByContainer();

  const handleDragStart = (event: DragStartEvent) => {
    setActivePlayer(event.active.id as CastawayId);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActivePlayer(null);

    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as CastawayId;
    const targetContainer = over.id as string;

    // over.id is always a droppable container since we only use useDroppable
    if (!playersByContainer[targetContainer]) return;

    const newSnapshot = { ...snapshot };
    newSnapshot[activeId] =
      targetContainer === NO_TEAM_ID ? null : (targetContainer as Team["id"]);
    setLocalAssignments(newSnapshot);
  };

  const handleSave = async () => {
    if (!season) return;
    setSaving(true);

    try {
      const ref = doc(db, `team_assignments/${season.id}`);
      await setDoc(ref, { [String(episodeNum)]: snapshot }, { merge: true });

      notifications.show({
        title: "Team assignments saved",
        message: `Episode ${episodeNum} assignments updated`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      setLocalAssignments(null);
    } catch (err) {
      notifications.show({
        title: "Failed to save team assignments",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }

    setSaving(false);
  };

  const handleCopyPreviousEpisode = () => {
    const prevEp = episodeNum - 1;
    const prevSnapshot = assignments[String(prevEp)];
    if (prevSnapshot) {
      // Ensure all current players are represented
      const merged: TeamAssignmentSnapshot = {};
      castawayIds.forEach((cid) => {
        merged[cid] = prevSnapshot[cid] ?? null;
      });
      setLocalAssignments(merged);
    }
  };

  const handleMoveAllToNoTeam = () => {
    const newSnapshot: TeamAssignmentSnapshot = {};
    castawayIds.forEach((cid) => {
      newSnapshot[cid] = null;
    });
    setLocalAssignments(newSnapshot);
  };

  const handleManualAssignmentChange = (
    castawayId: CastawayId,
    value: string | null,
  ) => {
    const newSnapshot = { ...snapshot };
    newSnapshot[castawayId] =
      value && value !== NO_TEAM_ID ? (value as Team["id"]) : null;
    setLocalAssignments(newSnapshot);
  };

  const handleEpisodeChange = (val: string | number) => {
    setEpisodeNum(Number(val));
    setLocalAssignments(null);
  };

  if (!season) return null;

  if (teamList.length === 0) {
    return (
      <Alert icon={<IconAlertCircle />} title="No Teams" color="league">
        Create teams above before assigning players.
      </Alert>
    );
  }

  const currentEpisode = season.episodes.find((e) => e.order === episodeNum);
  const isMergeEpisode =
    currentEpisode?.merge_occurs || currentEpisode?.post_merge;

  return (
    <section className={classes.section} aria-labelledby={headingId}>
      <div className={classes.head}>
        <Title order={2} id={headingId} className={classes.headTitle}>
          Team Assignments by Episode
        </Title>
        <p className={classes.sub}>
          Drag players between columns or use the manual assignment list below,
          then save when done.
        </p>
      </div>

      <div className={classes.tools}>
        <NumberInput
          label="Episode #"
          min={1}
          max={season.episodes.length || undefined}
          value={episodeNum}
          onChange={handleEpisodeChange}
          className={classes.episodeInput}
        />
        <Button
          variant="default"
          onClick={handleCopyPreviousEpisode}
          disabled={episodeNum <= 1 || !assignments[String(episodeNum - 1)]}
        >
          Copy from Ep {episodeNum - 1}
        </Button>
        <Button onClick={handleSave} loading={saving}>
          Save
        </Button>
      </div>

      {isMergeEpisode && (
        <Alert
          icon={<IconAlertCircle />}
          title="Merge Episode"
          color="orange"
          variant="light"
        >
          <Group>
            <Text size="sm">
              This is a merge/post-merge episode. Players typically have no
              team.
            </Text>
            <Button
              size="xs"
              variant="light"
              color="orange"
              onClick={handleMoveAllToNoTeam}
            >
              Move all to No Team
            </Button>
          </Group>
        </Alert>
      )}

      {assignments[String(episodeNum)] && !localAssignments && (
        <Alert color="green" variant="light">
          <Text size="sm">
            Saved assignments loaded for episode {episodeNum}.
          </Text>
        </Alert>
      )}

      {localAssignments && (
        <Alert color="yellow" variant="light">
          <Text size="sm">You have unsaved changes.</Text>
        </Alert>
      )}

      <Alert color="league" variant="light">
        <Text size="sm">
          Drag-and-drop is fastest on desktop. The manual assignment controls
          below are the fallback for touch devices, keyboard users, or quick
          spot fixes.
        </Text>
      </Alert>

      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={classes.columns}>
          {teamList.map((team) => (
            <DroppableColumn
              key={team.id}
              id={team.id}
              title={team.name}
              color={team.color}
              players={playersByContainer[team.id] || []}
              resolveName={resolveName}
              resolveImg={resolveImg}
            />
          ))}
          <DroppableColumn
            id={NO_TEAM_ID}
            title="No Team"
            color={null}
            players={playersByContainer[NO_TEAM_ID] || []}
            resolveName={resolveName}
            resolveImg={resolveImg}
          />
        </div>

        <DragOverlay>
          {activePlayer ? (
            <PlayerDragOverlay displayName={resolveName(activePlayer)} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className={classes.manual}>
        <div className={classes.head}>
          <Title order={3} className={classes.headTitle}>
            Manual Assignment
          </Title>
          <p className={classes.sub}>
            Assign players one by one without dragging.
          </p>
        </div>

        <div className={classes.manualGrid}>
          {castawayIds.map((cid) => (
            <Select
              key={cid}
              label={resolveName(cid)}
              size="sm"
              data={[
                ...teamList.map((team) => ({
                  value: team.id,
                  label: team.name,
                })),
                { value: NO_TEAM_ID, label: "No Team" },
              ]}
              value={snapshot[cid] ?? NO_TEAM_ID}
              onChange={(value) => handleManualAssignmentChange(cid, value)}
              searchable
              clearable={false}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
