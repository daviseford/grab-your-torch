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
else. The dry run reads all of them.

| Store                                                                         | Fields                                                                                | Handled by                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Firestore `competitions/{id}`                                                 | `draft_picks[].castaway_id` + `player_name`, castaway answers in `prop_bets[].values` | remap                                                                                                              |
| Firestore `competitions/{id}/trades/{id}`                                     | `offered_castaway_ids`, `requested_castaway_ids`                                      | remap                                                                                                              |
| RTDB `drafts/{id}`                                                            | `draft_picks` (keyed by pick number from 1), `prop_bets` (keyed by uid)               | remap, keeping both containers' keys                                                                               |
| Firestore `pools/pool_season_51`                                              | `roster`, `prop_bet_answers`                                                          | remap                                                                                                              |
| Firestore `pools/pool_season_51/entries/{uid}`                                | `picks`, `prop_bets`                                                                  | remap                                                                                                              |
| Firestore `seasons/season_51`                                                 | `players[]` ids and names, `castawayLookup` keys, names and short names               | remap, first; refused if it embeds results (images and every other field stay with the person)                     |
| Firestore `team_assignments/season_51`                                        | castaway-id keys in each episode snapshot                                             | remap if it exists (it does not today)                                                                             |
| Firestore `castaway_adp/season_51_{pre_premiere,all_drafts}`                  | `castaways` keyed by id                                                               | remap; the ADP job then leaves `pre_premiere` alone (see below)                                                    |
| Firestore `challenges`, `eliminations`, `events`, `vote_history` `/season_51` | results keyed by id                                                                   | not remapped; the dry run reports a problem if any is non-empty, because results must be regenerated from survivoR |
| Bundled `src/data/season_51`                                                  | ids, names, short names                                                               | `--rewrite-season-file`, in a follow-up PR; `--finalize` requires it                                               |
| Pool standings                                                                | handles and totals only                                                               | nothing                                                                                                            |
| Browser `localStorage` pool entry drafts                                      | unsubmitted picks                                                                     | nothing: the pool froze at the premiere                                                                            |

The app reads a season's cast from `seasons/{id}` in Firestore. The bundled
file is read by the pool page (portraits), the curated bios (by name), the
Admin page and the scripts.

## Why the ids are remapped rather than aliased

The alternative was keeping the provisional ids forever and translating
survivoR's ids at ingestion. That avoids touching stored data now, but the
translation would be needed forever, by every script that reads survivoR, and
it breaks again the day a Season 51 castaway returns under survivoR's id.
Remapping once, while the season has aired a single episode and no scores
have been published, is the cheaper and more durable fix.

## Names

Two castaways read differently afterwards, because survivoR spells them
differently:

- Jelly Loblack becomes **Angelica Loblack** everywhere a full name is shown
  (draft boards, pool roster, season page). Her short name stays "Jelly" and
  her curated bio is kept by an alias in `src/utils/castawayBio.ts`.
- Thien An Nguyen keeps her full name; her short name becomes "Thien An"
  instead of "Thien".

**Open decision (go/no-go item 1).** Showing "Angelica Loblack" is the
default because survivoR is the project's authoritative source, but it has
not been confirmed. It cannot be changed by editing the committed mapping:
every run re-derives the mapping from the pinned survivoR commit and refuses
if the hash differs. Keeping "Jelly Loblack" as the displayed name would need
a separate display-name override in the app, which this PR does not add.
Decide before the write, because the write puts the full name into every
draft pick, pool pick and the season document.

## Why "unmarked" is not "provisional"

An id alone cannot say which side of the remap it is on. So the first
version marked each document as it was remapped, and read every unmarked
document as provisional. That breaks the moment the season document flips:
users keep creating drafts, competitions and trades on survivoR's ids, and
those are unmarked too. A repair run would then remap a new trade a second
time, because trades store ids without names. A new competition, whose names
read as survivoR's, was reported as a problem, and that blocked every other
repair.

So the cutover now records a **census**. The first write stores in the
ledger the path of every document that exists when it begins, and for each
RTDB draft, whose prop bets were already in. Only census documents are ever
remapped. Anything else was created later and is **born**:

