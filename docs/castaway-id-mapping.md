# Castaway ids: survivoR vs the app

How the app identifies castaways, how that lines up with survivoR, and how to
move stored data when a provisional id turns out wrong. Season 51 is the
worked example: its cast was drafted on predicted ids, and survivoR published
different ones. Related issue: #279.

## Identity model

| Concept              | survivoR (`dev/json`)                                                                             | App                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Person key           | `castaway_id`, `US` + 4 digits, one per person for life                                           | `CastawayId` (`US${string}`), the same value; stored in every pick, trade and prop bet                   |
| Returning players    | Keep their original `castaway_id`                                                                 | Same; `previousSeasons` on `Player`                                                                      |
| Season key           | `version` = `US`, `season` = 51, `version_season` = `US51`                                        | `season_id` = `season_51`, `season_num` = 51                                                             |
| Full name            | `castaways.full_name` (per season) and `castaway_details.full_name` (per person); they can differ | `Player.full_name` = `castaways.full_name` once synced; the wiki name while provisional                  |
| Short name           | `castaways.castaway`                                                                              | `CastawayLookup[id].castaway`; `Player.nickname` when it is not the first name                           |
| New-castaway numbers | Sequential after the highest id, alphabetical by `castaway_details.full_name`                     | Predicted with the same rule, from wiki names, when a cast is bootstrapped with `--wiki-cast`            |
| Name stored with id  | n/a                                                                                               | Draft picks (`player_name`) and pool picks (`full_name`); prop bet answers and trades store the id alone |

The numbering rule is inferred, not documented upstream. Sorting new castaways
by `castaway_details.full_name` (case-insensitive) reproduces survivoR's ids
exactly for seasons 45 through 51 (Season 50 added no new castaways). Sorting
by `castaways.full_name` fails for Season 51.

## Season 51: what went wrong with the prediction

The prediction followed the right rule but sorted the wiki's names. survivoR
sorts `castaway_details.full_name`, and two of those differ from the wiki:

- Thien An Nguyen sorts as **An Nguyen** (US0754), ahead of Ana Sani.
- Jelly Loblack sorts as **Angelica Loblack** (US0756), ahead of Brady Booker.

That moved 19 of 21 ids. survivoR's ids are a **permutation of the same range**
(US0752 to US0772), so the same string now names a different person on each
side. US0754 is Ana Sani in the app and Thien An Nguyen in survivoR.

