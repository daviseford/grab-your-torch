import { ColorInput, Table, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconX } from "@tabler/icons-react";
import { doc, setDoc } from "firebase/firestore";
import { useState } from "react";
import { SURVIVOR_SWATCHES } from "../../constants/colors";
import { db } from "../../firebase";
import { useChallenges } from "../../hooks/useChallenges";
import { useSeason } from "../../hooks/useSeason";
import { useTeamAssignments } from "../../hooks/useTeamAssignments";
import { useTeams } from "../../hooks/useTeams";
import { useUser } from "../../hooks/useUser";
import { CastawayId, Team } from "../../types";
import { Board, EmptySlate } from "../Layout";
import {
  BoardEmpty,
  EditRowActions,
  RowActions,
} from "../SeasonAdmin/SeasonAdminParts";
import adminParts from "../SeasonAdmin/SeasonAdminParts.module.css";
import classes from "./Teams.module.css";

export const TeamCRUDTable = () => {
  const { data: season } = useSeason();
  const { data: teams } = useTeams(season?.id);
  const { data: assignments } = useTeamAssignments(season?.id);
  const { data: challenges } = useChallenges(season?.id);
  const { slimUser } = useUser();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{
    name: string;
    color: string;
  } | null>(null);

  const isTeamReferenced = (teamId: Team["id"]): boolean => {
    // Check team assignments
    for (const snapshot of Object.values(assignments)) {
      for (const assignedTeamId of Object.values(snapshot)) {
        if (assignedTeamId === teamId) return true;
      }
    }
    // Check challenges
    for (const challenge of Object.values(challenges)) {
      if (challenge.winning_team_id === teamId) return true;
    }
    return false;
  };

  const handleDelete = async (team: Team) => {
    if (!slimUser?.isAdmin) return;

    const referenced = isTeamReferenced(team.id);

    modals.openConfirmModal({
      title: referenced
        ? "Team is in use -- delete and clean up references?"
        : "Do you want to delete this team?",
      children: referenced ? (
        <>
          This team is referenced by episode assignments and/or challenges.
          Deleting it will set those references to &quot;No Team&quot; (null).
        </>
      ) : (
        <Text size="sm">
          Delete team &quot;{team.name}&quot; (
          {Object.values(assignments).reduce((count, snapshot) => {
            return (
              count +
              Object.values(snapshot).filter((t) => t === team.id).length
            );
          }, 0)}{" "}
          player assignments)
        </Text>
      ),
      labels: {
        confirm: referenced ? "Delete and clean up" : "Delete",
        cancel: "Cancel",
      },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await deleteTeamWithCascade(team);
          notifications.show({
            title: "Team deleted",
            message: `Team "${team.name}" removed`,
            color: "green",
            icon: <IconCheck size={16} />,
          });
        } catch (err) {
          notifications.show({
            title: "Failed to delete team",
            message: err instanceof Error ? err.message : "Unknown error",
            color: "red",
            icon: <IconX size={16} />,
          });
        }
      },
    });
  };

  const deleteTeamWithCascade = async (team: Team) => {
    if (!season) return;

    // 1. Cascade team_assignments: null out all references to this team
    const updatedAssignments = { ...assignments };
    let assignmentsChanged = false;
    for (const [episodeKey, snapshot] of Object.entries(updatedAssignments)) {
      const updatedSnapshot = { ...snapshot };
      for (const [castawayId, teamId] of Object.entries(updatedSnapshot)) {
        if (teamId === team.id) {
          updatedSnapshot[castawayId as CastawayId] = null;
          assignmentsChanged = true;
        }
      }
      updatedAssignments[episodeKey] = updatedSnapshot;
    }
    if (assignmentsChanged) {
      const assignmentsRef = doc(db, `team_assignments/${season.id}`);
      await setDoc(assignmentsRef, updatedAssignments);
    }

    // 2. Cascade challenges: clear winning_team_id where it matches
    const updatedChallenges = { ...challenges };
    let challengesChanged = false;
    for (const challenge of Object.values(updatedChallenges)) {
      if (challenge.winning_team_id === team.id) {
        updatedChallenges[challenge.id] = {
          ...challenge,
          winning_team_id: null,
        };
        challengesChanged = true;
      }
    }
    if (challengesChanged) {
      const challengesRef = doc(db, `challenges/${season.id}`);
      await setDoc(challengesRef, updatedChallenges);
    }

    // 3. Delete the team record itself
    const ref = doc(db, `teams/${season.id}`);
    const newTeams = { ...teams };
    delete newTeams[team.id];
    await setDoc(ref, newTeams);
  };

  const startEdit = (team: Team) => {
    setEditingId(team.id);
    setEditValues({ name: team.name, color: team.color });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValues(null);
  };

  const saveEdit = async (team: Team) => {
    if (!editValues || !season) return;

    try {
      const updated: Team = {
        ...team,
        name: editValues.name,
        color: editValues.color,
      };
      const ref = doc(db, `teams/${season.id}`);
      await setDoc(ref, { [team.id]: updated }, { merge: true });

      notifications.show({
        title: "Team updated",
        message: `Team "${editValues.name}" saved`,
        color: "green",
        icon: <IconCheck size={16} />,
      });

      setEditingId(null);
      setEditValues(null);
    } catch (err) {
      notifications.show({
        title: "Failed to update team",
        message: err instanceof Error ? err.message : "Unknown error",
        color: "red",
        icon: <IconX size={16} />,
      });
    }
  };

  const rows = Object.values(teams || {}).map((team) => {
    const isEditing = editingId === team.id;

    if (isEditing && editValues) {
      return (
        <Table.Tr key={team.id} className={adminParts.editingRow}>
          <Table.Td>
            <TextInput
              size="xs"
              aria-label="Team name"
              value={editValues.name}
              onChange={(ev) =>
                setEditValues({ ...editValues, name: ev.target.value })
              }
            />
          </Table.Td>
          <Table.Td>
            <ColorInput
              size="xs"
              aria-label="Team color"
              format="hex"
              swatches={SURVIVOR_SWATCHES}
              value={editValues.color}
              onChange={(color) => setEditValues({ ...editValues, color })}
            />
          </Table.Td>
          <Table.Td className={adminParts.id}>{team.id}</Table.Td>
          {slimUser?.isAdmin && (
            <Table.Td className={adminParts.actionsCell}>
              <EditRowActions
                onSave={() => saveEdit(team)}
                onCancel={cancelEdit}
                saveLabel="Save team"
                cancelLabel="Cancel editing team"
              />
            </Table.Td>
          )}
        </Table.Tr>
      );
    }

    return (
      <Table.Tr key={team.id}>
        <Table.Td className={adminParts.name}>{team.name}</Table.Td>
        <Table.Td>
          <span className={classes.colorCell}>
            <span
              className={classes.swatch}
              style={{ backgroundColor: team.color }}
              aria-hidden="true"
            />
            <span className={adminParts.id}>{team.color}</span>
          </span>
        </Table.Td>
        <Table.Td className={adminParts.id}>{team.id}</Table.Td>
        {slimUser?.isAdmin && (
          <Table.Td className={adminParts.actionsCell}>
            <RowActions
              onEdit={() => startEdit(team)}
              onDelete={() => handleDelete(team)}
              editLabel={`Edit team ${team.name}`}
              deleteLabel={`Delete team ${team.name}`}
            />
          </Table.Td>
        )}
      </Table.Tr>
    );
  });

  return (
    <Board
      title="Teams"
      subtitle={`· ${rows.length} tribes`}
      titleAs="h2"
      dense
      flush
      scroll
    >
      <Table highlightOnHover className={adminParts.tableNarrow}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Color</Table.Th>
            <Table.Th>ID</Table.Th>
            {slimUser?.isAdmin && (
              <Table.Th className={adminParts.actionsHead}>Actions</Table.Th>
            )}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
      {rows.length === 0 && (
        <BoardEmpty>
          <EmptySlate title="No teams yet.">
            Add a team above before assigning players.
          </EmptySlate>
        </BoardEmpty>
      )}
    </Board>
  );
};
