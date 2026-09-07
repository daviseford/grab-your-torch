/**
 * Parses Survivor Wiki wikitext to extract contestant and season data
 * from infobox templates ({{Contestant}}, {{Season}}).
 */

export interface ContestantInfo {
  age?: number;
  hometown?: string;
  occupation?: string;
  previousSeasons?: number[];
  /** All season numbers this player appeared in (including the target season) */
  allSeasons?: number[];
  /** Wiki image filename (e.g., "S46 Ben Katzman.jpg") -- needs URL resolution via API */
  imageFileName?: string;
  /**
   * True when `imageFileName` is labelled for the target season (an `S<N>`
   * entry in a multi-season gallery or tabber, or a bare `S<N> Name.jpg`).
   * False when the parser fell back to the first (most recent) entry.
   */
  imageIsSeasonSpecific?: boolean;
  /** Nickname extracted from the bold intro paragraph (e.g., "Coach", "Q", "Boston Rob") */
  nickname?: string;
}

export interface SeasonInfobox {
  /** Filming location (e.g., "Mamanuca Islands, Fiji") -- wiki markup stripped */
  location?: string;
  /** Filming dates (e.g., "June 5, 2025 - June 30, 2025") */
  filmingDates?: string;
  /** Season air date range (e.g., "February 25, 2026 - May 20, 2026") */
  seasonRun?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Extract the key-value fields from a named wikitext template block.
 * Handles nested templates via bracket-depth counting.
 *
 * Example input:  `{{TemplateName\n| key = value\n| key2 = value2\n}}`
 */
function parseTemplateFields(
  wikitext: string,
  templateName: string,
): Record<string, string> | null {
  const startMatch = wikitext.match(
    new RegExp(`\\{\\{${templateName}\\s*\\n`, "i"),
  );
  if (!startMatch) return null;

  const blockStart = startMatch.index! + startMatch[0].length;
  let depth = 1;
  let blockEnd = -1;

  for (let i = blockStart; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
      depth++;
      i++;
    } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth--;
      if (depth === 0) {
        blockEnd = i;
        break;
      }
      i++;
    }
  }
  if (blockEnd === -1) return null;

  const block = wikitext.substring(blockStart, blockEnd);
  const fields: Record<string, string> = {};

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.substring(1, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    if (/^\w+$/.test(key)) {
      fields[key] = value;
    }
  }

  return fields;
}

/** Strip `<br>` tags, split on semicolons, and return the first non-empty part. */
function firstSemicolonPart(raw: string): string {
  const cleaned = raw.replace(/<br\s*\/?>/gi, "").trim();
  const parts = cleaned.split(";").map((s) => s.trim());
  return parts[0] || cleaned;
}

/** Strip `<ref>...</ref>` tags from a string. */
function stripRefTags(value: string): string {
  return value.replace(/<ref>[^<]*<\/ref>/g, "").trim();
}

// ---------------------------------------------------------------------------
// Sub-template parsers
// ---------------------------------------------------------------------------

