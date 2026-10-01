# How to Add a New Season

This guide covers how to add or update a season. The primary data source is the [survivoR](https://github.com/doehm/survivoR) R dataset. The wiki is used only for player images.

## Quick Start

```bash
yarn new-season <N> [--force] [--push] [--dry-run]
```

This single command runs the full pipeline:

1. **Fetch survivoR data** — pulls castaways, episodes, challenge results, vote history, advantage details, tribe mapping, and journeys from the survivoR dataset
2. **Transform** — converts survivoR schema into the app's typed season data (players, episodes, challenges, eliminations, game events)
3. **Fetch wiki images** — downloads player headshots and bios from the Survivor Wiki (supplemental only)
4. **Generate season file** — creates `src/data/season_<N>/index.ts` with all typed exports
5. **Fetch season logo** — downloads the season logo from the wiki
6. **Register season** — adds the import and `SEASONS` map entry in `src/data/seasons.ts`
7. **Push to Firestore** — uploads the season document (only with `--push`)

### Flags

| Flag        | Effect                                                  |
| ----------- | ------------------------------------------------------- |
| `--force`   | Overwrite an existing season file                       |
| `--push`    | Push the generated season to Firestore after generation |
| `--dry-run` | Run the pipeline without writing files                  |

### Post-generation

After running, verify the output:

```bash
yarn format && yarn tsc
```

## Alternative: Claude Code Slash Command

```
/add-season <N>
```

Wraps `yarn new-season` with input validation, progress reporting, post-generation verification (`yarn format && yarn tsc`), and automatic branch creation + commit.

## Batch Generation

To generate multiple seasons at once:

```bash
yarn tsx scripts/batch-new-season.ts --seasons 1-10 [--skip-wiki] [--force] [--push] [--dry-run]
```

This fetches survivoR data once and reuses it across all seasons, which is significantly faster than running `yarn new-season` in a loop.

## Automated Daily Sync

The survivoR observer (`.github/workflows/survivor-observer.yml`, see `docs/survivor-observer.md`) checks every two hours and does a full run at 14:00 UTC. It:

1. Runs `yarn sync-season --no-push` at one pinned survivoR commit, which detects seasons with new data
2. Holds, writing nothing, while survivoR has only part of a newer episode (`scripts/lib/episode-readiness.ts`)
3. Validates the generated data (monotonicity, ID integrity, duplicates)
4. Creates or updates a PR with the changes
5. After `ci` passes and a listed reviewer approves the PR's latest commit, merges it and pushes the data to Firestore from `main`

Until the observer is switched to live, the older daily `.github/workflows/sync-survivor-data.yml` does steps 1 to 4 and stops there: it no longer pushes to Firestore or merges its own PR.

The sync regenerates only the results exports (episodes, challenges, eliminations, events and vote history). It keeps every field of a castaway already in the committed file, such as images, professions, bios, nicknames and hand-corrected ages or hometowns, and fills from survivoR only the fields a castaway lacks. When survivoR disagrees with a committed value, the committed value stays and the sync logs the difference and adds it to the `warnings` in `sync-result.json`. New castaways are written from survivoR. If the cast block has a field or value the sync cannot carry over, the sync fails rather than drop it. The rules live in `scripts/lib/curated-cast.ts`.

This means active seasons are kept in sync with one manual step per update, the review. See [CI Auto-Sync Pipeline — How It Works, How to Test It, and Lessons Learned](solutions/workflow-issues/ci-auto-sync-pipeline-validation-and-formatting-fix.md) for architecture details, testing strategies, and known gotchas.

## What Gets Generated

Each season file (`src/data/season_<N>/index.ts`) exports:

- `SEASON_<N>_CASTAWAY_LOOKUP` — `Record<CastawayId, { full_name, castaway }>` for display name resolution
- `SEASON_<N>_PLAYERS` — typed `Player[]` with castaway ID, name, image, age, hometown, description
- `SEASON_<N>_EPISODES` — typed `Episode[]` with merge/finale flags
- `SEASON_<N>_CHALLENGES` — typed challenge records with `winning_castaways` arrays
- `SEASON_<N>_ELIMINATIONS` — typed elimination records with vote counts and variants
- `SEASON_<N>_EVENTS` — typed game event records (idol finds, advantage plays, milestones)

## Re-running a Season

To regenerate a season with updated survivoR data:

```bash
yarn new-season <N> --force
```

Unlike the daily sync, this rebuilds the cast from survivoR and the wiki, so hand edits to the cast (professions, nicknames, corrected ages or hometowns) are replaced. Review the cast diff before committing.

## Data Gaps

The codegen marks unresolvable data gaps with TODO comments (e.g., `// TODO: resolve tribe winners to castaway IDs`). These indicate gaps in the survivoR dataset, typically for older seasons. When possible, resolve them manually by researching episode recaps and filling in the correct castaway IDs.
