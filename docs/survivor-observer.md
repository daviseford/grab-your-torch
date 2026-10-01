# survivoR observer

One scheduled workflow, `.github/workflows/survivor-observer.yml`, that watches survivoR, imports a finished episode through a pull request, and publishes it only after review. It replaces two workflows: the daily `Sync survivoR data` import and the `survivoR data radar` email. Until it is switched to live, the radar keeps running as before and the daily sync keeps running in a safe mode that never publishes (see "What merging changes").

## What it does

Every 30 minutes (at :07 and :37) a check job asks whether anything could have changed. It checks out nothing and installs nothing; it makes about ten GitHub API calls. It starts the full job only when:

- survivoR's `dev/json` tree differs from the one the radar last recorded;
- a sync pull request has no `ci` run on its head commit, has a finished `ci` run nobody was emailed about, or has an approval on its head from a listed reviewer (unless the gate already reported that head blocked);
- the previous run of this workflow failed, so a sync error or undelivered email is retried within 30 minutes;
- a merged sync pull request is still waiting to publish (a closed, unmerged one with the label is only cleaned up);
- it is the 14:00 UTC run (always full, like the old daily sync, so a transformer change on `main` is still picked up when survivoR is quiet);
- or it was started by hand.

Any API error in the check means a full run, never a skipped one.

The full job pins one survivoR commit and then, in order:

1. **Radar.** Fingerprints every US table for every season at that commit and emails any change, exactly as the radar workflow did (see `docs/survivor-data-radar.md`): same state issue, same at-least-once delivery, same fail-closed rules. One addition: a newer survivoR commit with nothing in scope changed is recorded without an email, so the check job can skip it next time.
2. **Sync.** Regenerates the newest season at the pinned commit with `--no-push`. It never touches Firestore. If survivoR has started a newer episode but not finished it, the sync holds and writes nothing (see "Completeness").
3. **Pull request.** Opens or refreshes `auto/survivor-sync-season-<N>`. It pushes only when that season's data changed, so when `main` moves on elsewhere the reviewed head, its `ci` run and its approval all stay valid. A draft opened by the old sync is adopted and marked ready. The description carries a marker with the survivoR commit and `dev/json` tree it was built from.
4. **Gate.** Evaluates each open sync pull request (`scripts/lib/survivor-observer.ts`). It dispatches `ci` onto the branch when the head has no run (a push by the workflow token starts no `pull_request` run, and `ci` is a required check), closes a pull request `main` already matches, and emails each new state once.
5. **Merge.** Only a pull request that passed every gate, at the exact head commit the gate evaluated (`--match-head-commit`), only after its "publishing" email was delivered and recorded on the pull request, and only if a fresh gate pass immediately before the merge still says merge (so an approval withdrawn, a `ci` rerun or a survivoR change in the meantime stops it). A refused merge removes the pending label again.

A separate publish job then checks out `main`, takes only pull requests the observer itself merged after recording their "publishing" notice (a label alone is not enough), confirms each merge commit is on `main`, runs `scripts/publish-season.ts <N>` (the same Firestore write the old sync made, castaway id cutover gate included), and only after that succeeds dispatches the hosting redeploy and the pool standings recompute for that season. A merge by the workflow token triggers neither on its own.

## The publication gates

All must hold on the pull request's exact head commit:

1. **Completeness.** Every new episode was complete at the pinned survivoR commit, and survivoR's `dev/json` has not changed since. A change upstream makes the pull request stale; the next full run rebuilds it, which needs new `ci` and a new approval if the content changed.
2. **Scope.** The bot's own `auto/survivor-sync-season-<N>` branch, from this repository, based on `main`, changing only `src/data/season_<N>/`. A new-season bootstrap (`auto/survivor-new-season-<N>`) is never merged automatically.
3. **Tests.** The newest `ci` check run from GitHub Actions on the head commit concluded `success`.
4. **Independent review.** A person listed in the repository variable `SURVIVOR_SYNC_REVIEWERS`, who has write access, approved the head commit, and nobody's latest review requests changes. The bot's own approval never counts.

**The observer does not review anything itself.** Gate 4 is a person. Without an approval the pull request waits indefinitely, nothing is merged and nothing is published. If `SURVIVOR_SYNC_REVIEWERS` is empty, a live run fails before doing anything.

## Completeness

`scripts/lib/episode-readiness.ts` decides whether survivoR has finished an episode. Hard rules (all must hold):

