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

| Born document                 | Classified by                                                                                                                               | Outcome                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Draft (RTDB)                  | Every pick's name reads survivoR's, and each prop bet with a changed id is backed by that user's own pick on survivoR's ids                 | marked `born`, never remapped                                                   |
| Draft, no picks yet           | Nothing to read                                                                                                                             | left unmarked (`born_pending`) and read again next run                          |
| Draft, still live             | Not accepted automatically                                                                                                                  | left unmarked (`born_pending`)                                                  |
| Competition                   | Its draft is marked or born, and its picks and castaway prop bets equal the draft's                                                         | marked `born`; if its draft was deleted, `born_ambiguous`                       |
| Trade                         | Its competition is marked or born, and its ids fit who held what (base picks plus accepted trades) as survivoR's ids and not as provisional | marked `born`; if it fits both readings, `born_ambiguous` (see `--accept-born`) |
| Pool entry                    | Names, as for a draft                                                                                                                       | marked `born` (the pool is frozen, so none are expected)                        |
| Team assignments, ADP summary | Nothing to classify it by                                                                                                                   | `born_ambiguous`: held until `--accept-born`                                    |
| Season document, pool config  | Must exist before the cutover                                                                                                               | global problem                                                                  |

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
- **Season document first, enforced.** The season document is written first
  and the pool config second, so clients switch to survivoR's ids before
  anything else moves. If either does not apply, nothing after it is
  attempted, so picks are never remapped while clients still read the old
  season document. A plan that does not lead with them is refused. Before
  touching anything, a write or rollback first checks that both still hold
  one side of their change (untouched, or already done). If either has
  moved, nothing is written. Rollback restores them last, and not at all if
  any document rolled back before them did not restore.
- **Reruns are safe.** A document that already holds a plan's target state
  and mark counts as done (`already`), not stale. So after resolving whatever
  stopped a write or a rollback, rerunning the same plan finishes the job.
- **Aimed at one place.** The Admin SDK sends traffic to an emulator whenever
  `FIRESTORE_EMULATOR_HOST` or `FIREBASE_DATABASE_EMULATOR_HOST` is set,
  whatever project it was initialized with. Every flow refuses before reading
  unless both are set with a `demo-` project, or neither is set with a real
  one.
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
  document: a trade that fits both readings, a competition whose draft was
  deleted, or new team assignments or an ADP summary. Use it after confirming
  with the people involved that it was made on survivoR's ids. Pass it to the
  dry run and the write alike. It is never implied, and it never applies to a
  document whose names read provisional (`born_not_new`): fix that one by
  hand, or delete it, and it classifies on the next run.
- **Backups.** The first write requires a verified local backup of every
  document it can touch (see Backup). The plan file also holds `before` and
  `after` for every castaway-bearing field it touches.

### Cutover states

| State         | Meaning                                        | Season push             | ADP job                                  | Remap tool                             |
| ------------- | ---------------------------------------------- | ----------------------- | ---------------------------------------- | -------------------------------------- |
| `none`        | No cutover yet                                 | provisional bundle only | runs                                     | dry run; the first write begins it     |
| `in_progress` | Census recorded; documents are on either side  | refused                 | every cohort held                        | writes, `--finalize`, `--rollback`     |
| `finalized`   | Every census document marked, bundle rewritten | remapped bundle only    | `all_drafts` runs; `pre_premiere` frozen | forward repairs only                   |
| `rolled_back` | Every mark cleared inside the window           | provisional bundle only | `all_drafts` runs; `pre_premiere` frozen | a new first write records a new census |

Every other script that writes Season 51 castaway ids checks the ledger in
code, so a scheduled or hand-run job cannot slip through during the window:

- the season push routes: the sync, `push-all-seasons`, `new-season` and
  `batch-new-season` through `scripts/lib/firebase-push.ts`, and
  `push-seasons` through `scripts/lib/push-season-collections.ts` (it writes
  result collections directly, so it has its own call to the same gate);
- the ADP job;
- `create-pool --write` (with or without `--overwrite`), whose roster
  follows the season push rule, and `repair-pool-picks --write`, which
  refuses a pool id it cannot parse and holds during a cutover. Both check
  the ledger in the same Firestore transaction as their writes;
- the ADP job, whose writes each re-read the ledger in their own transaction
  and refuse if the cutover state moved since the job planned (for instance
  a cutover began while it computed);
- `seed-competition`, which refuses while a cutover is in progress;
- the legacy `migrate-to-castaway-id --upload`, which refuses once any
  cutover has begun or finished. The #279 decision (publishing Season
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

