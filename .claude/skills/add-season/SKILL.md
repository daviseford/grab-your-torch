# Add a New Survivor Season

Add season **$ARGUMENTS** to the app by running the full survivoR data + wiki image pipeline.

## Steps

### 1. Validate Input

The season number is: `$ARGUMENTS`

- If empty or missing, stop and ask the user for a season number. Example usage: `/add-season 51`
- If not a positive integer, stop and report the error
- Confirm the season number with the user before proceeding

### 2. Run the Pipeline

Run the full season bootstrap command:

```bash
yarn new-season $ARGUMENTS --force --push
```

If survivoR has no castaways for the season yet (the script exits with a message saying so), the season has not started airing. If CBS has announced the cast, rerun with `--wiki-cast` to bootstrap the cast from the Survivor Wiki with provisional castaway_ids. Leave `--push` off in that case: pushing provisional data to production Firestore is the user's call, so report the exact push command instead. A wiki-bootstrapped season also needs a hand-written entry in `src/data/season-metadata.ts` with `complete: false` and the `premiere` date.

This command:

1. Fetches structured gameplay data from the survivoR dataset (players, episodes, challenges, eliminations, events, advantages)
2. Fetches player images and bios from the Survivor Wiki (supplemental)
3. Downloads player images and the season logo locally
4. Generates the season data file at `src/data/season_$ARGUMENTS/index.ts`
5. Registers the season in `src/data/seasons.ts`
6. Pushes all season data to Firestore

**Report progress to the user as each step completes.** The script logs step-by-step output — relay the key milestones (player count, episode count, image downloads, Firestore push status).

### 3. Watch for Warnings

Pay close attention to the script output for:

- **Wiki page not found warnings** — Some player names from survivoR may not match wiki page titles exactly. These players will be missing images. Tell the user which players were affected.
- **Image download failures** — Report which images failed. These can be retried by running `yarn new-season $ARGUMENTS --force`.
- **Firebase push errors** — Often caused by missing `firebase-private-key.json`. Tell the user to check their Firebase Admin SDK credentials.

### 4. Verify Output

After the pipeline completes, run:

```bash
yarn format && yarn tsc
```

- If **format** changes files, that's fine — it just means the generator didn't match Prettier config exactly.
- If **tsc** fails, report the type errors to the user. Common cause: unresolved player names producing invalid TypeScript identifiers. The user will need to fix these manually in the generated season file before the push is valid.

### 5. Summarize Results

Report to the user:

- Number of players fetched from survivoR
- Number of episodes, challenges, eliminations, and events
- Number of images downloaded from wiki
- Whether Firestore push succeeded
- Any warnings that need manual attention

### 6. Commit the New Season Files

Create a new feature branch and commit the generated files:

- Branch name: `feat/add-season-$ARGUMENTS`
- Commit message: `feat: add season $ARGUMENTS data`
- Stage only the new/modified files: `src/data/season_$ARGUMENTS/`, `src/data/seasons.ts`, `public/images/season_$ARGUMENTS/`
- Do NOT commit to `main` directly — always use a feature branch
