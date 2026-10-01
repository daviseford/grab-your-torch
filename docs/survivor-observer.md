# survivoR observer

One scheduled workflow, `.github/workflows/survivor-observer.yml`, that watches survivoR, imports a finished episode through a pull request, and publishes it only after review. It replaces two workflows: the daily `Sync survivoR data` import and the `survivoR data radar` email. Until it is switched to live, those two keep running.

## What it does

Every 30 minutes (at :07 and :37) a check job asks whether anything could have changed. It checks out nothing and installs nothing; it makes about ten GitHub API calls. It starts the full job only when:

- survivoR's `dev/json` tree differs from the one the radar last recorded;
- a sync pull request has no `ci` run on its head commit, has a finished `ci` run nobody was emailed about, or has an approval on its head;
- a merged sync pull request is still waiting to publish;
- it is the 14:00 UTC run (always full, like the old daily sync, so a transformer change on `main` is still picked up when survivoR is quiet);
- or it was started by hand.

Any API error in the check means a full run, never a skipped one.

The full job pins one survivoR commit and then, in order:

1. **Radar.** Fingerprints every US table for every season at that commit and emails any change, exactly as the radar workflow did (see `docs/survivor-data-radar.md`): same state issue, same at-least-once delivery, same fail-closed rules. One addition: a newer survivoR commit with nothing in scope changed is recorded without an email, so the check job can skip it next time.
2. **Sync.** Regenerates the newest season at the pinned commit with `--no-push`. It never touches Firestore. If survivoR has started a newer episode but not finished it, the sync holds and writes nothing (see "Completeness").
3. **Pull request.** Opens or refreshes `auto/survivor-sync-season-<N>`. It pushes only when the content changed, so an approval on an unchanged head survives. The description carries a marker with the survivoR commit and `dev/json` tree it was built from.
4. **Gate.** Evaluates each open sync pull request (`scripts/lib/survivor-observer.ts`). It dispatches `ci` onto the branch when the head has no run (a push by the workflow token starts no `pull_request` run, and `ci` is a required check), closes a pull request `main` already matches, and emails each new state once.
5. **Merge.** Only a pull request that passed every gate, at the exact head commit the gate evaluated (`--match-head-commit`), and only after its "publishing" email was delivered.

A separate publish job then checks out `main`, confirms the merge commit is on it, runs `scripts/publish-season.ts <N>` (the same Firestore write the old sync made, castaway id cutover gate included), and only after that succeeds dispatches the hosting redeploy and the pool standings recompute for that season. A merge by the workflow token triggers neither on its own.

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
| Gate passed, about to merge                                                                | "publishing" (merge waits for delivery) |
| Publish finished or failed                                                                 | "published" / "FAILED"                  |

Each pull request notice is sent once per head commit and recorded as a bot comment on the pull request after delivery. An undelivered notice is re-sent by the next run. A run with any failure ends red.

## Activation

Merging changes nothing until the repository variable is set. In Settings > Secrets and variables > Actions:

1. Variable `SURVIVOR_SYNC_REVIEWERS`: the GitHub logins allowed to approve a publication, separated by commas (for example `daviseford`).
2. The radar's secrets `SMTP_USERNAME`, `SMTP_PASSWORD` and variable `SURVIVOR_RADAR_EMAIL_TO`, and the existing secret `FIREBASE_ADMIN_SERVICE_ACCOUNT`, are reused.
3. Actions > survivoR observer > Run workflow with `test_email` ticked. One test email arrives; nothing else happens.
4. Actions > survivoR observer > Run workflow with the defaults (a shadow run). The job summary shows the radar decision (expect `unchanged`), the sync result and the gate decisions. Nothing is sent, recorded, opened, merged or published.
5. Variable `SURVIVOR_OBSERVER` = `shadow`. The schedule now runs read-only beside the old sync and radar. Leave it for at least a day and compare: the check job should mostly skip, and every full run's summary should agree with what the old workflows did.
6. Variable `SURVIVOR_OBSERVER` = `live`. From the next run the observer acts, and the old sync and radar jobs stand down (they check the same variable). Watch the first live full run (the next 14:00 UTC run, or start one by hand with `dry_run` unticked).

## Rollback

Set `SURVIVOR_OBSERVER` to `shadow` (or delete it). The observer stops acting on its next run, and the old sync and radar resume on their own schedules. Nothing needs disabling or re-enabling. The radar state issue is shared, so neither side re-baselines or re-sends.

The old sync, while it runs, is in a safe mode: it holds partial episodes, never writes Firestore and never merges its own pull request. A pull request it opens is published by merging it and then running `yarn tsx scripts/publish-season.ts <N>`, or by switching the observer to live, which adopts it (it rewrites the description with its marker and runs the gates).

## Retiring the old workflows

Running both forever is not the plan. Once the observer has been live for one full aired episode, published end to end (review email, approval, merge, publish, standings), open a pull request that deletes `sync-survivor-data.yml` and `survivor-data-radar.yml`, removes their stand-down checks and the `workflow_run` trigger on "Sync survivoR data" in `recompute-pool-standings.yml`, and updates this page and `docs/survivor-data-radar.md`. After that, rollback means reverting that pull request.

## Recovering

- **Publish failed.** The pull request is merged and labelled `observer-publish-failed`; production still has the previous data. Fix the cause (a castaway id cutover in progress refuses every push, by design), then move the label back to `observer-publish-pending`. The next check sees it and publishes from `main`. Publishing again is harmless.
- **Merge refused.** The run is red and the pull request stays open with its approval. Find the cause in the run log; the next run retries.
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
