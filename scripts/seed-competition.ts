/**
 * Spin up a ready-to-play sample competition: real users, a completed draft,
 * and submitted prop bets, with no clicking through the draft UI.
 *
 * The draft is simulated rather than replayed. A competition reads its rosters
 * from `draft_picks` on its own document, so the RTDB draft never has to exist
 * for the competition to behave normally in the app.
 *
 * Fixtures are created in the *production* project (that is the only project
 * the app talks to), so every document and account this writes carries an
 * ownership marker and teardown refuses to delete anything without one.
 *
 * Usage:
 *   yarn seed-competition                          # 4 players, default season
 *   yarn seed-competition --season 49 --players 6
 *   yarn seed-competition --live                   # live mode, not watch-along
 *   yarn seed-competition --list
 *   yarn seed-competition --teardown               # remove every sample fixture
 *   yarn seed-competition --teardown --run a1b2c3d4
 */

import { randomBytes } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { adminAuth } from "./lib/admin.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
const STATE_DIR = path.join(PROJECT_ROOT, "data", "sample-competitions");

/**
 * Every fixture carries this field. Teardown deletes only documents that have
 * it, so a real competition survives even if an id were to collide.
 */
const MARKER_FIELD = "sample_fixture";
const RUN_ID_FIELD = "sample_run_id";

/**
 * Season 49 has no air dates, so the broadcast-day trade lock can never close
 * on a seeded competition. Seasons that do have air dates still work; the
 * script warns when the chosen episode could lock.
 */
const DEFAULT_SEASON = 49;
const DEFAULT_PLAYERS = 4;
/**
 * Low enough that advancing episodes stays interesting and the finale (which
 * would auto-finish the competition) is far away.
 */
const DEFAULT_EPISODE = 2;

type Args = {
  season: number;
  players: number;
  episode: number;
  live: boolean;
  propBets: boolean;
  name: string | null;
  password: string | null;
  teardown: boolean;
  list: boolean;
  run: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    season: DEFAULT_SEASON,
    players: DEFAULT_PLAYERS,
    episode: DEFAULT_EPISODE,
    live: false,
    propBets: true,
    name: null,
    password: null,
    teardown: false,
    list: false,
    run: null,
  };

  const readNumber = (flag: string, raw: string | undefined): number => {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${flag} expects a positive integer, got "${raw}"`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--season":
        args.season = readNumber(flag, argv[++i]);
        break;
      case "--players":
      case "--participants":
        args.players = readNumber(flag, argv[++i]);
        break;
      case "--episode":
        args.episode = readNumber(flag, argv[++i]);
        break;
      case "--live":
        args.live = true;
        break;
      case "--no-prop-bets":
        args.propBets = false;
        break;
      case "--name":
        args.name = argv[++i] ?? null;
        break;
      case "--password":
        args.password = argv[++i] ?? null;
        break;
      case "--teardown":
        args.teardown = true;
        break;
      case "--list":
        args.list = true;
        break;
      case "--run":
        args.run = argv[++i] ?? null;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  if (args.players < 2) {
    throw new Error("--players must be at least 2 for trades to be testable");
  }

  return args;
}

const db = getFirestore();

type SeasonPlayer = { castaway_id: string; full_name: string };
type SeasonElimination = { castaway_id: string; episode_num: number };
type SeasonEpisode = { order: number; air_date?: string; finale: boolean };

type SeasonData = {
  players: SeasonPlayer[];
  eliminations: SeasonElimination[];
  episodes: SeasonEpisode[];
};

/**
 * Season files are TypeScript modules under src/data, so they are imported at
 * runtime through tsx rather than read as data.
 */
async function loadSeason(seasonNum: number): Promise<SeasonData> {
  const seasonPath = path.join(
    PROJECT_ROOT,
    "src",
    "data",
    `season_${seasonNum}`,
    "index.ts",
  );
  if (!fs.existsSync(seasonPath)) {
    throw new Error(
      `No season data at src/data/season_${seasonNum}. Add it with "yarn new-season ${seasonNum}" first.`,
    );
  }

  const mod = await import(
    new URL(`file:///${seasonPath.replace(/\\/g, "/")}`).href
  );

  const players = mod[`SEASON_${seasonNum}_PLAYERS`] as SeasonPlayer[];
  const eliminations = Object.values(
    (mod[`SEASON_${seasonNum}_ELIMINATIONS`] ?? {}) as Record<
      string,
      SeasonElimination
    >,
  );
  const episodes = (mod[`SEASON_${seasonNum}_EPISODES`] ??
    []) as SeasonEpisode[];

  if (!Array.isArray(players) || players.length === 0) {
    throw new Error(`season_${seasonNum} exports no players`);
  }

  return { players, eliminations, episodes };
}

type SampleUser = {
  uid: string;
  email: string;
  password: string;
  displayName: string;
};