- one `episodes` row with a title and air date, and the previous episode present;
- an immunity winner in `challenge_results`;
- `challenge_description` lists the episode's challenges, and its ids match `challenge_results` both ways (this is what shows a reward challenge landed);
- someone left the game in `castaways` (or there was no vote and the next episode is listed), and the voted-out ids agree with `vote_history` both ways;
- once survivoR publishes `tribe_mapping` for the season, rows for everyone still in the game, and a merge shown in `challenge_results` is shown there too.

Checked against real data at survivoR `7336413`: 145 of 146 episodes of Seasons 41 to 51 pass. The exception is S47 Episode 6, a reward challenge survivoR describes but has no results for; that season is never synced again. The rules also hold the two real partial states found in survivoR's history: US50 Episode 10 before its challenge results landed, and US51 Episode 1 in the 45 minutes before `challenge_description` did.

**What cannot be proven.** Idol and advantage finds (`advantage_movement`) and journeys (`journeys`) are scored, but an episode can legitimately have none, and nothing upstream says "this episode had none". Cross-checks against `vote_history` had exceptions in nine real episodes, so they are listed in the pull request as notes for the reviewer, never used to hold or to pass. The reviewer checks these against the broadcast. A later survivoR correction arrives as a new sync pull request and goes through the same gates.

## Notifications

All email goes to `SURVIVOR_RADAR_EMAIL_TO` through the radar's SMTP secrets.

| Event                                                                                      | Email                                   |
| ------------------------------------------------------------------------------------------ | --------------------------------------- |
| survivoR data changed (any table, any season)                                              | Radar email, as before                  |
| Sync pull request has passing `ci` and needs a review                                      | "ready for review"                      |
| Pull request on hold (newer episode unfinished), `ci` failed, sync failed, or out of scope | "on hold" / "blocked"                   |
| Sync pull request merged by hand (not published)                                           | "merged by hand and NOT published"      |
| Gate passed, about to merge                                                                | "publishing" (merge waits for delivery) |
| Publish finished or failed                                                                 | "published" / "FAILED"                  |

Each pull request notice is sent once per head commit and recorded as a bot comment on the pull request after delivery. An undelivered notice is re-sent by the next run. A run with any failure ends red.

## What merging changes

Merging this does two things straight away, before any variable is set:

- The old daily sync switches to a safe mode. It still holds partial episodes and opens a pull request for a finished one, but it no longer writes Firestore, no longer merges anything, and opens its pull request as a draft.
- Nothing publishes a new episode automatically until the observer is live.

So switch the observer on the same day as the merge (below). If an episode lands in the gap, its draft pull request waits safely: players keep seeing the previous episode, never a partial one, and the observer adopts the draft once live. Do not merge that draft by hand: the merge would redeploy the site with the new episode while Firestore kept the old data.

## Activation (same day as the merge)

In Settings > Secrets and variables > Actions:

1. Variable `SURVIVOR_SYNC_REVIEWERS`: the GitHub logins allowed to approve a publication, separated by commas (for example `daviseford`). Each must have write access.
2. Reused as they are: secrets `SMTP_USERNAME`, `SMTP_PASSWORD`, `FIREBASE_ADMIN_SERVICE_ACCOUNT`, and variables `SURVIVOR_RADAR_EMAIL_TO`, `VITE_FIREBASE_DATABASE_URL`. A live run checks every one of them and refuses to start without them.
3. Actions > survivoR observer > Run workflow with `test_email` ticked. One test email arrives; nothing else happens.
4. Run workflow again with the defaults (a shadow run). The job summary should show the radar decision (`unchanged`), the sync for the newest season, and the gate decisions. Nothing is sent, recorded, opened, merged or published.
5. Variable `SURVIVOR_OBSERVER` = `live`. From the next run the observer acts, and the old sync and radar jobs stand down (they check the same variable). Watch the first live full run, or start one by hand with `dry_run` unticked.

`SURVIVOR_OBSERVER` = `shadow` runs the schedule read-only beside the old pair, for a longer comparison if wanted. While a sync pull request with a finished `ci` run is open, every shadow check goes full (shadow never records notices), so keep that period short.

## Rollback