| Born document       | Classified by                                                                                                                               | Outcome                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Draft (RTDB)        | Every pick's name reads survivoR's, and each prop bet with a changed id is backed by that user's own pick on survivoR's ids                 | marked `born`, never remapped                                                   |
| Draft, no picks yet | Nothing to read                                                                                                                             | left unmarked (`born_pending`) and read again next run                          |
| Draft, still live   | Not accepted automatically                                                                                                                  | left unmarked (`born_pending`)                                                  |
| Competition         | Its draft is marked or born, and its picks and castaway prop bets equal the draft's                                                         | marked `born`                                                                   |
| Trade               | Its competition is marked or born, and its ids fit who held what (base picks plus accepted trades) as survivoR's ids and not as provisional | marked `born`; if it fits both readings, `born_ambiguous` (see `--accept-born`) |
| Pool entry          | Names, as for a draft                                                                                                                       | marked `born` (the pool is frozen, so none are expected)                        |
| Anything else       | Nothing to classify it by                                                                                                                   | problem                                                                         |

A born document whose names read provisional (a client still on the old
season document) is reported `born_not_new` and never remapped
automatically. Timestamps are never used, because client clocks prove
nothing.

Every census document is marked, including ones with nothing to change,
such as an empty lobby draft. Picks later taken into it are then read as
survivoR's, and a provisional one is repaired by name.

## The remap tool

`yarn remap-castaway-ids` (`scripts/remap-castaway-ids.ts`, logic in
`scripts/lib/castaway-id-remap.ts`, ledger checks in
`scripts/lib/remap-ledger.ts`). The Firebase store and the flows are tested
against the emulators in `rules-tests/castaway-id-remap.emulator.test.ts`
(`yarn test:rules`, which CI runs).

- **Committed mapping.** `scripts/castaway-id-remaps/season_51.json` holds the
  reviewed mapping, the survivoR commit it came from, and its hash
  (`fe734ff53fbaf8a3`, covering ids, names and short names). Every run
  re-derives it from that pinned commit and refuses if anything differs.
- **One lookup per value.** Remapping is never a chain of find-and-replace
  passes, which would move a person several times in a permutation.
- **Named picks move by name.** A draft pick, pool pick or season player
  moves only when its stored name is the provisional one for its id, so a
  pick taken on survivoR's ids stays where it is. Ids stored without a name
  (prop bets, trades, ADP and team keys) move only in an unmarked census
  document, and only if none of its named picks already reads survivoR's.
  Otherwise the document is reported `mixed_old_and_new`.
- **At most once, atomically.** Each document is marked in the same
  transaction that rewrites it: a ledger entry in
  `admin_migrations/castaway_id_remap_season_51` for Firestore documents, and
  a `castaway_id_remap` marker inside the node for RTDB drafts. Each mark
  records whether the document was `remapped` or `born`. An interrupted run
  leaves each document either rewritten and marked, or untouched and
  unmarked. After an RTDB commit the tool reads the committed node back and
  checks both the fields and the mark.
- **Season document first.** The season document is written first and the
  pool config second, so clients switch to survivoR's ids before anything
  else moves. Rollback restores the season document last.
- **Compare-and-set.** A document is written only if every castaway-bearing
  field still equals the plan's `before` (deep equality, key order ignored).
  That includes fields that do not change. A document that moved on is
  reported stale and re-planned by the next dry run.
- **Refusals by scope.** A problem is either `global` or `document`:
  - `global`: non-empty season results, results embedded in the season
    document, anything wrong with the season document or the pool config, or
    a document marked under another mapping. It refuses every write.
  - `document`: it holds only that document. It also holds `--finalize`.
- **Checks on every document:**
  - Unknown ids are reported.
  - A changed id anywhere the tool does not remap is reported
    `unhandled_castaway_field`. That covers results embedded in the season
    document and castaway answers under an unknown prop bet key.
  - A repair that would put one castaway on a board twice is reported
    `duplicate_castaway` and left for a person.
  - A prop bet submitted to a census draft after the cutover began, but
    before that draft was remapped, cannot be placed. It is reported
    `prop_bet_epoch_unknown`.
- **Write guards.** `--write` refuses unless all of these hold:
  - the plan's season and mapping hash match;
  - `plan.project_id`, `--project` and the service account's project are the same;
  - the Realtime Database URL belongs to that project and is the one the plan read;
  - the cutover state (`none`, `in_progress`, `finalized`, `rolled_back`) is what the plan saw;
  - the plan is at most 6 hours old (`--max-plan-age-hours`);
  - a fresh read plans exactly the reviewed changes, with the same `--accept-born` list;
  - there is no global problem, and the first write (the one that begins the cutover) has no problem at all;
  - every live draft the plan writes is acknowledged with `--ack-live-draft drafts/<id>`.
