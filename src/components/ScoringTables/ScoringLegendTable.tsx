import { Table, Text } from "@mantine/core";
import type { CSSProperties } from "react";
import { BASE_PLAYER_SCORING } from "../../data/scoring";
import classes from "./ScoringLegendTable.module.css";

/**
 * Table groups with the semantic scoring-category color each one carries
 * (blue challenges, teal milestones, yellow idols, grape advantages, gray
 * for everything else), matching the category colors used app-wide.
 */
const SCORING_CATEGORIES = [
  {
    label: "Challenges",
    color: "blue",
    actions: ["reward", "team_reward", "immunity", "team_immunity", "duel"],
  },
  {
    label: "Milestones",
    color: "teal",
    actions: [
      "make_merge",
      "make_final_tribal_council",
      "win_survivor",
      "medically_evacuated",
      "ejected",
      "quitter",
    ],
  },
  {
    label: "Idols",
    color: "yellow",
    actions: [
      "find_idol",
      "find_idol_nullifier",
      "use_idol",
      "use_idol_nullifier",
      "win_idol",
    ],
  },
  {
    label: "Advantages Found",
    color: "grape",
    actions: [
      "find_extra_vote",
      "find_steal_a_vote",
      "find_block_a_vote",
      "find_bank_your_vote",
      "find_knowledge_is_power",
      "find_safety_without_power",
      "find_control_the_vote",
      "find_amulet",
      "find_challenge_advantage",
      "find_other_advantage",
    ],
  },
  {
    label: "Advantages Used",
    color: "grape",
    actions: [
      "use_extra_vote",
      "use_steal_a_vote",
      "use_block_a_vote",
      "use_bank_your_vote",
      "use_knowledge_is_power",
      "use_safety_without_power",
      "use_control_the_vote",
      "use_amulet",
      "use_challenge_advantage",
      "use_other_advantage",
    ],
  },
  {
    label: "Advantages Won",
    color: "grape",
    actions: [
      "win_extra_vote",
      "win_steal_a_vote",
      "win_block_a_vote",
      "win_other_advantage",
    ],
  },
  {
    label: "Tribal Council and Risk",
    color: "gray",
    actions: [
      "votes_negated_by_idol",
      "eliminated",
      "voted_out_with_idol",
      "voted_out_with_advantage",
      "use_shot_in_the_dark_unsuccessfully",
      "use_shot_in_the_dark_successfully",
      "win_fire_making",
    ],
  },
  {
    label: "Journeys",
    color: "gray",
    actions: [
      "go_on_journey",
      "journey_risked_vote",
      "journey_won_game",
      "journey_lost_vote",
    ],
  },
  {
    label: "Beware Advantages",
    color: "gray",
    actions: [
      "find_beware_advantage",
      "accept_beware_advantage",
      "fulfill_beware_advantage",
    ],
  },
] as const;

const scoringByAction = new Map(
  BASE_PLAYER_SCORING.map((entry) => [entry.action, entry]),
);

/** Convert "find_extra_vote" → "Find Extra Vote" */
function toTitleCase(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const ScoringLegendTable = () => {
  const rows = SCORING_CATEGORIES.flatMap((category) => {
    const categoryRows = category.actions
      .map((action) => scoringByAction.get(action))
      .filter((entry) => entry != null)
      .map((x) => (
        <Table.Tr key={x.action}>
          <Table.Td>
            <span className={classes.action}>{toTitleCase(x.action)}</span>
          </Table.Td>
          <Table.Td className={classes.descriptionCell}>
            <Text size="sm">{x.description}</Text>
          </Table.Td>
          <Table.Td ta="center">
            {x.fixed_value != null ? (
              <span
                className={`${classes.points} ${x.fixed_value > 0 ? "" : classes.negative}`}
                aria-label={`${x.fixed_value > 0 ? "positive" : "negative"} ${Math.abs(x.fixed_value)} points`}
              >
                {x.fixed_value > 0 ? "+" : ""}
                {x.fixed_value}
              </span>
            ) : (
              <Text span size="sm" c="dimmed" aria-label="variable points">
                varies
              </Text>
            )}
          </Table.Td>
        </Table.Tr>
      ));

    if (categoryRows.length === 0) {
      return [];
    }

    return [
      <Table.Tr
        key={`category-${category.label}`}
        className={classes.categoryRow}
      >
        <Table.Th
          colSpan={3}
          scope="colgroup"
          className={classes.categoryCell}
          style={
            {
              "--category-color": `var(--mantine-color-${category.color}-5)`,
            } as CSSProperties
          }
        >
          <span className={classes.categoryLabel}>
            <span className={classes.categoryDot} aria-hidden="true" />
            {category.label}
          </span>
        </Table.Th>
      </Table.Tr>,
      ...categoryRows,
    ];
  });

  return (
    <div className={classes.tableWrapper}>
      <Table
        verticalSpacing="xs"
        highlightOnHover
        highlightOnHoverColor="var(--gyt-panel-2)"
        stickyHeader
        stickyHeaderOffset="var(--gyt-header-height, 0)"
        aria-label="Scoring reference: actions and point values"
        className={classes.table}
      >
        <Table.Thead className={classes.stickyHead}>
          <Table.Tr>
            <Table.Th>Action</Table.Th>
            <Table.Th className={classes.descriptionCell}>Description</Table.Th>
            <Table.Th ta="center" w={80}>
              Points
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </div>
  );
};
