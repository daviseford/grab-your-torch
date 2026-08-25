import { PlayerScoring } from "../types";

export type ScoringCategory =
  | "Challenges"
  | "Milestones"
  | "Idols"
  | "Advantages"
  | "Other";

export type CategorizedPlayerScoring = PlayerScoring & {
  category: ScoringCategory;
};

export const BASE_PLAYER_SCORING: CategorizedPlayerScoring[] = [
  // --- Challenges ---
  {
    action: "duel",
    fixed_value: 2,
    description: "Win a duel (Redemption Island, Edge of Extinction, etc.).",
    category: "Challenges",
  },
  {
    action: "reward",
    fixed_value: 2,
    description: "Win an individual reward challenge.",
    category: "Challenges",
  },
  {
    action: "team_reward",
    fixed_value: 1,
    description: "Win a team or tribal reward challenge.",
    category: "Challenges",
  },
  {
    action: "immunity",
    fixed_value: 3,
    description: "Win an individual immunity challenge.",
    category: "Challenges",
  },
  {
    action: "team_immunity",
    fixed_value: 2,
    description: "Win a team or tribal immunity challenge.",
    category: "Challenges",
  },
  // --- Milestones ---
  {
    action: "eliminated",
    description:
      "1 point awarded per episode number (e.g. 6 points for Episode 6 elimination). In a multi-elimination episode, later eliminations get +0.5 each (e.g. 6.5 for the second boot).",
    category: "Milestones",
  },
  {
    action: "make_merge",
    fixed_value: 2,
    description: "Make it to the merge.",
    category: "Milestones",
  },
  {
    action: "make_final_tribal_council",
    fixed_value: 4,
    description: "Make it to the Final Tribal Council. Even as a goat.",
    category: "Milestones",
  },
  {
    action: "win_survivor",
    fixed_value: 20,
    description: "Become the Sole Survivor.",
    category: "Milestones",
  },
  {
    action: "medically_evacuated",
    fixed_value: 5,
    description: "Production pulls them out for medical reasons.",
    category: "Milestones",
  },
  {
    action: "ejected",
    fixed_value: -5,
    description: "Removed from the game by production.",
    category: "Milestones",
  },
  {
    action: "quitter",
    fixed_value: -2,
    description:
      "Contestant makes production pull them out because they are a crybaby.",
    category: "Milestones",
  },
  // --- Idols ---
  {
    action: "find_idol",
    fixed_value: 1,
    description: "Find a Hidden Immunity Idol.",
    category: "Idols",
  },
  {
    action: "use_idol",
    fixed_value: 2,
    description: "Play a Hidden Immunity Idol at Tribal Council.",
    category: "Idols",
  },
  {
    action: "votes_negated_by_idol",
    fixed_value: 1,
    multiplier: true,
    description: "Number of votes negated by playing an idol at Tribal.",
    category: "Idols",
  },
  {
    action: "find_idol_nullifier",
    fixed_value: 2,
    description: "Find an Idol Nullifier.",
    category: "Idols",
  },
  {
    action: "use_idol_nullifier",
    fixed_value: 4,
    description: "Play an Idol Nullifier against another player.",
    category: "Idols",
  },
  {
    action: "win_idol",
    fixed_value: 1,
    description: "Win an idol from a journey or challenge.",
    category: "Idols",
  },
  // --- Advantages ---
  {
    action: "find_extra_vote",
    fixed_value: 1,
    description: "Find an Extra Vote advantage.",
    category: "Advantages",
  },
  {
    action: "use_extra_vote",
    fixed_value: 2,
    description: "Play an Extra Vote at Tribal Council.",
    category: "Advantages",
  },
  {
    action: "find_steal_a_vote",
    fixed_value: 2,
    description: "Find a Steal a Vote advantage.",
    category: "Advantages",
  },
  {
    action: "use_steal_a_vote",
    fixed_value: 3,
    description: "Play a Steal a Vote at Tribal Council.",
    category: "Advantages",
  },
  {
    action: "find_block_a_vote",
    fixed_value: 2,
    description: "Find a Block a Vote advantage.",
    category: "Advantages",
  },
  {
    action: "use_block_a_vote",
    fixed_value: 3,
    description: "Play a Block a Vote at Tribal Council.",
    category: "Advantages",
  },
  {
    action: "find_bank_your_vote",
    fixed_value: 2,
    description: "Find a Bank your Vote advantage.",
    category: "Advantages",
  },
  {
    action: "use_bank_your_vote",
    fixed_value: 4,
    description: "Bank your vote for a future Tribal Council.",
    category: "Advantages",
  },
  {
    action: "find_knowledge_is_power",
    fixed_value: 2,
    description: "Find a Knowledge is Power advantage.",
    category: "Advantages",
  },
  {
    action: "use_knowledge_is_power",
    fixed_value: 4,
    description: "Play Knowledge is Power to steal an idol or advantage.",
    category: "Advantages",
  },
  {
    action: "find_safety_without_power",
    fixed_value: 2,
    description: "Find a Safety without Power advantage.",
    category: "Advantages",
  },
  {
    action: "use_safety_without_power",
    fixed_value: 4,
    description: "Use Safety without Power to be safe but lose your vote.",
    category: "Advantages",
  },
  {
    action: "find_control_the_vote",
    fixed_value: 2,
    description: "Find a Control the Vote advantage.",
    category: "Advantages",
  },
  {
    action: "use_control_the_vote",
    fixed_value: 4,
    description: "Use Control the Vote at Tribal Council.",
    category: "Advantages",
  },
  {
    action: "find_amulet",
    fixed_value: 2,
    description: "Find an Amulet advantage.",
    category: "Advantages",
  },
  {
    action: "use_amulet",
    fixed_value: 3,
    description: "Play an Amulet advantage at Tribal Council.",
    category: "Advantages",
  },
  {
    action: "find_challenge_advantage",
    fixed_value: 2,
    description: "Find a Challenge Advantage.",
    category: "Advantages",
  },
  {
    action: "use_challenge_advantage",
    fixed_value: 3,
    description: "Play a Challenge Advantage.",
    category: "Advantages",
  },
  {
    action: "find_other_advantage",
    fixed_value: 2,
    description: "Find a rare or one-off advantage.",
    category: "Advantages",
  },
  {
    action: "use_other_advantage",
    fixed_value: 3,
    description: "Play a rare or one-off advantage.",
    category: "Advantages",
  },
  {
    action: "win_extra_vote",
    fixed_value: 1,
    description: "Win an Extra Vote from a journey or challenge.",
    category: "Advantages",
  },
  {
    action: "win_steal_a_vote",
    fixed_value: 2,
    description: "Win a Steal a Vote from a journey or challenge.",
    category: "Advantages",
  },
  {
    action: "win_block_a_vote",
    fixed_value: 2,
    description: "Win a Block a Vote from a journey or challenge.",
    category: "Advantages",
  },
  {
    action: "win_other_advantage",
    fixed_value: 2,
    description: "Win a rare or one-off advantage from a journey or challenge.",
    category: "Advantages",
  },
  {
    action: "voted_out_with_idol",
    fixed_value: -1,
    description: "Voted out while holding an unplayed idol.",
    category: "Idols",
  },
  {
    action: "voted_out_with_advantage",
    fixed_value: -0.5,
    description: "Voted out while holding an unplayed advantage.",
    category: "Advantages",
  },
  // --- Other ---
  {
    action: "use_shot_in_the_dark_unsuccessfully",
    fixed_value: 1,
    description: "It was worth a shot.",
    category: "Other",
  },
  {
    action: "use_shot_in_the_dark_successfully",
    fixed_value: 6,
    description: "Buy a lottery ticket if you pull this off.",
    category: "Other",
  },
  {
    action: "find_beware_advantage",
    fixed_value: 1,
    description:
      "The player finds the Beware advantage. They can pass it to someone else with no penalty.",
    category: "Other",
  },
  {
    action: "accept_beware_advantage",
    fixed_value: 1,
    description:
      "The player accepts the Beware advantage and begins playing under its conditions.",
    category: "Other",
  },
  {
    action: "fulfill_beware_advantage",
    fixed_value: 2,
    description:
      "The player fulfills the terms and escapes the Beware part of the advantage.",
    category: "Other",
  },
  {
    action: "go_on_journey",
    fixed_value: 0.5,
    description: "This one's easy. Just go on a boat ride.",
    category: "Other",
  },
  {
    action: "journey_risked_vote",
    fixed_value: 1,
    description: "Risked their vote on a journey.",
    category: "Other",
  },
  {
    action: "journey_won_game",
    fixed_value: 1,
    description: "Won the journey game.",
    category: "Other",
  },
  {
    action: "journey_lost_vote",
    fixed_value: -1,
    description: "Lost their vote on a journey.",
    category: "Other",
  },
  {
    action: "win_fire_making",
    fixed_value: 5,
    description: "Won fire-making challenge.",
    category: "Other",
  },
];