- **`--accept-born <path>`.** The only way to mark a `born_ambiguous`
  document. Use it after confirming with the users involved that it was made
  on survivoR's ids. Pass it to the dry run and the write alike.
- **Backup.** The plan file holds `before` and `after` for every
  castaway-bearing field it touches.

### Cutover states

| State         | Meaning                                        | Season push             | ADP job                                  | Remap tool                             |
| ------------- | ---------------------------------------------- | ----------------------- | ---------------------------------------- | -------------------------------------- |
| `none`        | No cutover yet                                 | provisional bundle only | runs                                     | dry run; the first write begins it     |
| `in_progress` | Census recorded; documents are on either side  | refused                 | every cohort held                        | writes, `--finalize`, `--rollback`     |
| `finalized`   | Every census document marked, bundle rewritten | remapped bundle only    | `all_drafts` runs; `pre_premiere` frozen | forward repairs only                   |
| `rolled_back` | Every mark cleared inside the window           | provisional bundle only | `all_drafts` runs; `pre_premiere` frozen | a new first write records a new census |

The sync, `push-seasons` and `new-season` all push through
`scripts/lib/firebase-push.ts`, which checks the ledger before writing. The
ADP job checks it for each season. These are code checks, so a scheduled run
cannot slip through during the window. The #279 decision (publishing Season
51 results) is still held only by the disabled sync workflow. Once the
cutover is finalized, pushing a remapped bundle is allowed again.

### Live drafts

A live draft is one users can still write castaway ids into: started and not
finished, or finished with prop bets still to come. The dry run on 2026-09-26
found five: one started with no picks, and four finished and waiting on prop
bets (none saved as a competition).

Picks carry names, so a pick taken during the cutover is placed by name. A
prop bet stores ids alone. If one lands in a census draft between the start
of the cutover and that draft's remap, the draft is reported
`prop_bet_epoch_unknown` and held until a person resolves it. To resolve it,
ask the user, then have an admin delete that user's entry so they can submit
it again. The database rules allow a resubmission once the entry is gone.
That is why a write that touches a live draft needs `--ack-live-draft`.
Waiting for those drafts to finish, or confirming they are abandoned, avoids
it.

Born drafts that are still live are never marked automatically. They stay
unmarked and are read again by each run.

### The ADP pre-premiere cohort

The ADP job excludes any competition written after the premiere, using
Firestore's `updateTime`. The remap rewrites every Season 51 competition, so
recomputing `pre_premiere` afterwards would publish an empty cohort. Instead,
the remap permutes both ADP documents in place, and `recompute-castaway-adp`
skips `pre_premiere` for any season whose remap ledger exists. `all_drafts`
is held while the cutover is in progress and refreshes as before afterwards.

## Go/no-go before the write

The write needs Davis's explicit go-ahead. Every item must be a yes:

1. **Names.** "Angelica Loblack" is confirmed as Jelly's displayed full name
   (see Names), or a display override has been added first.
2. **Mapping.** A fresh dry run reports `Mapping fe734ff53fbaf8a3 ... verified`
   and `Realtime Database: belongs to the project`.
3. **Clean plan.** The plan reports 0 problems and `Cutover: none`. Every
   live draft it lists is finished, confirmed abandoned, or knowingly
   acknowledged.
4. **Follow-up PR ready.** The rewritten season file PR is green and not
   merged (runbook step 4).
5. **Sync held.** `Sync survivoR data` is disabled (below). The code checks
   hold it during the cutover, but only the disabled workflow holds #279
   afterwards.
6. **Snapshot taken.** `yarn tsx scripts/snapshot-firestore.ts`.
7. **Quiet time.** Nobody is known to be mid-draft.

## Controls around the cutover

1. **Hold the sync workflow** until #279 is decided:
   `gh workflow disable "Sync survivoR data" -R daviseford/grab-your-torch`,
   then confirm with `gh workflow list -R daviseford/grab-your-torch --all`.
2. **ADP refreshes** are held in code while the cutover is in progress, so no
   variable change is needed.
3. **Draft cleanup.** The weekly `Cleanup abandoned drafts` job deletes
   unfinished drafts older than seven days and backfills `created_at`. It
   deliberately cannot touch Firestore (so it can never reach a pool), which
   means it cannot read the ledger. Neither of its writes touches a castaway
   field, so it cannot mix ids, and the remap reports a deleted census draft
   as stale rather than failing. But a draft it deletes during the window
   cannot be rolled back. For a clean rollback, disable it during the window
   with `gh workflow disable "Cleanup abandoned drafts" -R daviseford/grab-your-torch`,
   and re-enable it after `--finalize`.