## Backup: mandatory, and the first production access

Before anything else touches production, including the read-only dry run,
the cutover owner takes a **local** backup of every document the remap can
touch, verifies it independently, and restores it into the emulators. The
first `--write` refuses without it.

### Local export, not a cloud-managed snapshot

- **Cloud-managed exports stay in Google Cloud.** Examples are
  `gcloud firestore export gs://<bucket>` (a managed export into a Cloud
  Storage bucket, restored with `gcloud firestore import`, whole collections
  at a time) and the Realtime Database's automated daily backups on the Blaze
  plan. Both need a bucket and IAM, and neither is a copy on this machine.
  Either may be taken as well, but neither replaces the local backup.
- **`yarn remap-castaway-ids 51 --backup` is the local export.** It reads the
  documents with the Admin SDK and writes them to a folder on this machine.

### What it holds

The backup covers the same scope the remap reads:

- every Season 51 competition and trade;
- every Season 51 RTDB draft;
- the pool config and every entry;
- `seasons/season_51` and `team_assignments/season_51`;
- the four results documents and both ADP summaries;
- the remap ledger, if one exists.

Each document is backed up whole, not just its castaway fields.

- `firestore.json`: Firestore documents by path. Timestamps are type-tagged
  so a restore writes them back as timestamps. Any other non-JSON Firestore
  type (a reference, a geopoint, bytes) refuses the backup rather than being
  flattened.
- `rtdb.json`: RTDB drafts by path.
- `manifest.json`: the project, database URL, season, mapping hash, time,
  tool commit, counts per collection, each file's size and sha256, and each
  document's sha256.

The tool reads every file back from disk and checks it against the manifest
before it reports success.

Limits:

- It is not a point-in-time snapshot. Documents are read one after another,
  so a live draft can change between reads. The write therefore also checks
  that the backup holds every document it finds, and the plan file keeps the
  exact `before` of every field it changes.
- Firestore keeps timestamps to the microsecond, and so does the backup.
- An integer-valued double is restored as an integer.

### Where it goes, and who may see it

- **Location.** An absolute, new, empty folder outside any git work tree
  (the tool refuses anything else), under your user profile, for example
  `%USERPROFILE%\grab-your-torch-private\s51-cutover\<UTC time>`.
- **Access.**
  - On Windows, restrict the folder to yourself with
    `icacls "<dir>" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"`.
  - On macOS or Linux the tool writes the folder `0700` and the files `0600`.
- **Personal data.** The backup holds users' uids, display names, picks and
  prop bets. Never commit it, copy it to a synced or cloud folder, attach it
  to a ticket or chat, or print its contents. The tool prints counts and
  hashes only.
- **Retention.** Keep it until 30 days after `--finalize`, and until #279
  (publishing Season 51 results) has been decided and verified. Then delete
  the folder.

### Exact sequence (PowerShell, from the main checkout)

```powershell
# 0. Aim at production only: no emulator variables in this shell.
Remove-Item env:FIRESTORE_EMULATOR_HOST, env:FIREBASE_DATABASE_EMULATOR_HOST -ErrorAction SilentlyContinue

# 1. A new private folder name (the tool creates the folder).
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$env:BACKUP_DIR = Join-Path $env:USERPROFILE "grab-your-torch-private\s51-cutover\$stamp"

# 2. Local export. This is the first production access, and it is read-only.
yarn remap-castaway-ids 51 --backup $env:BACKUP_DIR --project survivor-fantasy-51c4b
icacls "$env:BACKUP_DIR" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"

# 3. Independent read-back against the manifest (local only, no network).
yarn remap-castaway-ids 51 --verify-backup $env:BACKUP_DIR

# 4. Restoration drill: throwaway emulators, then every document read back.
#    Needs Java on PATH.
node_modules/.bin/firebase emulators:exec --only firestore,database --project demo-remap-drill "yarn remap-castaway-ids 51 --restore-drill $env:BACKUP_DIR"
```

Record these in the cutover log, but never the data:

- the counts and the manifest sha256 that step 2 prints;
- that step 3 printed "Backup verified";
- that step 4 printed "Restore drill passed".

**Any failure stops the cutover.** Each case refuses with a message:

- a refused folder;
- a checksum or count mismatch;
- a drill mismatch;
- an emulator variable set in the production shell;
- a foreign project or database.

Do not continue. Fix the cause and take a new backup into a new folder. The
tool never reuses a non-empty folder.