Source: [doehm/survivoR@7336413](https://github.com/doehm/survivoR/tree/7336413e39c34c31231b9fa17281a47f731837e0/dev/json)
(`castaways.json`, `castaway_details.json`; Season 51 first added in
`d4a75af`). A copy of the 21 rows is kept at
`scripts/__tests__/fixtures/survivor-us51-castaways.json`.

| Castaway                           | App (provisional) | survivoR | Changes | Matched by                    |
| ---------------------------------- | ----------------- | -------- | ------- | ----------------------------- |
| Aaliyah Puglia                     | US0752            | US0752   | no      | full name                     |
| Alexis Levine                      | US0753            | US0753   | no      | full name                     |
| Ana Sani                           | US0754            | US0755   | yes     | full name                     |
| Brady Booker                       | US0755            | US0757   | yes     | full name                     |
| Carter Krull                       | US0756            | US0758   | yes     | full name                     |
| Cristian Chavez                    | US0757            | US0759   | yes     | full name                     |
| Danny Kilby                        | US0758            | US0760   | yes     | full name                     |
| Devin Way                          | US0759            | US0761   | yes     | full name                     |
| Eric Macksoud                      | US0760            | US0762   | yes     | full name                     |
| Jelly Loblack (survivoR: Angelica) | US0761            | US0756   | yes     | short name "Jelly" + surname  |
| Jenna Doore                        | US0762            | US0763   | yes     | full name                     |
| Kristin Flickinger                 | US0763            | US0764   | yes     | full name                     |
| Lewis Kelly                        | US0764            | US0765   | yes     | full name                     |
| Linnea Capobianco                  | US0765            | US0766   | yes     | full name                     |
| Maggie Nestor                      | US0766            | US0767   | yes     | full name                     |
| Mike Pinsky                        | US0767            | US0768   | yes     | full name                     |
| Ori Jean-Charles                   | US0768            | US0769   | yes     | full name                     |
| Patt Cannaday                      | US0769            | US0770   | yes     | full name                     |
| Rob Antonson                       | US0770            | US0771   | yes     | full name                     |
| Sharonda Cox                       | US0771            | US0772   | yes     | full name                     |
| Thien An Nguyen                    | US0772            | US0754   | yes     | full name (`castaways` table) |

No Season 51 id appears in any other season upstream, and survivoR's highest
earlier US id is US0751, so there is no cross-season collision.

## Where the ids are stored

Every one of these must change together, or a user's picks point at someone
else.

| Store                                                                                    | Fields                                                                                 | Handled by                                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Firestore `competitions/{id}`                                                            | `draft_picks[].castaway_id` + `player_name`, `prop_bets[].values` (castaway questions) | `yarn remap-castaway-ids`                                                   |
| Firestore `competitions/{id}/trades/{id}`                                                | `offered_castaway_ids`, `requested_castaway_ids`                                       | `yarn remap-castaway-ids`                                                   |
| RTDB `drafts/{id}`                                                                       | `draft_picks`, `prop_bets` (live and finished drafts)                                  | `yarn remap-castaway-ids`                                                   |
| Firestore `pools/pool_season_51`                                                         | `roster`, `prop_bet_answers`                                                           | `yarn remap-castaway-ids`                                                   |
| Firestore `pools/pool_season_51/entries/{uid}`                                           | `picks`, `prop_bets`                                                                   | `yarn remap-castaway-ids`                                                   |
| Firestore `seasons/season_51` (+ `challenges`, `eliminations`, `events`, `vote_history`) | `players`, `castawayLookup`, results                                                   | regenerate the season file, then push it                                    |
| Firestore `castaway_adp/season_51_*`                                                     | keyed by castaway id (derived)                                                         | `yarn recompute-castaway-adp 51 --write --project …`                        |
| Pool standings                                                                           | handles and totals only, no ids                                                        | nothing                                                                     |
| Browser `localStorage` pool entry drafts                                                 | unsubmitted picks                                                                      | nothing: the pool froze at the premiere, so they can no longer be submitted |

The app reads a season's cast from `seasons/{id}` in Firestore, not from the
bundled season file, so the switch users see happens when that document is
pushed.

## Why the ids are remapped rather than aliased

The alternative was keeping the provisional ids forever and translating
survivoR's ids at ingestion. That avoids touching stored data now, but the
translation would be needed forever, by every script that reads survivoR, and
it breaks again the day a Season 51 castaway returns under survivoR's id.
Remapping once, while the season has aired a single episode and no scores
have been published, is the cheaper and more durable fix.

## The remap tool

`scripts/remap-castaway-ids.ts`, with its logic in
`scripts/lib/castaway-id-remap.ts`.

- **Mapping.** Matches committed castaways to survivoR's at a pinned commit, by
  full name, then `castaway_details.full_name`, then short name plus surname.
  Anything unmatched, ambiguous or claimed twice is an error and blocks
  everything.
- **One lookup per value.** Remapping is never a chain of find-and-replace
  passes, which would move a person several times in a permutation.
- **At most once.** Applying a permutation twice moves everyone again. Each
  applied document is recorded in `admin_migrations/castaway_id_remap_season_51`,
  and a document that already reads as remapped by its stored names but is not
  in that ledger is reported, not remapped again.
- **Compare-and-set.** Each document is written in a transaction only if the
  fields still equal the plan's `before`. A live draft that takes a pick in the
  meantime is reported as stale, and a fresh dry run plans it again.
- **Backup and rollback.** The dry-run plan file holds `before` and `after` for
  every changed field. `--rollback` restores `before` wherever `after` is still
  in place.
- **Refuses to write** if the plan has problems, the season does not match, or
  `--project` is not the service account's project.

## Runbook (needs Davis's go-ahead; writes production)

1. Snapshot: `yarn tsx scripts/snapshot-firestore.ts`.
2. Dry run: `yarn remap-castaway-ids 51`. Check it reports 0 problems, and
   review the plan file it writes under `data/migration-output/castaway-id-remap/`.
3. Open a PR that regenerates `src/data/season_51` from survivoR
   (`yarn new-season 51 --force`), keeping the existing images (Jelly's is
   `Jelly-Loblack.jpg`). Do not merge it yet: the nightly sync would push
   survivoR's ids to `seasons/season_51` before the picks are remapped.
4. Apply: `yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b`.
   If any are stale, dry-run again and apply the new plan.
5. Right away, from the regenerated branch, push the season:
   `yarn tsx scripts/push-seasons.ts 51`, then merge the PR. A regenerated
   file carries whatever episodes survivoR has, so this push also publishes
   those results to `seasons`, `challenges`, `eliminations`, `events` and
   `vote_history`. Publishing Season 51 results is its own decision (#279);
   if it is not yet made, regenerate from a survivoR state with no episodes or
   strip them before pushing, so that only the cast changes.
6. `yarn recompute-castaway-adp 51 --write --project survivor-fantasy-51c4b`.
7. Validate: a dry run reports 0 changes and every document already applied;
   `yarn repair-pool-picks 51` is clean; spot-check a draft board and the pool
   entry page.

Rollback: `--rollback --plan <file>` with the same plan, then push the old
season file (`git checkout` the provisional version and run step 5 from it)
and recompute ADP again.

## Guard

`scripts/lib/validate-season.ts` stops the nightly sync from regenerating a
season whose committed ids moved. It now also catches a castaway whose
committed name changed (an alias) at the same moment their id was handed to
someone else, which it used to report as a harmless rename.