4. **During the write** the pool page shows text cards instead of portraits
   for castaways whose id moved. It shows a portrait only when the bundled
   name matches the roster, so this lasts until the follow-up PR merges.

## Runbook (needs Davis's explicit go-ahead; writes production)

1. Go/no-go (above), then apply the controls.
2. Dry run: `yarn remap-castaway-ids 51`. Review the plan file under
   `data/migration-output/castaway-id-remap/`.
3. Snapshot: `yarn tsx scripts/snapshot-firestore.ts`.
4. Prepare the follow-up code PR: `yarn remap-castaway-ids 51 --rewrite-season-file`,
   then `yarn format`. It changes only ids, names and short names, adds no
   episodes, and keeps every image. CI must be green. Do not merge yet.
5. Begin the cutover: `yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b`,
   plus `--ack-live-draft` for each live draft you accept. This records the
   census, switches `seasons/season_51` first, then remaps every other
   document. The cast users see switches here.
6. Merge the follow-up PR straight away, so the bundled portraits and the
   Admin page catch up.
7. Converge: dry-run again from main.
   - Write each change it plans, the same way as step 5.
   - Resolve each problem by hand as described above, or with
     `--accept-born` for a `born_ambiguous` document.
   - Repeat until the dry run plans 0 changes and reports 0 problems.
8. Validate: `yarn repair-pool-picks 51` is clean. Spot-check a draft board,
   a trade, and the pool entry page.
9. Finalize from main, so the bundle reads `remapped`:
   `yarn remap-castaway-ids 51 --finalize --project survivor-fantasy-51c4b`.
   It refuses while any census document is unmarked, any change is planned,
   any problem is open, or the bundle is not on survivoR's ids. Then run
   `yarn recompute-castaway-adp 51 --cohort all_drafts --write --project survivor-fantasy-51c4b`
   and re-enable the draft cleanup. Leave the sync disabled until #279 is
   decided.

## Recovery

**Rollback works only inside the cutover window.** `--rollback` refuses
once the cutover is finalized. It also refuses as soon as any document
exists that was not in the census. Such a document was created on
survivoR's ids, and rolling the season back underneath it would strand it on
the wrong side. Inside the window:

1. Keep the sync disabled.
2. If the follow-up PR merged, revert it on main so the bundle is
   provisional again.
3. Roll back every applied plan, newest first:
   `yarn remap-castaway-ids 51 --rollback --plan <file> --project survivor-fantasy-51c4b`.
   This restores each document where the plan's `after` is still in place,
   with the season document last, and clears the marks. A document reported
   as no longer holding the plan's values changed after the write. Inspect it
   against the plan file before touching it.
4. When nothing is marked, the ledger becomes `rolled_back`. A dry run then
   plans the full cutover again, and a later first write records a new
   census. The ledger document stays, and it keeps the ADP `pre_premiere`
   summary frozen.

**Otherwise, recover forward.** The next write repairs a stale pick by name.
A duplicate, an unplaceable prop bet or a provisional born document is held
and reported. A person fixes it by hand against the plan file and the
snapshot. Nothing is ever remapped a second time, because every rewritten
document is marked and born documents are never remapped. There is
deliberately no automatic way back once users have built on survivoR's ids.

## Guard

`scripts/lib/validate-season.ts` stops the nightly sync from regenerating a
season whose committed ids moved. It also catches a castaway whose committed
name changed (an alias) at the same moment their id was handed to someone
else, which it used to report as a harmless rename.

## Residual risks

- **Stale clients after finalize.** A client holding an old copy of the
  season document could still write provisional ids. Any later run catches
  picks by name. It catches a nameless write (a prop bet, or a trade that
  fits both readings) only when the tool runs, and only as a problem, never
  as a silent remap.
- **Prop bets during the cutover** in an acknowledged live draft. They are
  reported, never guessed, but they need a person.
- **The #279 gate.** Once the cutover is finalized, re-enabling the sync
  workflow publishes Season 51 results. The code checks hold the sync only
  during the cutover.
- **Not one transaction.** Each document is atomic with its mark, but the
  cutover as a whole is not. The census, the freshness check, stale
  detection, repair and window-only rollback exist because of that.