The old workflows stand down by checking the variable, but that only works while they are themselves enabled. Once `sync-survivor-data.yml` and `survivor-data-radar.yml` have been disabled directly (`gh workflow disable <id>`, or the Actions UI), setting `SURVIVOR_OBSERVER` back to `shadow` or deleting it does **not** resume them on its own: a disabled workflow does not run on its schedule no matter what the variable says. Re-enable both first (`gh workflow enable <id>` with the repo's scoped `GH_CONFIG_DIR`, or the Actions UI "Enable workflow" button), confirm with `gh workflow list --all` that both show `active`, and only then set `SURVIVOR_OBSERVER` to `shadow` or delete it. The radar state issue is shared, so neither side re-baselines or re-sends. Reconcile any pending publishes (below) by hand regardless of which path you take. To restore live mode afterward, set the variable back to `live` and, once a verified live run has acted correctly, disable the two old workflows again.

This does **not** bring back automatic publishing. The old sync stays in its safe mode, so after a rollback a finished episode waits in a draft pull request, and publishing it is by hand: review it, mark it ready, merge it, and straight away run `yarn tsx scripts/publish-season.ts <N>` from an up-to-date `main` (between the merge and that command the site shows the new episode while Firestore still has the old one). Restoring the old behaviour exactly, publishing before review, means reverting this pull request, which is not recommended.

Reconcile publishing state when rolling back, because the publish job never runs in shadow mode:

1. List merged pull requests labelled `observer-publish-pending` or `observer-publish-failed`.
2. For each, check whether Firestore has its data (the season document's `data_revision` changes with every publish). If not, run `yarn tsx scripts/publish-season.ts <N>` from `main`.
3. Move its label to `observer-published`, so that switching back to live does not publish it a second time (which would be harmless, but noisy).

## Retiring the old workflows

Running both forever is not the plan. Once the observer has been live for one full aired episode, published end to end (review email, approval, merge, publish, standings), open a pull request that deletes `sync-survivor-data.yml` and `survivor-data-radar.yml`, removes their stand-down checks and the `workflow_run` trigger on "Sync survivoR data" in `recompute-pool-standings.yml`, and updates this page and `docs/survivor-data-radar.md`. After that, rollback means reverting that pull request.

## Recovering

- **Publish failed.** The pull request is merged and labelled `observer-publish-failed`; production still has the previous data. Fix the cause (a castaway id cutover in progress refuses every push, by design), then move the label back to `observer-publish-pending`. The next check publishes from `main`. Publishing again is harmless.
- **Merged by hand.** Every observer sync pull request opens with a warning not to merge it by hand. If someone merges one anyway (the GitHub button cannot be disabled for people with write access), the site gets its data on the next deploy while Firestore keeps the old data. The observer notices within 30 minutes (any merged sync pull request with its marker and no `observer-` label), emails a "merged by hand and NOT published" alert, labels it `observer-hand-merged`, and turns that run red. It never publishes it, since it skipped the review gate. Publish it by hand with `yarn tsx scripts/publish-season.ts <N>` if the data is right, or revert the merge.
- **Publish refused.** Only a pull request the observer merged, after recording its "publishing" notice for that exact head, is ever published. A merged pull request labelled by hand, or merged by a person, is moved to `observer-publish-failed` with a comment, and is published by hand if that is intended.
- **Merge refused.** The run is red, the pending label is removed again, and the pull request stays open with its approval. Find the cause in the run log; the next check retries, because the previous run failed.
- **A run failed** (a sync error, an undelivered email, a refused merge). The next check, 30 minutes later, does a full run instead of waiting for 14:00. A failure that persists turns every run red until it is fixed.
- **Stuck on hold.** survivoR has not finished an episode. Nothing to do; the next survivoR commit triggers a new check. To see the gap, read the latest run summary or the "on hold" email.

## Cost

Normal day: 48 check runs of roughly 15 seconds each, plus one full run at 14:00 UTC and one per survivoR commit, each a few minutes. That is fewer full runs than the old pair, which ran the radar twice a day (after the sync and at the 16:00 fallback) on top of the sync. While a sync pull request waits for review the checks stay fast; they go full only when its `ci` finishes, when it is approved, or when survivoR changes. In shadow mode notices are never recorded, so an open sync pull request with a finished `ci` run makes every check go full; keep the shadow period short while one is open. Every job has a timeout (5, 20 and 15 minutes).

## Running pieces locally

```sh
yarn survivor-observer upstream --out .survivor-observer       # pin survivoR
yarn tsx scripts/sync-season.ts --no-push --ref <commit>       # sync, no Firestore
yarn survivor-observer gate --result sync-result.json --out .survivor-observer  # read-only gate report
yarn tsx scripts/publish-season.ts 51 --dry-run                # show what would be published
```

`gate` needs `GITHUB_TOKEN` and `GITHUB_REPOSITORY` and changes nothing. `publish-season` without `--dry-run` writes production.
