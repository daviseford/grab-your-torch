# survivoR data radar

An email when the upstream [survivoR](https://github.com/doehm/survivoR) dataset changes: a new episode, a new season, or a correction to any historical US record. It is a notifier only. It changes nothing in the app, the repo, Firestore or the Realtime Database.

## Why the daily sync is not enough

`sync-survivor-data.yml` regenerates only the newest season's file and compares it with the committed file. The comparison keeps curated cast fields, so it sees processed app data, not upstream data. A survivoR correction to an older season, or to a table the app does not read (confessionals, viewers, boot mapping and so on), never shows up there. It also sends no email: its output is an auto-merged PR.

The radar fills that gap. It runs after every "Sync survivoR data" run on `main` (`workflow_run`, matched by that exact workflow name), whatever that run's result. A daily 16:00 UTC fallback schedule, two hours after the sync, keeps it running if the sync is renamed, disabled by hand, fails before triggering it, or runs late. It does not cover GitHub disabling scheduled workflows after repository inactivity, which stops both. On a normal day the fallback finds the state already recorded and sends nothing.

## What counts as a change

- **Scope:** every JSON table in survivoR's `dev/json/`, read at one pinned upstream commit. Only US records count: rows with `version: "US"`, plus `castaway_details` rows (that table has no version) for `US` castaway ids. Other franchises are ignored.
- **Fingerprint:** rows are grouped by table and season. Each row is canonicalized (sorted keys, null values dropped, `48.0` equal to `48`). A group's fingerprint is a SHA-256 of its sorted canonical rows plus the row count.
- **Ignored:** row order, key order, whitespace, formatting, upstream commits that touch nothing in scope (R code, docs, xlsx, other franchises).
- **Alerted:** any added, removed or edited value in scope; a new or removed table or season.

The email lists each changed table under its season, with the row count before and after, and links the upstream compare view.

## When it emails

| Situation                     | Email                           | State recorded                                           |
| ----------------------------- | ------------------------------- | -------------------------------------------------------- |
| First live run (no state yet) | No                              | Baseline                                                 |
| Nothing in scope changed      | No                              | No                                                       |
| Something changed             | Yes                             | After delivery                                           |
| Email failed twice            | No (run fails)                  | No: the next run re-sends, with anything newer folded in |
| Email sent, recording failed  | Yes (run fails)                 | No: the next run sends the same change again             |
| Email configuration missing   | No (run fails before observing) | No                                                       |
| State issue unreadable        | No (run fails)                  | No                                                       |

Delivery is at least once. A change is normally emailed a single time, but the radar prefers a duplicate email to a lost one: if the email goes out and recording the state then fails, the next run sends it again.

State lives in a bot-created issue titled `survivoR data radar state`, in a fenced block between `survivor-data-radar-state` markers. Only issues created by `github-actions[bot]` are trusted. Closing the issue is harmless. Only a missing issue starts a fresh baseline. If the issue exists but its state block is missing, malformed, or from another radar version, every run fails until the block is restored, rather than re-baselining and dropping the changes since the last record. To start over on purpose, retitle or delete the issue; the next run records a new baseline without emailing.

## Activation

Merging does not activate it. In Settings > Secrets and variables > Actions:

1. Secrets `SMTP_USERNAME` and `SMTP_PASSWORD`: a Gmail address and an app password for it (the transport is `smtp.gmail.com:465`, the same as the AoS Reminders Rules Radar).
2. Variable `SURVIVOR_RADAR_EMAIL_TO`: the address that receives the emails.
3. Optional checks, by hand (Actions > survivoR data radar > Run workflow):
   - Tick `test_email` to send one fixed test message to the recipient. It checks the email settings only: the run skips observation and records nothing.
   - Leave `dry_run` ticked to see the decision in the job summary. It sends and records nothing.
4. Variable `SURVIVOR_DATA_RADAR` = `enabled`. The next sync run (or the 16:00 UTC fallback) triggers a live radar run, which records the baseline. Emails start with the first change after that.

To pause, unset `SURVIVOR_DATA_RADAR`. Changes made while paused are reported together on the first run after resuming.

## Running it locally

```sh
yarn survivor-radar observe --out .survivor-radar --state-file .survivor-radar/prev.json
```

With `--state-file`, it compares against that file instead of the issue and writes `decision.json`, `next-state.json` and, for an alert, `subject.txt` and `body.md`. Copy `next-state.json` over the state file to advance it. It reads public GitHub endpoints; set `GITHUB_TOKEN` if anonymous rate limits get in the way.