**Freshness is bound to content.** The write accepts the backup only if all
of these hold:

- It is at most 2 hours old. This limit is fixed and does not follow
  `--max-plan-age-hours`.
- It still sits in a private folder outside any git work tree. That is
  checked again at the write, not only when the backup was made.
- For every document in scope, the canonical sha256 of the document as it
  is at the moment of the write equals the one in the manifest.

So a document created, or merely edited, since the backup refuses the write:
take a new backup and dry-run again. The remaining gap is the few seconds
between that check and the census, and any write in it is caught by the
per-document compare-and-set.

### Restoring production

Only the emulator drill is automated, deliberately. The backup's restore
code refuses any target that is not an emulator of a `demo-` project.

- **Inside the cutover window,** recovery is `--rollback`, which restores the
  plan's exact `before` values (see Recovery).
- **Otherwise,** restoring production documents from the backup is a
  separate operation that Davis must authorize explicitly. It is done per
  document, against the manifest hashes.

## Go/no-go before the write

The cutover needs Davis's explicit go-ahead, after independent review, and a
cutover owner re-briefed by Hermes. Every item must be a yes:

1. **Backup.** The local backup is taken, verified and drilled (above). This
   is the first production access; nothing before it touches production.
2. **Names.** "Angelica Loblack" is confirmed as Jelly's displayed full name
   (see Names), or a display override has been added first.
3. **Mapping.** A fresh dry run, taken after the backup, reports
   `Mapping fe734ff53fbaf8a3 ... verified` and
   `Realtime Database: belongs to the project`.
4. **Clean plan.** The plan reports 0 problems and `Cutover: none`.
5. **Live drafts: wait rather than acknowledge.** The 2026-09-26 inventory
   found four finished drafts waiting on prop bets and one started with no
   picks. The recommended course is to wait until each waiting draft has all
   its prop bets in (it then stops being live) or is confirmed abandoned.
   Acknowledging one with `--ack-live-draft` accepts that a prop bet
   submitted during the write is held as `prop_bet_epoch_unknown` and needs a
   person. A stale browser tab can also still submit old ids after the
   switch; see Residual risks.
6. **Follow-up PR ready.** The rewritten season file PR is green and not
   merged.
7. **Sync, cleanup and ADP held, and proven so.** All three are disabled,
   and the checks in the controls show it, before the backup is taken.
8. **Quiet time.** Nobody is known to be mid-draft, and nobody is editing
   Season 51 on the Admin page.

## Controls around the cutover

1. **Hold the sync workflow** until #279 is decided:
   `gh workflow disable "Sync survivoR data" -R daviseford/grab-your-torch`.
   Confirm with `gh workflow list -R daviseford/grab-your-torch --all`.
2. **Hold the draft cleanup for the whole window:**
   `gh workflow disable "Cleanup abandoned drafts" -R daviseford/grab-your-torch`,
   re-enabled after `--finalize`. The cleanup deliberately cannot touch
   Firestore (so it can never reach a pool), so it cannot read the ledger. It
   never writes a castaway id, but it deletes whole unfinished drafts, and:
   - a census draft it deletes can no longer be rolled back, which stops a
     rollback before the season document;
   - a competition whose draft it deleted needs `--accept-born`.
3. **Hold the ADP refresh for the whole window**, even though its writes also
   check the ledger in a transaction:
   `gh variable set CASTAWAY_ADP_REFRESH --body disabled -R daviseford/grab-your-torch`.
   Prove all three holds before the backup, and record the output:
   - `gh workflow list -R daviseford/grab-your-torch --all` shows `Sync survivoR data` and `Cleanup abandoned drafts` as `disabled_manually`;
   - `gh variable get CASTAWAY_ADP_REFRESH -R daviseford/grab-your-torch` prints `disabled`;
   - `gh run list -R daviseford/grab-your-torch --status in_progress` shows none of the three running.

   Restore the ADP refresh (`--body enabled`) and the cleanup only after
   `--finalize` and validation. The sync stays disabled until #279 is
   decided.

4. **No Admin page edits** to Season 51 during the window. The Admin page
   writes episodes and results from whichever season document the browser
   holds.
5. **During the write** the pool page shows text cards instead of portraits
   for castaways whose id moved, until the follow-up PR merges.

## Runbook (needs Davis's explicit go-ahead; writes production)

1. Prepare the follow-up code PR locally, with no production access:
   `yarn remap-castaway-ids 51 --rewrite-season-file`, then `yarn format`.
   CI must be green. Do not merge yet.
