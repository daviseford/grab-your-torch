/**
 * Generates TypeScript season data files from scraped JSON merged with existing data.
 * Only rewrites the player section (imports through SEASON_XX_PLAYERS export).
 * Everything after the player export is copied verbatim from the existing file.
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
 * Find the boundary line after the SEASON_XX_PLAYERS export.
 * Returns the index of the character AFTER the satisfies line + semicolon.
 */
export function findPlayerSectionEnd(
  fileContent: string,
  seasonNum: number,
): number {
  // Look for the satisfies line that ends the players array
  const patterns = [
    `] satisfies Player<CastawayIdType, SeasonNumber>[];`,
    `] satisfies Player<PlayerName, SeasonNumber>[];`,
    `] satisfies Player<PlayerName, ${seasonNum}>[];`,
  ];

  for (const pattern of patterns) {
    const idx = fileContent.indexOf(pattern);
    if (idx !== -1) {
      return idx + pattern.length;
    }
  }

  // Fallback: look for generic satisfies pattern
  const satisfiesRegex = /\]\s*satisfies\s*Player<[^>]+>\[\];/;
  const fallbackMatch = satisfiesRegex.exec(fileContent);
  if (fallbackMatch) {
    return fallbackMatch.index + fallbackMatch[0].length;
  }

  return -1;
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

interface MergedPlayer {
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

  return `  buildPlayer({\n${lines.join("\n")}\n  })`;
}

/**
 * Generate the player section of a season data file.
 */
export function generatePlayerSection(
  seasonNum: number,
  scrapedPlayers: ScrapedPlayer[],
  existingPlayers: ExistingPlayerData[],
  imgConstant: { constLine: string; prefix: string } | null,
): string {
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

  // Build the output
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

/**
 * Find the start of the player section in the existing file.
 * Looks for the const Players or const Season_X_Players array.
 */
export function findPlayerSectionStart(fileContent: string): number {
  // Match: "// eslint-disable-next-line" comment before const Players/Season_*_Players
  const eslintComment = fileContent.indexOf(
    "// eslint-disable-next-line @typescript-eslint/no-unused-vars",
  );
  if (eslintComment !== -1) {
    // Find the start of this line
    const lineStart = fileContent.lastIndexOf("\n", eslintComment);
    return lineStart === -1 ? eslintComment : lineStart + 1;
  }

  // Fallback: find const CastawayIds, const Players, or const Season_*_Players
  const patterns = [
    /^const CastawayIds\s*=/m,
    /^const Players\s*=/m,
    /^const Season_\d+_Players\s*=/m,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(fileContent);
    if (match) return match.index;
  }

  return -1;
}

/**
 * Generate a complete updated season data file.
 * Finds the player section (from const Players array to satisfies line),
 * replaces it, and preserves everything before and after.
 */
export function generateSeasonFile(
  seasonNum: number,
  scrapeResultPath: string,
  existingFilePath: string,
): string {
  // Read inputs
  const scrapeData: ScrapeResult = JSON.parse(
    fs.readFileSync(scrapeResultPath, "utf-8"),
  );
  const existingContent = fs.readFileSync(existingFilePath, "utf-8");

  // Extract existing player data
  const existingPlayers = extractExistingPlayers(existingContent);

  // Detect IMG constant pattern
  const imgConstant = detectImgConstant(existingContent);

  // Find the player section boundaries
  const startIndex = findPlayerSectionStart(existingContent);
  if (startIndex === -1) {
    throw new Error(
      `Could not find player section start in ${existingFilePath}`,
    );
  }

  const endIndex = findPlayerSectionEnd(existingContent, seasonNum);
  if (endIndex === -1) {
    throw new Error(`Could not find player section end in ${existingFilePath}`);
  }

  // Get the parts before and after the player section
  let beforePlayers = existingContent.slice(0, startIndex);
  let afterPlayers = existingContent.slice(endIndex);

  // Normalize old type names throughout (e.g., S9_Players → PlayerName, SeasonNum → SeasonNumber)
  const typeReplacements: [RegExp, string][] = [
    [/\bS9_Players\b/g, "PlayerName"],
    [/\bSeasonNum\b/g, "SeasonNumber"],
    [/\bSeason_9_Players\b/g, "PlayerName"],
  ];
  for (const [pattern, replacement] of typeReplacements) {
    beforePlayers = beforePlayers.replace(pattern, replacement);
    afterPlayers = afterPlayers.replace(pattern, replacement);
  }

  // Generate new player section (without imports — they're in beforePlayers)
  const playerSection = generatePlayerSection(
    seasonNum,
    scrapeData.players,
    existingPlayers,
    imgConstant,
  );

  return beforePlayers + playerSection + afterPlayers;
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
): string {
  // Preserve existing player img fields if the file already exists
  let existingPlayers: ExistingPlayerData[] = [];
  let imgConstant: { prefix: string; constLine: string } | null = null;
  if (existingFilePath && fs.existsSync(existingFilePath)) {
    const existingContent = fs.readFileSync(existingFilePath, "utf-8");
    existingPlayers = extractExistingPlayers(existingContent);
    imgConstant = detectImgConstant(existingContent);
  }

  const playerSection = generatePlayerSection(
    seasonNum,
    playerData.players,
    existingPlayers,
    imgConstant,
  );

  // Extract castaway IDs for cross-referencing in gameplay sections
  const castawayIds = playerData.players
    .filter((p) => p.castawayId)
    .map((p) => p.castawayId);

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
