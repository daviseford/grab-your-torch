# survivoR Data Reference

Data source: [doehm/survivoR](https://github.com/doehm/survivoR) R package (`dev/json/`)

Base URL: `https://raw.githubusercontent.com/doehm/survivoR/master/dev/json/{table}.json`

All tables return JSON arrays. Most tables have `version` (filter to `"US"`) and `season` fields. The `castaway_id` field (format `US0001`) is the universal join key across tables. For how the automated CI pipeline fetches, transforms, and syncs this data, see [CI Auto-Sync Pipeline](solutions/workflow-issues/ci-auto-sync-pipeline-validation-and-formatting-fix.md).

## Tables We Fetch (8)

These are consumed by our pipeline in `scripts/lib/survivor-client.ts`.

### castaways.json (CRITICAL)

Core player roster. One row per castaway per season appearance.

| Field            | Type    | Notes                                                        |
| ---------------- | ------- | ------------------------------------------------------------ |
| `castaway_id`    | string  | `US0001` format, universal join key                          |
| `full_name`      | string  | Legal/display name (e.g., "Coach Wade", not "Benjamin Wade") |
| `castaway`       | string  | Short name used in other tables                              |
| `age`            | number  | Age at time of season                                        |
| `city`, `state`  | string  | Hometown                                                     |
| `episode`        | number  | Episode eliminated (or last episode for winner)              |
| `day`            | number  | Day eliminated                                               |
| `order`          | number  | Elimination order (1 = first out)                            |
| `result`         | string  | "1st voted out", "Sole Survivor", etc.                       |
| `place`          | number  | Finish placement (1 = winner)                                |
| `original_tribe` | string  | Starting tribe name                                          |
| `jury`           | boolean | Made the jury                                                |
| `finalist`       | boolean | Made FTC                                                     |
| `winner`         | boolean | Won the season                                               |

917 US rows. Seasons 1-50.

### episodes.json (HIGH)

Episode metadata with full narrative summaries.

| Field             | Type   | Notes                                   |
| ----------------- | ------ | --------------------------------------- |
| `episode`         | number | Episode number within season            |
| `episode_title`   | string | Episode title                           |
| `episode_date`    | string | Air date (ISO format)                   |
| `episode_length`  | number | Minutes                                 |
| `viewers`         | number | Viewership count                        |
| `imdb_rating`     | number | IMDB rating                             |
| `episode_summary` | string | Full narrative recap (can be very long) |

719 US rows. Seasons 1-50.

### challenge_results.json (CRITICAL)

Per-castaway, per-challenge outcomes with granular win-type flags.

| Field                     | Type    | Notes                                       |
| ------------------------- | ------- | ------------------------------------------- |
| `castaway_id`, `castaway` | string  | Player                                      |
| `episode`                 | number  | Episode number                              |
| `challenge_id`            | number  | Groups rows for the same challenge          |
| `challenge_type`          | string  | "Immunity", "Reward", "Immunity and Reward" |
| `outcome_type`            | string  | "Tribal", "Individual", "Team"              |
| `tribe`                   | string  | Player's tribe for this challenge           |
| `result`                  | string  | "Won", "Lost", "Won (immunity only)", etc.  |
| `sit_out`                 | boolean | Sat out of challenge                        |
| `won`                     | number  | 1/0 binary                                  |
| `won_tribal_reward`       | number  | 1/0                                         |
| `won_tribal_immunity`     | number  | 1/0                                         |
| `won_individual_reward`   | number  | 1/0                                         |
| `won_individual_immunity` | number  | 1/0                                         |
| `won_team_reward`         | number  | 1/0                                         |
| `won_team_immunity`       | number  | 1/0                                         |
| `won_duel`                | number  | 1/0                                         |

12,247 US rows. Seasons 1-50. The `won_*` flags enable splitting combined challenges and filtering tribal wins to the correct subset.

### vote_history.json (CRITICAL)

Every tribal council vote cast.

| Field                     | Type    | Notes                            |
| ------------------------- | ------- | -------------------------------- |
| `castaway_id`, `castaway` | string  | Who voted                        |
| `episode`                 | number  | Episode                          |
| `vote`                    | string  | Name of person voted for         |
| `vote_id`                 | string  | castaway_id of vote target       |
| `nullified`               | boolean | Vote was nullified by idol       |
| `tie`                     | boolean | Part of a tie vote               |
| `voted_out`               | string  | Person ultimately eliminated     |
| `voted_out_id`            | string  | castaway_id of eliminated player |
| `tribe`, `tribe_status`   | string  | Voter's tribe context            |

5,665 US rows. Seasons 1-50. Does NOT encode shot-in-the-dark votes (those are absent from the data).

### advantage_movement.json (CRITICAL)

Advantage lifecycle events: found, played, transferred, expired.

| Field                     | Type   | Notes                                                                             |
| ------------------------- | ------ | --------------------------------------------------------------------------------- |
| `castaway_id`, `castaway` | string | Player involved                                                                   |
| `advantage_id`            | number | Links to `advantage_details`                                                      |
| `sequence_id`             | number | Order within this advantage's lifecycle                                           |
| `episode`                 | number | Episode                                                                           |
| `event`                   | string | "Found", "Found (beware)", "Played", "Received", "Voted out with advantage", etc. |
| `sog_id`                  | number | Links to tribal council context                                                   |

591 US rows. Seasons 11-50. Note: `played_for`, `played_for_id`, `success`, `votes_nullified` fields appear on some records (especially "Played" events) but are absent on others.

### advantage_details.json (CRITICAL)

Advantage catalog: what type each advantage is.

| Field            | Type        | Notes                                                      |
| ---------------- | ----------- | ---------------------------------------------------------- |
| `advantage_id`   | number      | Join key to `advantage_movement`                           |
| `advantage_type` | string      | "Hidden Immunity Idol", "Extra Vote", "Steal a Vote", etc. |
| `location_found` | string      | "Found around camp", "On Summit journey", etc.             |
| `conditions`     | string/null | "Beware advantage" when it has a beware condition          |
| `clue_details`   | string      | Clue description                                           |

252 US rows. Seasons 11-50. The `conditions` field is the key to distinguishing beware advantages. The `advantage_type` field is the key to distinguishing idols from non-idol advantages.

Known advantage types: Advantage Menu, Amulet, Bank your Vote, Block a Vote, Challenge Advantage, Choose your Champion, Control the Vote, Extra Vote, Goodwill Advantage, Hidden Immunity Idol, Hidden Immunity Idol Half, Idol Nullifier, Inheritance Advantage, Knowledge is Power, Preventative Hidden Immunity Idol, Reward Stealer, Safety without Power, Steal a Vote, Super Idol, Vote Blocker

### tribe_mapping.json (HIGH)

Per-episode tribe assignments for every castaway.

| Field                     | Type   | Notes                           |
| ------------------------- | ------ | ------------------------------- |
| `castaway_id`, `castaway` | string | Player                          |
| `episode`                 | number | Episode                         |
| `tribe`                   | string | Tribe name                      |
| `tribe_status`            | string | "Original", "Swapped", "Merged" |

8,695 US rows. Seasons 1-50. The "Merged" status appears on the episode AFTER the merge occurs (snapshot-at-start-of-episode semantics).

### journeys.json (MODERATE)

New-era journey twist outcomes (S41+).

| Field                     | Type        | Notes                                           |
| ------------------------- | ----------- | ----------------------------------------------- |
| `castaway_id`, `castaway` | string      | Player who went on journey                      |
| `episode`                 | number      | Episode                                         |
| `reward`                  | string/null | "Extra vote", "Block a Vote", "Lost vote", null |
| `lost_vote`               | boolean     | Lost their vote as consequence                  |

86 US rows. Seasons 41-50 only.

## Tables We Don't Fetch (14)

### Potentially Useful

| Table                   | Rows  | Seasons | What it tracks                                     | Why we might want it                                       |
| ----------------------- | ----- | ------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `boot_mapping.json`     | 9,263 | S1-50   | Per-episode player status + tribe + game_status    | Alternative to tribe_mapping with richer game_status field |
| `boot_order.json`       | 913   | S1-50   | Clean elimination order with result strings        | Could replace deriving eliminations from castaways         |
| `confessionals.json`    | 7,914 | S1-50   | Per-episode confessional counts and screen time    | Optional scoring category                                  |
| `jury_votes.json`       | 1,125 | S1-49   | FTC jury votes (who voted for whom)                | Could score jury vote counts                               |
| `castaway_details.json` | 1,200 | Global  | Bio/demographics (gender, occupation, personality) | Player profiles (no `version` field — global lookup)       |

### Low/No Value for Scoring

| Table                        | Rows   | Seasons | What it tracks                                       | Why we skip it                                       |
| ---------------------------- | ------ | ------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `challenge_description.json` | 1,146  | S1-50   | Challenge names, descriptions, 30 boolean skill tags | Informational only, results are in challenge_results |
| `challenge_summary.json`     | 53,851 | S1-50   | Cross-tabulated challenge stats                      | Redundant with challenge_results (4x the rows)       |
| `castaway_scores.json`       | 893    | S1-49   | Pre-computed player rating scores                    | Author's own scoring system, we have our own         |
| `season_summary.json`        | 50     | S1-50   | One row per season (location, winner, dates)         | Season metadata, not per-episode                     |
| `season_palettes.json`       | 253    | S1-49   | Season brand hex colors                              | UI theming only                                      |
| `tribe_colours.json`         | 192    | S1-50   | Tribe hex colors                                     | UI theming only                                      |
| `viewers.json`               | 719    | S1-50   | Episode viewership/ratings                           | Redundant with episodes.json                         |
| `auction_details.json`       | 164    | S2-47   | Individual auction item purchases                    | Auctions are rare, not scored                        |
| `survivor_auction.json`      | 147    | S2-47   | Per-player auction spend totals                      | Auctions are rare, not scored                        |

## Transformation Rules

### Finale Detection

An episode should only be marked as the finale (`isFinale: true`) if a winner has been declared for the season (i.e., `castaways.winner === true` for at least one castaway). If no winner exists in the data, the season is still in progress and no episode should be flagged as the finale — even if it is the highest-numbered episode.

## Known Data Gaps

These are things survivoR does NOT track that our app scores:

| Scoring Event                                      | Why unavailable                                                                                          | Supplement                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `use_shot_in_the_dark_successfully/unsuccessfully` | Available on newer seasons via `vote_history.vote_event` + `vote_event_outcome`, but not across all eras | Derive from `vote_history`                 |
| `votes_negated_by_idol` (with count)               | `votes_nullified` field missing on most seasons                                                          | Derive from `vote_history.nullified` count |
| Some individual camp challenges                    | survivoR only tracks challenges with challenge_id                                                        | Manual entry                               |

## Name Format Differences

survivoR uses preferred/stage names rather than full legal names:

| survivoR      | Wiki/Firestore            |
| ------------- | ------------------------- |
| `Coach Wade`  | `Benjamin "Coach" Wade`   |
| `Q Burdette`  | `Quintavius "Q" Burdette` |
| `Oscar Lusth` | `Ozzy Lusth`              |

The `castaway_details.json` table has `full_name_detailed` which may include the legal name, but it lacks `version`/`season` fields (it's a global lookup).

## Pre-Premiere Cast Bootstrap (Provisional IDs)

survivoR only publishes a season once episodes air, but CBS announces the cast a few weeks earlier and the Survivor Wiki season page carries the full castaway table by then. `yarn new-season <N> --wiki-cast` reads that table (`scripts/lib/wiki-cast.ts`) when survivoR has no rows and shapes it like `castaways.json`, so the rest of the pipeline runs unchanged.

The `castaway_id`s it assigns are **provisional**. survivoR numbers each season's new castaways sequentially after the highest existing id, in case-insensitive alphabetical order of `full_name`; seasons 47, 48, and 49 all follow that rule exactly (for example S49: `US0734 Alex Moore` ... `US0741 Matt Williams`, `US0742 MC Chukwujekwu` ... `US0751 Steven Ramm`). Returning players keep their existing id.

Because drafts and competitions key on `castaway_id`, a wrong guess must never be applied silently. `validateSeasonData` compares the regenerated cast against the committed `SEASON_XX_CASTAWAY_LOOKUP` and fails the sync when a committed id disappears or a committed name comes back under a different id (a same-id rename is only a warning). If that ever fires, the fix is a one-off migration of the affected competition and draft documents to survivoR's ids, then re-running the sync.