const NAMES = [
  "Sample Alice",
  "Sample Bob",
  "Sample Cleo",
  "Sample Dev",
  "Sample Eve",
  "Sample Finn",
  "Sample Gus",
  "Sample Hana",
];

const emailFor = (runId: string, index: number) =>
  `sample-${index + 1}+${runId}@survivor-fantasy.test`;

async function ensureUser(
  email: string,
  displayName: string,
  password: string,
): Promise<SampleUser> {
  try {
    const existing = await adminAuth.getUserByEmail(email);
    await adminAuth.updateUser(existing.uid, { password, displayName });
    return { uid: existing.uid, email, password, displayName };
  } catch {
    const created = await adminAuth.createUser({
      email,
      password,
      displayName,
    });
    return { uid: created.uid, email, password, displayName };
  }
}

async function deleteUserIfExists(email: string): Promise<void> {
  try {
    const user = await adminAuth.getUserByEmail(email);
    await adminAuth.deleteUser(user.uid);
    console.log(`  Deleted user ${email}`);
  } catch {
    // Already gone; nothing to do.
  }
}

/**
 * Snake order, so the last picker of one round picks first in the next and no
 * single roster gets every early pick.
 */
function snakeOrder(participantCount: number, rounds: number): number[] {
  const order: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const seats = [...Array(participantCount).keys()];
    order.push(...(round % 2 === 0 ? seats : seats.reverse()));
  }
  return order;
}

/**
 * Prop bet answers are guesses, not results, so any castaway is a valid pick.
 * Rotating the pool by participant index keeps the answers varied, which is
 * what makes the prop bet tables worth looking at.
 */
function buildPropBetValues(
  alive: SeasonPlayer[],
  participantIndex: number,
): Record<string, string> {
  const pick = (offset: number) =>
    alive[(participantIndex * 3 + offset) % alive.length].castaway_id;
  const yesNo = (offset: number) =>
    (participantIndex + offset) % 2 === 0 ? "Yes" : "No";

  return {
    propbet_winner: pick(0),
    propbet_ftc: pick(1),
    propbet_first_vote: pick(2),
    propbet_immunities: pick(3),
    propbet_idols: pick(4),
    propbet_medical_evac: yesNo(0),
    propbet_first_idol_found: pick(5),
    propbet_first_successful_idol_play: pick(6),
    propbet_successful_shot_in_the_dark: yesNo(1),
    propbet_rewards: pick(7),
    propbet_quit: yesNo(0),
  };
}

type SampleState = {
  runId: string;
  competitionId: string;
  competitionName: string;
  seasonNum: number;
  url: string;
  users: SampleUser[];
};