2. Apply the controls (sync, cleanup and ADP held) and prove them with the
   commands in Controls. These touch GitHub settings, not Firebase.
3. **Backup, verify, drill** (see Backup). This is the first production
   (Firebase) access.
4. Dry run: `yarn remap-castaway-ids 51`. Review the plan file under
   `data/migration-output/castaway-id-remap/`.
5. Go/no-go, then begin the cutover within 2 hours of the backup:
   `yarn remap-castaway-ids 51 --write --plan <file> --project survivor-fantasy-51c4b --with-backup $env:BACKUP_DIR`.
   Add `--ack-live-draft` only for a live draft knowingly accepted.
   - The write refuses unless the backup verifies, still sits in a private
     folder, is at most 2 hours old, and matches the content of every current
     document. Anything created or edited since means a new backup.
   - It then records the census, switches `seasons/season_51` first, and
     remaps every other document.
   - If the season document does not apply, nothing else is attempted:
     dry-run again and rerun.
6. Merge the follow-up PR straight away.
7. Converge: dry-run again from main. Repeat until the plan has 0 changes and
   0 problems:
   - write each change it plans;
   - resolve each problem by hand, or with `--accept-born` for a
     `born_ambiguous` document after checking with the people involved.
8. Validate: `yarn repair-pool-picks 51` (dry run) is clean. Spot-check a
   draft board, a trade, and the pool entry page.
9. Finalize from main:
   `yarn remap-castaway-ids 51 --finalize --project survivor-fantasy-51c4b`.
   Then run
   `yarn recompute-castaway-adp 51 --cohort all_drafts --write --project survivor-fantasy-51c4b`
   Then restore the ADP refresh variable to `enabled` and re-enable the draft
   cleanup, and confirm both with the commands in the controls. Leave the sync
   disabled until #279 is decided.

## Recovery

**Rollback works only inside the cutover window.** `--rollback` refuses
once the cutover is finalized. It also refuses as soon as any document
exists that was not in the census. Inside the window:

1. Keep the sync and the cleanup disabled.
2. If the follow-up PR merged, revert it on main so the bundle is
   provisional again.
3. Roll back every applied plan, newest first:
   `yarn remap-castaway-ids 51 --rollback --plan <file> --project survivor-fantasy-51c4b`.
   - It restores each document where the plan's `after` is still in place.
     The pool config and season document come last, and are left alone if
     anything before them did not restore. Clients never switch back while
     some documents still hold survivoR's ids.
   - A document reported stale changed after the write: compare it with the
     plan file and the backup, and restore it by hand.
   - Then rerun the same command. Documents already restored count as done.
4. When nothing is marked, the ledger becomes `rolled_back`, and a later
   first write records a new census (with a new backup).

**Otherwise, recover forward.**

- The next write repairs a stale pick by name.
- A duplicate, an unplaceable prop bet, or a born document on provisional
  names is held and reported. A person fixes it by hand against the plan
  file and the backup.
- A `born_ambiguous` document waits for `--accept-born`.
- Nothing is ever remapped a second time.

There is deliberately no automatic way back once users have built on
survivoR's ids.

## Guard

`scripts/lib/validate-season.ts` stops the nightly sync from regenerating a
season whose committed ids moved. It also catches a castaway whose committed
name changed (an alias) at the same moment their id was handed to someone
else, which it used to report as a harmless rename.

## Residual risks

- **Stale browser tabs.** A tab that holds an old copy of the season
  document (offline, or never refreshed) can write provisional ids after the
  switch.
  - Any later run catches picks by name.
  - It catches a nameless write (a prop bet, or a trade that fits both
    readings) only when the tool runs, and only as a problem, never as a
    silent remap.
  - Waiting for the four drafts that are waiting on prop bets, rather than
    acknowledging them, removes the largest known exposure.
- **Prop bets during the cutover** in an acknowledged live draft. They are
  reported, never guessed, but they need a person.
- **The #279 gate.** Once the cutover is finalized, re-enabling the sync
  workflow publishes Season 51 results. The code checks hold the push only
  during the cutover.
- **Client writes are not gated.** The Admin page and users' browsers cannot
  read the ledger. The controls above (a quiet time, no Admin edits) and the
  census cover them.
- **Not one transaction.** Each document is atomic with its mark, but the
  cutover as a whole is not. The census, the backup, the freshness check,
  stale detection, the prerequisite stops, repair and window-only rollback
  exist because of that.
