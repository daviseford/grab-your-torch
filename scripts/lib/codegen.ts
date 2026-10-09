/**
 * Generates TypeScript season data files from scraped JSON merged with existing data.
 * `generateFullSeasonFile` writes the whole file; existing player images are
 * carried over from the committed file when one is given.
 */

import * as fs from "fs";
import type {
  ScrapedChallenge,
  ScrapedElimination,
  ScrapedEpisode,
  ScrapedGameEvent,
  ScrapedPlayer,
  ScrapedVoteRow,
  ScrapeResult,
  ScrapeResultsOutput,
} from "./types.js";

interface ExistingPlayerData {
  name: string;
  img: string;
}

/**
 * Extract castaway_id → full_name pairs from the SEASON_XX_CASTAWAY_LOOKUP
 * export of an existing season file. Used to make sure a regeneration never
 * re-numbers a cast that drafts already reference.
 */
export function extractExistingCastawayLookup(
  fileContent: string,
): Array<{ castawayId: string; fullName: string }> {
  const lookupRegex =
    /^\s*"?(US\d{4})"?:\s*\{\s*full_name:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/gm;
  const pairs: Array<{ castawayId: string; fullName: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = lookupRegex.exec(fileContent)) !== null) {
    pairs.push({
      castawayId: match[1],
      fullName: (match[2] ?? match[3]).replace(/\\(["'\\])/g, "$1"),
    });
  }
  return pairs;
}

/**
 * Resolve name and img from a regex match with groups:
 *   [1] or [2] = name (double or single quoted)
 *   [3] or [4] or [5] = img (double quoted, single quoted, or backtick template)
 */
function resolvePlayerMatch(
  match: RegExpExecArray,
  imgConst: { prefix: string } | null,
): ExistingPlayerData {
  const name = match[1] || match[2];
  let img = match[3] || match[4] || "";

  if (match[5] && imgConst) {
    const tmpl = match[5].slice(1, -1); // Remove backticks
    img = tmpl.replace(/\$\{IMG\}/g, imgConst.prefix);
  }

  return { name, img };
}

/**
 * Extract player names and img URLs from an existing season data file.
 * Resolves `${IMG}/...` template literals using the IMG constant value.
 */
export function extractExistingPlayers(
  fileContent: string,
): ExistingPlayerData[] {
  const imgConst = detectImgConstant(fileContent);
  const players: ExistingPlayerData[] = [];

  // Positional: buildPlayer("Name", "img_url", ...)
  const positionalRegex =
    /buildPlayer\(\s*\n?\s*(?:"([^"]+)"|'([^']+)')\s*,\s*\n?\s*(?:"([^"]+)"|'([^']+)'|(`[^`]+`))/g;

  // Object-style: buildPlayer({ name: "Name", img: "..." })
  const objectRegex =
    /buildPlayer\(\{\s*\n?\s*name:\s*(?:"([^"]+)"|'([^']+)'),\s*\n?\s*img:\s*(?:"([^"]+)"|'([^']+)'|(`[^`]+`))/g;

  // CastawayId-style: buildPlayer({ castaway_id: "...", full_name: "Name", img: "..." })
  const castawayIdRegex =
    /buildPlayer\(\{\s*\n?\s*castaway_id:\s*"[^"]+",\s*\n?\s*full_name:\s*(?:"([^"]+)"|'([^']+)'),\s*\n?\s*img:\s*(?:"([^"]+)"|'([^']+)'|(`[^`]+`))/g;

  let match: RegExpExecArray | null;
  while ((match = positionalRegex.exec(fileContent)) !== null) {
    players.push(resolvePlayerMatch(match, imgConst));
  }
  while ((match = objectRegex.exec(fileContent)) !== null) {
    players.push(resolvePlayerMatch(match, imgConst));
  }
  while ((match = castawayIdRegex.exec(fileContent)) !== null) {
    players.push(resolvePlayerMatch(match, imgConst));
  }

  return players;
}

/**
 * Detect if the file uses a local IMG constant for image paths.
 * Returns the constant definition line if found, null otherwise.
 */
export function detectImgConstant(
  fileContent: string,
): { constLine: string; prefix: string } | null {
  const match = fileContent.match(/^(const IMG = "([^"]+)";?)$/m);
  if (match) {
    return { constLine: match[1], prefix: match[2] };
  }
  return null;
}

function escapeString(s: string): string {
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  // Contains both quote types: use single quotes with escaping
  return `'${s.replace(/'/g, "\\'")}'`;
}

/** One castaway as written to the cast block of a season file. */
export interface MergedPlayer {
  castawayId: string;
  fullName: string;
  castawayShortName: string;
  img: string;
  age?: number;
  profession?: string;
  hometown?: string;
  previousSeasons?: number[];
  description?: string;
  nickname?: string;
  gender?: string;
  bio?: string;
}

function formatPlayerCall(
  player: MergedPlayer,
  imgConstant: { prefix: string } | null,
): string {
  const lines: string[] = [];
  lines.push(`    castaway_id: "${player.castawayId}",`);
  lines.push(`    full_name: ${escapeString(player.fullName)},`);

  // Handle IMG constant pattern (Season 50 uses `${IMG}/filename.jpg`)
  if (imgConstant && player.img.startsWith(imgConstant.prefix)) {
    const suffix = player.img.slice(imgConstant.prefix.length);
    lines.push(`    img: \`\${IMG}${suffix}\`,`);
  } else {
    lines.push(`    img: ${escapeString(player.img)},`);
  }

  if (player.description) {
    lines.push(`    description: ${escapeString(player.description)},`);
  }
  if (player.age !== undefined) {
    lines.push(`    age: ${player.age},`);
  }
  if (player.profession) {
    lines.push(`    profession: ${escapeString(player.profession)},`);
  }
  if (player.hometown) {
    lines.push(`    hometown: ${escapeString(player.hometown)},`);
  }
  if (player.previousSeasons && player.previousSeasons.length > 0) {
    lines.push(`    previousSeasons: [${player.previousSeasons.join(", ")}],`);
  }
  if (player.nickname) {
    lines.push(`    nickname: ${escapeString(player.nickname)},`);
  }
  if (player.gender) {
    lines.push(`    gender: ${escapeString(player.gender)},`);
  }
  if (player.bio) {
    lines.push(`    bio: ${escapeString(player.bio)},`);
  }

  return `  buildPlayer({\n${lines.join("\n")}\n  })`;
}

/**
 * Merge scraped castaways with the images of an existing file into the
 * castaways the cast block is written from.
 */
export function mergeScrapedPlayers(
  scrapedPlayers: ScrapedPlayer[],
  existingPlayers: ExistingPlayerData[],
): MergedPlayer[] {
  // Build a map of existing players for img lookup
  const existingMap = new Map(existingPlayers.map((p) => [p.name, p]));

  // Merge scraped data with existing player data
  const mergedPlayers: MergedPlayer[] = [];

  for (const scraped of scrapedPlayers) {
    const localName = scraped.localName;
    if (!localName || !scraped.castawayId) continue;

    const existing = existingMap.get(localName);
    const scrapedIsLocal = scraped.imageUrl?.startsWith("/");
    const img = scrapedIsLocal
      ? scraped.imageUrl!
      : existing?.img || scraped.imageUrl || "";

    const descParts: string[] = [];
    if (scraped.age !== undefined) descParts.push(`Age: ${scraped.age}`);
    if (scraped.hometown) descParts.push(`Hometown: ${scraped.hometown}`);
    if (scraped.profession) descParts.push(`Occupation: ${scraped.profession}`);
    const description =
      descParts.length > 0 ? descParts.join(" | ") : undefined;

    mergedPlayers.push({
      castawayId: scraped.castawayId,
      fullName: localName,
      castawayShortName: scraped.nickname || localName.split(" ")[0],
      img,
      age: scraped.age,
      profession: scraped.profession,
      hometown: scraped.hometown,
      previousSeasons: scraped.previousSeasons,
      description,
      nickname: scraped.nickname,
    });
  }

  return mergedPlayers;
}

/**
 * Render the player section (CastawayIds, types, buildPlayer, lookup and
 * SEASON_XX_PLAYERS) for castaways that are already merged.
 */
export function renderPlayerSection(
  seasonNum: number,
  mergedPlayers: MergedPlayer[],
  imgConstant: { constLine: string; prefix: string } | null,
): string {
  const lines: string[] = [];

  // Castaway IDs array
  lines.push(
    `// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only in typeof for type derivation`,
  );
  lines.push(`const CastawayIds = [`);
  for (const p of mergedPlayers) {
    lines.push(`  "${p.castawayId}",`);
  }
  lines.push(`] as const;`);
  lines.push(``);

  // Type aliases
  lines.push(`type CastawayIdType = (typeof CastawayIds)[number];`);
  lines.push(``);
  lines.push(`type SeasonNumber = ${seasonNum};`);
  lines.push(``);

  // Standardized buildPlayer helper
  lines.push(`const buildPlayer = <T extends CastawayIdType>(`);
  lines.push(
    `  p: { castaway_id: T; full_name: string; img: string } & Partial<`,
  );
  lines.push(
    `    Omit<Player<T, SeasonNumber>, "season_id" | "season_num" | "castaway_id" | "full_name" | "img">`,
  );
  lines.push(`  >,`);
  lines.push(`): Player<T, SeasonNumber> => ({`);
  lines.push(`  ...p,`);
  lines.push(`  season_num: ${seasonNum},`);
  lines.push(`  season_id: "season_${seasonNum}",`);
  lines.push(`});`);
  lines.push(``);

  // IMG constant if applicable
  if (imgConstant) {
    lines.push(imgConstant.constLine);
    lines.push(``);
  }

  // Castaway lookup map
  lines.push(
    `export const SEASON_${seasonNum}_CASTAWAY_LOOKUP: CastawayLookup = {`,
  );
  for (const p of mergedPlayers) {
    lines.push(
      `  "${p.castawayId}": { full_name: ${escapeString(p.fullName)}, castaway: ${escapeString(p.castawayShortName)} },`,
    );
  }
  lines.push(`};`);
  lines.push(``);

  // Players export
  lines.push(`export const SEASON_${seasonNum}_PLAYERS = [`);
  for (const player of mergedPlayers) {
    lines.push(`${formatPlayerCall(player, imgConstant)},`);
  }
  lines.push(`] satisfies Player<CastawayIdType, SeasonNumber>[];`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Gameplay data generation
// ---------------------------------------------------------------------------

/**
 * Parse a vote string like "5-3" or "7-2-1" to extract the first number
 * (votes received by the eliminated player).
 */
function parseVotesReceived(voteString: string): number | undefined {
  const match = voteString.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Generate the SEASON_N_EPISODES export array.
 */
export function generateEpisodeSection(
  episodes: ScrapedEpisode[],
  seasonNum: number,
): string {
  const lines: string[] = [];
  lines.push(`export const SEASON_${seasonNum}_EPISODES = [`);

  for (const ep of episodes) {
    lines.push(`  {`);
    lines.push(`    id: "episode_${ep.order}",`);
    lines.push(`    season_id: "season_${seasonNum}",`);
    lines.push(`    season_num: ${seasonNum},`);
    lines.push(`    order: ${ep.order},`);
    lines.push(`    name: ${escapeString(ep.title)},`);
    if (ep.airDate) {
      lines.push(`    air_date: "${ep.airDate}",`);
    }
    lines.push(`    post_merge: ${ep.postMerge},`);
    lines.push(`    finale: ${ep.isFinale},`);
    lines.push(`    merge_occurs: ${ep.mergeOccurs},`);
    lines.push(`  },`);
  }

  lines.push(`] satisfies Episode<SeasonNumber>[];`);
  return lines.join("\n");
}

/**
 * Generate the SEASON_N_CHALLENGES export Record.
 */
export function generateChallengeSection(
  challenges: ScrapedChallenge[],
  seasonNum: number,
  castawayIds: string[],
): string {
  const lines: string[] = [];
  const castawayIdSet = new Set(castawayIds);

  lines.push(`export const SEASON_${seasonNum}_CHALLENGES = {`);

  for (const ch of challenges) {
    const id = `challenge_${ch.order}`;
    const validWinners = ch.winnerCastawayIds.filter((cid) =>
      castawayIdSet.has(cid),
    );

    lines.push(`  ${id}: {`);
    lines.push(`    id: "${id}",`);
    lines.push(`    season_id: "season_${seasonNum}",`);
    lines.push(`    season_num: ${seasonNum},`);
    lines.push(`    episode_id: "episode_${ch.episodeNum}",`);
    lines.push(`    episode_num: ${ch.episodeNum},`);
    lines.push(`    variant: "${ch.variant}",`);
    lines.push(`    order: ${ch.order},`);

    if (validWinners.length === 0) {
      lines.push(`    // TODO: resolve tribe winners to castaway IDs`);
      lines.push(`    winning_castaways: [],`);
    } else {
      lines.push(`    winning_castaways: [`);
      for (const cid of validWinners) {
        lines.push(`      "${cid}",`);
      }
      lines.push(`    ],`);
    }

    lines.push(`  },`);
  }

  lines.push(
    `} satisfies Record<Challenge["id"], Challenge<CastawayIdType, SeasonNumber>>;`,
  );
  return lines.join("\n");
}

/**
 * Generate the SEASON_N_ELIMINATIONS export Record.
 */
export function generateEliminationSection(
  eliminations: ScrapedElimination[],
  seasonNum: number,
  castawayIds: string[],
): string {
  const lines: string[] = [];
  const castawayIdSet = new Set(castawayIds);

  lines.push(`export const SEASON_${seasonNum}_ELIMINATIONS = {`);

  for (const elim of eliminations) {
    const id = `elimination_${elim.order}`;
    const idValid = castawayIdSet.has(elim.castawayId);
    const votesReceived = parseVotesReceived(elim.voteString);

    lines.push(`  ${id}: {`);
    lines.push(`    id: "${id}",`);
    lines.push(`    season_id: "season_${seasonNum}",`);
    lines.push(`    season_num: ${seasonNum},`);
    lines.push(`    episode_id: "episode_${elim.episodeNum}",`);
    lines.push(`    episode_num: ${elim.episodeNum},`);
    lines.push(`    order: ${elim.order},`);

    if (idValid) {
      lines.push(`    castaway_id: "${elim.castawayId}",`);
    } else {
      lines.push(
        `    // TODO: resolve castaway ID "${elim.castawayId}" to a known player`,
      );
      lines.push(`    castaway_id: "${elim.castawayId}",`);
    }

    if (votesReceived !== undefined) {
      lines.push(`    votes_received: ${votesReceived},`);
    }
    lines.push(`    variant: "${elim.variant}",`);
    lines.push(`  },`);
  }

  lines.push(
    `} satisfies Record<Elimination["id"], Elimination<CastawayIdType, SeasonNumber>>;`,
  );
  return lines.join("\n");
}

/**
 * Generate the SEASON_N_EVENTS export Record.
 */
export function generateEventSection(
  events: ScrapedGameEvent[],
  seasonNum: number,
  castawayIds: string[],
): string {
  const lines: string[] = [];
  const castawayIdSet = new Set(castawayIds);

  lines.push(`export const SEASON_${seasonNum}_EVENTS = {`);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const id = `event_${i + 1}`;
    const idValid = castawayIdSet.has(ev.castawayId);

    lines.push(`  ${id}: {`);
    lines.push(`    id: "${id}",`);
    lines.push(`    season_id: "season_${seasonNum}",`);
    lines.push(`    season_num: ${seasonNum},`);
    lines.push(`    episode_id: "episode_${ev.episodeNum}",`);
    lines.push(`    episode_num: ${ev.episodeNum},`);

    if (idValid) {
      lines.push(`    castaway_id: "${ev.castawayId}",`);
    } else {
      lines.push(
        `    // TODO: resolve castaway ID "${ev.castawayId}" to a known player`,
      );
      lines.push(`    castaway_id: "${ev.castawayId}",`);
    }

    lines.push(`    action: "${ev.action}",`);
    lines.push(
      `    multiplier: ${ev.multiplier === null ? "null" : ev.multiplier},`,
    );
    lines.push(`  },`);
  }

  lines.push(
    `} satisfies Record<GameEvent["id"], GameEvent<CastawayIdType, SeasonNumber>>;`,
  );
  return lines.join("\n");
}

/**
 * Generate the SEASON_N_VOTE_HISTORY export Record.
 */
export function generateVoteHistorySection(
  voteHistory: ScrapedVoteRow[],
  seasonNum: number,
  castawayIds: string[],
): string {
  const lines: string[] = [];
  const castawayIdSet = new Set(castawayIds);

  lines.push(`export const SEASON_${seasonNum}_VOTE_HISTORY = {`);

  for (const vh of voteHistory) {
    const id = `vote_${vh.sogId}_${vh.voterCastawayId}_${vh.targetCastawayId}_${vh.voteOrder}`;
    const voterValid = castawayIdSet.has(vh.voterCastawayId);
    const targetValid = castawayIdSet.has(vh.targetCastawayId);

    lines.push(`  "${id}": {`);
    lines.push(`    id: "${id}",`);
    lines.push(`    season_id: "season_${seasonNum}",`);
    lines.push(`    season_num: ${seasonNum},`);
    lines.push(`    episode_id: "episode_${vh.episodeNum}",`);
    lines.push(`    episode_num: ${vh.episodeNum},`);
    lines.push(`    tribe: ${escapeString(vh.tribe)},`);

    if (voterValid) {
      lines.push(`    voter_castaway_id: "${vh.voterCastawayId}",`);
    } else {
      lines.push(
        `    // TODO: resolve voter castaway ID "${vh.voterCastawayId}"`,
      );
      lines.push(`    voter_castaway_id: "${vh.voterCastawayId}",`);
    }

    if (targetValid) {
      lines.push(`    target_castaway_id: "${vh.targetCastawayId}",`);
    } else {
      lines.push(
        `    // TODO: resolve target castaway ID "${vh.targetCastawayId}"`,
      );
      lines.push(`    target_castaway_id: "${vh.targetCastawayId}",`);
    }

    lines.push(`    voted_out_castaway_id: "${vh.votedOutCastawayId}",`);
    lines.push(`    nullified: ${vh.nullified},`);
    lines.push(`    tie: ${vh.tie},`);
    lines.push(`    sog_id: ${vh.sogId},`);
    lines.push(`    vote_order: ${vh.voteOrder},`);
    lines.push(`  },`);
  }

  lines.push(
    `} satisfies Record<VoteHistory["id"], VoteHistory<CastawayIdType, SeasonNumber>>;`,
  );
  return lines.join("\n");
}

/**
 * Generate a complete season file from both player scrape and results scrape data.
 * Produces the full TypeScript file ready to write to disk.
 */
export function generateFullSeasonFile(
  playerData: ScrapeResult,
  resultsData: ScrapeResultsOutput,
  seasonNum: number,
  existingFilePath?: string,
  options: {
    /**
     * Castaways to write as they are, instead of merging `playerData` with
     * the images of `existingFilePath`. The sync passes the committed cast
     * here so curated fields survive (see curated-cast.ts).
     */
    cast?: MergedPlayer[];
    imgConstant?: { prefix: string; constLine: string } | null;
  } = {},
): string {
  // Preserve existing player img fields if the file already exists
  let existingPlayers: ExistingPlayerData[] = [];
  let imgConstant: { prefix: string; constLine: string } | null =
    options.imgConstant ?? null;
  if (existingFilePath && fs.existsSync(existingFilePath)) {
    const existingContent = fs.readFileSync(existingFilePath, "utf-8");
    existingPlayers = extractExistingPlayers(existingContent);
    imgConstant = detectImgConstant(existingContent);
  }

  const cast =
    options.cast ?? mergeScrapedPlayers(playerData.players, existingPlayers);
  const playerSection = renderPlayerSection(seasonNum, cast, imgConstant);

  // Castaway IDs for cross-referencing in gameplay sections
  const castawayIds = cast.map((p) => p.castawayId);

  const episodeSection = generateEpisodeSection(
    resultsData.episodes,
    seasonNum,
  );
  const challengeSection = generateChallengeSection(
    resultsData.challenges,
    seasonNum,
    castawayIds,
  );
  const eliminationSection = generateEliminationSection(
    resultsData.eliminations,
    seasonNum,
    castawayIds,
  );
  const eventSection = generateEventSection(
    resultsData.events,
    seasonNum,
    castawayIds,
  );
  const voteHistorySection = generateVoteHistorySection(
    resultsData.voteHistory,
    seasonNum,
    castawayIds,
  );

  // Compose the full file
  const parts: string[] = [];

  // Imports
  parts.push(
    `import {\n  CastawayLookup,\n  Challenge,\n  Elimination,\n  Episode,\n  GameEvent,\n  Player,\n  VoteHistory,\n} from "../../types";`,
  );
  parts.push("");

  // Player section (CastawayIds, types, buildPlayer, lookup, SEASON_XX_PLAYERS)
  parts.push(playerSection);
  parts.push("");

  // Gameplay sections
  parts.push(episodeSection);
  parts.push("");
  parts.push(challengeSection);
  parts.push("");
  parts.push(eliminationSection);
  parts.push("");
  parts.push(eventSection);
  parts.push("");
  parts.push(voteHistorySection);
  parts.push("");

  return parts.join("\n");
}

/**
 * Register a season in src/data/seasons.ts.
 * Adds the import and SEASONS entry if not already present.
 */
export function registerSeason(
  seasonNum: number,
  seasonsFilePath: string,
  seasonImg = "",
): void {
  const content = fs.readFileSync(seasonsFilePath, "utf-8");
  const seasonKey = `season_${seasonNum}`;

  // Check if already registered
  if (content.includes(`${seasonKey}:`)) {
    console.log(
      `Season ${seasonNum} is already registered in ${seasonsFilePath}`,
    );
    return;
  }

  // Add import line
  const importLine = `import { SEASON_${seasonNum}_CASTAWAY_LOOKUP, SEASON_${seasonNum}_EPISODES, SEASON_${seasonNum}_PLAYERS } from "./${seasonKey}";`;

  // Find the last import line and insert after it
  const importRegex = /^import .+ from ".\/season_\d+";$/gm;
  let lastImportMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    lastImportMatch = match;
  }

  let newContent: string;
  if (lastImportMatch) {
    const insertPos = lastImportMatch.index + lastImportMatch[0].length;
    newContent =
      content.slice(0, insertPos) +
      "\n" +
      importLine +
      content.slice(insertPos);
  } else {
    // No existing season imports — add after the types import
    const typesImportRegex = /^import .+ from "\.\.\/types";$/m;
    const typesMatch = typesImportRegex.exec(content);
    if (typesMatch) {
      const insertPos = typesMatch.index + typesMatch[0].length;
      newContent =
        content.slice(0, insertPos) +
        "\n" +
        importLine +
        content.slice(insertPos);
    } else {
      // Fallback: prepend
      newContent = importLine + "\n" + content;
    }
  }

  // Add SEASONS entry before the closing `} satisfies`
  const seasonsEntry =
    `\n  ${seasonKey}: {\n` +
    `    id: "${seasonKey}" as const,\n` +
    `    order: ${seasonNum},\n` +
    `    name: "Survivor ${seasonNum}",\n` +
    `    img: "${seasonImg}",\n` +
    `    players: SEASON_${seasonNum}_PLAYERS,\n` +
    `    episodes: SEASON_${seasonNum}_EPISODES,\n` +
    `    castawayLookup: SEASON_${seasonNum}_CASTAWAY_LOOKUP,\n` +
    `  },\n`;

  const satisfiesPattern = /\n} satisfies Record<Season\["id"\], Season>;/;
  const satisfiesMatch = satisfiesPattern.exec(newContent);
  if (satisfiesMatch) {
    const insertPos = satisfiesMatch.index;
    newContent =
      newContent.slice(0, insertPos) +
      seasonsEntry +
      newContent.slice(insertPos);
  } else {
    throw new Error(
      `Could not find SEASONS closing satisfies in ${seasonsFilePath}`,
    );
  }

  fs.writeFileSync(seasonsFilePath, newContent);
  console.log(`Registered season ${seasonNum} in ${seasonsFilePath}`);
}