/** Parse `{{Birth date and age|YYYY|M|D|mf=yes}}` into components plus computed age. */
export function parseBirthDate(value: string): {
  year: number;
  month: number;
  day: number;
  age: number;
} | null {
  const match = value.match(
    /\{\{Birth date and age\|(\d{4})\|(\d{1,2})\|(\d{1,2})/i,
  );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const now = new Date();
  let age = now.getFullYear() - year;
  if (
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day)
  ) {
    age--;
  }

  return { year, month, day, age };
}

/** Parse `{{S2|N}}` into a season number. */
export function parseSeasonNumber(value: string): number | null {
  const match = value.match(/\{\{S2?\|(\d+)\}\}/);
  return match ? Number(match[1]) : null;
}

/**
 * Extract a contestant's nickname from the bold intro paragraph of their wiki page.
 *
 * Priority:
 * 1. "also known as '''Nickname'''" pattern (e.g., "Boston Rob")
 * 2. Quoted text within the first '''...''' bold block (e.g., "Q", "Coach", "Ozzy")
 * 3. null if no nickname found
 */
export function parseNickname(wikitext: string): string | null {
  const akaMatch = wikitext.match(/\(also known as\s+'''([^']+)'''\)/i);
  if (akaMatch) {
    return akaMatch[1].trim();
  }

  const boldMatch = wikitext.match(/'''([^']+)'''/);
  if (boldMatch) {
    const quoteMatch = boldMatch[1].match(/[""\u201C]([^""\u201D]+)[""\u201D]/);
    if (quoteMatch) {
      return quoteMatch[1].trim();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Infobox parsers
// ---------------------------------------------------------------------------

/**
 * Extract key-value pairs from a `{{Contestant ...}}` infobox block.
 */
export function parseInfoboxFields(
  wikitext: string,
): Record<string, string> | null {
  return parseTemplateFields(wikitext, "Contestant");
}

/**
 * Parse a full contestant page's wikitext into structured ContestantInfo.
 * Extracts data from the `{{Contestant}}` infobox template.
 */
export function parseContestantPage(
  wikitext: string,
  targetSeasonNum?: number,
): ContestantInfo | null {
  const fields = parseInfoboxFields(wikitext);
  if (!fields) return null;

  const info: ContestantInfo = {};

  const nickname = parseNickname(wikitext);
  if (nickname) {
    info.nickname = nickname;
  }

  if (fields.birthdate) {
    const birth = parseBirthDate(fields.birthdate);
    if (birth) {
      info.age = birth.age;
    }
  }

  if (fields.hometown) {
    info.hometown = firstSemicolonPart(fields.hometown);
  }

  if (fields.occupation) {
    info.occupation = firstSemicolonPart(fields.occupation);
  }

  if (fields.image) {
    // Gallery entries contain "|" separators, so the generic field parser
    // truncates the value to a bare "<gallery>". Re-read the block from the
    // raw wikitext in that case.
    const imageSource = /<gallery>/i.test(fields.image)
      ? (/\|\s*image\s*=\s*(<gallery>[\s\S]*?<\/gallery>)/i.exec(
          wikitext,
        )?.[1] ?? fields.image)
      : fields.image;
    const image = extractImageFileName(imageSource, targetSeasonNum);
    if (image) {
      info.imageFileName = image.fileName;
      info.imageIsSeasonSpecific = image.seasonSpecific;
    }
  }

  const allSeasons = collectSeasons(fields);
  info.allSeasons = allSeasons;

  if (targetSeasonNum && allSeasons.length > 0) {
    info.previousSeasons = computePreviousSeasons(allSeasons, targetSeasonNum);
  } else if (allSeasons.length > 1) {
    info.previousSeasons = allSeasons.slice(0, -1);
  }

  return info;
}

/**
 * Extract season metadata from the `{{Season ...}}` infobox on a season wiki page.
 */
export function parseSeasonInfobox(wikitext: string): SeasonInfobox | null {
  const fields = parseTemplateFields(wikitext, "Season");
  if (!fields) return null;

  const result: SeasonInfobox = {};

  if (fields.location) {
    const location = stripWikiMarkup(fields.location);
    if (location) result.location = location;
  }

  if (fields.filmingdates) {
    const dates = stripRefTags(fields.filmingdates);
    if (dates) result.filmingDates = dates;
  }

  if (fields.seasonrun) {
    const run = stripRefTags(fields.seasonrun);
    if (run) result.seasonRun = run;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers for parseContestantPage / parseSeasonInfobox
// ---------------------------------------------------------------------------

/** Strip wiki markup from a location field: `{{wp|Page|Display}}` and `[[Link|Text]]`. */
function stripWikiMarkup(raw: string): string {
  let result = raw;
  result = result.replace(
    /\{\{wp\|([^}|]+)(?:\|([^}]+))?\}\}/g,
    (_m, page, display) => display ?? page,
  );
  result = result.replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2");
  result = result.replace(/<[^>]+>/g, "").trim();
  return result;
}

/** Matches a wiki image filename labelled for a US season, e.g. "S28 Tony Vlachos.jpg". */
function seasonFilePrefix(seasonNum: number): RegExp {
  return new RegExp(`^S${seasonNum}\\b`, "i");
}

export interface ExtractedImage {
  fileName: string;
  /** Whether `fileName` carries the `S<N>` label of the requested season. */
  seasonSpecific: boolean;
}

/**
 * Pick the entry labelled for the target season from a list of per-season
 * wiki filenames, falling back to the first entry when none matches.
 */
function pickSeasonEntry(
  entries: string[],
  targetSeasonNum?: number,
): ExtractedImage | null {
  if (entries.length === 0) return null;
  const forSeason = targetSeasonNum
    ? entries.find((name) => seasonFilePrefix(targetSeasonNum).test(name))
    : undefined;
  if (forSeason) return { fileName: forSeason, seasonSpecific: true };
  return { fileName: entries[0], seasonSpecific: false };
}

/**
 * Extract a clean image filename from an infobox `image` field value.
 *
 * Returning contestants' infoboxes carry one image per season, most recent
 * first. When a target season is given, the entry labelled `S<N>` for that
 * season wins so callers never pick up a later season's photo; otherwise the
 * first entry is returned with `seasonSpecific: false`.
 */
export function extractImageFileName(
  raw: string,
  targetSeasonNum?: number,
): ExtractedImage | null {
  let imgFile = raw.trim();

  // Multi-season gallery format:
  //   <gallery>
  //   S8 Kathy Vavrick-O'Brien.jpg|All-Stars
  //   S4 Kathy Vavrick-O'Brien.jpg|Marquesas
  //   </gallery>
  if (/<gallery>/i.test(imgFile)) {
    const body = imgFile.replace(/<\/?gallery[^>]*>/gi, "");
    const entries = body
      .split(/\r?\n/)
      .map((line) => line.split("|")[0].trim())
      .filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name));
    return pickSeasonEntry(entries, targetSeasonNum);
  }

  // Multi-season tabber format (one tab per season, most recent first).
  // Older pages sometimes use the `Image:` namespace alias instead of `File:`.
  //   <tabber>Winners at War=[[File:S40 Tony Vlachos.jpg]]|-|Cagayan=[[File:S28 Tony Vlachos.jpg]]</tabber>
  const fileEntries = [
    ...imgFile.matchAll(/\[\[(?:File|Image):([^\]|]+)/gi),
  ].map((m) => m[1].trim());
  if (fileEntries.length > 0) {
    return pickSeasonEntry(fileEntries, targetSeasonNum);
  }

  // Remove any remaining markup
  imgFile = imgFile.replace(/<[^>]+>/g, "").trim();

  if (imgFile && !imgFile.includes("{{") && !imgFile.includes("[[")) {
    return {
      fileName: imgFile,
      seasonSpecific:
        targetSeasonNum !== undefined &&
        seasonFilePrefix(targetSeasonNum).test(imgFile),
    };
  }
  return null;
}

/** Collect all season numbers from numbered `season`, `season2`, `season3`, ... fields. */
function collectSeasons(fields: Record<string, string>): number[] {
  const seasons: number[] = [];

  if (fields.season) {
    const sn = parseSeasonNumber(fields.season);
    if (sn) seasons.push(sn);
  }

  for (let i = 2; i <= 10; i++) {
    const key = `season${i}`;
    if (fields[key]) {
      const sn = parseSeasonNumber(fields[key]);
      if (sn) seasons.push(sn);
    }
  }

  return seasons;
}

/** Determine which seasons came before the target season in the ordered list. */
function computePreviousSeasons(
  allSeasons: number[],
  targetSeasonNum: number,
): number[] {
  const targetIndex = allSeasons.indexOf(targetSeasonNum);

  if (targetIndex === -1) {
    // Target season not listed on wiki yet -- all known seasons are previous
    return [...allSeasons];
  }
  if (targetIndex > 0) {
    return allSeasons.slice(0, targetIndex);
  }
  return [];
}