async function seed(args: Args): Promise<void> {
  const runId = randomBytes(4).toString("hex");
  const competitionId = `competition_sample_${runId}` as const;
  const seasonId = `season_${args.season}` as const;

  const { players, eliminations, episodes } = await loadSeason(args.season);

  const finale = episodes.find((ep) => ep.finale);
  if (!args.live && finale && args.episode >= finale.order) {
    throw new Error(
      `Episode ${args.episode} is at or past the season ${args.season} finale (episode ${finale.order}); the competition would auto-finish. Pick a lower --episode.`,
    );
  }
  if (episodes.some((ep) => ep.air_date)) {
    console.warn(
      `  Note: season ${args.season} has air dates, so trades lock on a broadcast day. Season ${DEFAULT_SEASON} never locks.`,
    );
  }

  // A competition only ever shows castaways still in the game at its current
  // episode, so drafting an already-eliminated castaway would seed a roster
  // that reads as dead on arrival.
  const cutoff = args.live ? 0 : args.episode;
  const eliminatedByCutoff = new Set(
    eliminations
      .filter((e) => cutoff > 0 && e.episode_num <= cutoff)
      .map((e) => e.castaway_id),
  );
  const alive = players.filter((p) => !eliminatedByCutoff.has(p.castaway_id));

  const perTeam = Math.floor(alive.length / args.players);
  if (perTeam < 2) {
    throw new Error(
      `Only ${alive.length} castaways alive at episode ${args.episode}; not enough for ${args.players} rosters of 2+. Lower --players or --episode.`,
    );
  }

  console.log(
    `Seeding sample competition on season ${args.season} (run ${runId})...`,
  );

  const password = args.password ?? `sample-${randomBytes(8).toString("hex")}`;
  const users: SampleUser[] = [];
  for (let i = 0; i < args.players; i++) {
    const user = await ensureUser(
      emailFor(runId, i),
      NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${i + 1}` : ""),
      password,
    );
    users.push(user);
    console.log(`  User ${i + 1}: ${user.email} (${user.uid})`);
  }

  const slimUsers = users.map((u) => ({
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    isAdmin: false,
  }));

  const order = snakeOrder(args.players, perTeam);
  const draftPicks = order.map((seat, index) => {
    const user = users[seat];
    const player = alive[index];
    return {
      season_id: seasonId,
      season_num: args.season,
      order: index + 1,
      user_name: user.displayName,
      user_uid: user.uid,
      castaway_id: player.castaway_id,
      player_name: player.full_name,
    };
  });

  const propBets = args.propBets
    ? users.map((user, index) => ({
        id: `propbet_sample_${runId}_${index}`,
        user_uid: user.uid,
        user_name: user.displayName,
        values: buildPropBetValues(alive, index),
      }))
    : [];

  const competitionName =
    args.name ?? `Sample S${args.season} League (${runId})`;

  await db
    .collection("competitions")
    .doc(competitionId)
    .set({
      id: competitionId,
      [MARKER_FIELD]: true,
      [RUN_ID_FIELD]: runId,
      competition_name: competitionName,
      season_id: seasonId,
      season_num: args.season,
      // No RTDB draft backs this competition; rosters come from draft_picks.
      draft_id: `draft_sample_${runId}`,
      creator_uid: users[0].uid,
      participant_uids: users.map((u) => u.uid),
      participants: slimUsers,
      draft_picks: draftPicks,
      prop_bets: propBets,
      current_episode: args.live ? null : args.episode,
      finished: false,
    });

  const url = `/competitions/${competitionId}`;
  const state: SampleState = {
    runId,
    competitionId,
    competitionName,
    seasonNum: args.season,
    url,
    users,
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(STATE_DIR, `${runId}.json`),
    JSON.stringify(state, null, 2),
  );

  console.log("");
  console.log(`  ${competitionName}`);
  console.log(
    `  ${args.players} rosters of ${perTeam} - ${draftPicks.length} picks - ${propBets.length} prop bet entries`,
  );
  console.log(
    `  Mode: ${args.live ? "live" : `watch-along, episode ${args.episode}`}`,
  );
  console.log("");
  console.log(`  Open:     http://localhost:5173${url}`);
  console.log(`  Password: ${password}   (all sample users)`);
  console.log(
    `  Logins:   ${users.map((u) => u.email).join("\n            ")}`,
  );
  console.log("");
  console.log(`  Saved to data/sample-competitions/${runId}.json`);
  console.log(`  Remove:   yarn seed-competition --teardown --run ${runId}`);
}

async function deleteFixture(competitionId: string): Promise<void> {
  const ref = db.collection("competitions").doc(competitionId);
  const snap = await ref.get();
  if (!snap.exists) return;
  if (snap.get(MARKER_FIELD) !== true) {
    console.warn(
      `  REFUSING to delete ${competitionId}: missing ${MARKER_FIELD} marker`,
    );
    return;
  }

  const trades = await ref.collection("trades").get();
  for (const trade of trades.docs) {
    await trade.ref.delete();
  }
  await ref.delete();
  console.log(
    `  Deleted ${competitionId}${trades.size ? ` (+${trades.size} trades)` : ""}`,
  );

  const runId = snap.get(RUN_ID_FIELD);
  if (typeof runId === "string") {
    const participants = (snap.get("participants") ?? []) as {
      email?: string;
    }[];
    for (const participant of participants) {
      if (participant.email) await deleteUserIfExists(participant.email);
    }
    const statePath = path.join(STATE_DIR, `${runId}.json`);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
}

async function teardown(args: Args): Promise<void> {
  if (args.run) {
    console.log(`Tearing down sample run ${args.run}...`);
    await deleteFixture(`competition_sample_${args.run}`);
    console.log("Teardown complete.");
    return;
  }

  console.log("Tearing down every sample competition...");
  const marked = await db
    .collection("competitions")
    .where(MARKER_FIELD, "==", true)
    .get();
  if (marked.empty) {
    console.log("  Nothing to remove");
    return;
  }
  for (const doc of marked.docs) {
    await deleteFixture(doc.id);
  }
  console.log("Teardown complete.");
}

async function list(): Promise<void> {
  const marked = await db
    .collection("competitions")
    .where(MARKER_FIELD, "==", true)
    .get();
  if (marked.empty) {
    console.log("No sample competitions.");
    return;
  }
  console.log(`${marked.size} sample competition(s):`);
  for (const doc of marked.docs) {
    const episode = doc.get("current_episode");
    console.log(
      `  ${doc.id}  S${doc.get("season_num")}  ${
        episode === null ? "live" : `ep ${episode}`
      }  ${(doc.get("participants") ?? []).length} players  "${doc.get(
        "competition_name",
      )}"`,
    );
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) await list();
  else if (args.teardown) await teardown(args);
  else await seed(args);
  process.exit(0);
} catch (err) {
  console.error(
    "seed-competition failed:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
