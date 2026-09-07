/**
 * Thin wrapper around the MediaWiki API at survivor.fandom.com.
 * Fetches wikitext content by page name.
 */

import fs from "fs";
import path from "path";

const BASE_URL = "https://survivor.fandom.com/api.php";

/** MediaWiki API supports up to 50 titles per request */
const BATCH_SIZE = 50;

/** Shape of the imageinfo query response pages */
type ImageInfoPages = Record<
  string,
  { title?: string; imageinfo?: { url: string }[] }
>;

/** Known season page names for seasons that don't use the Survivor_N format */
const SEASON_PAGE_NAMES: Record<number, string> = {
  1: "Survivor:_Borneo",
  2: "Survivor:_The_Australian_Outback",
  3: "Survivor:_Africa",
  4: "Survivor:_Marquesas",
  5: "Survivor:_Thailand",
  6: "Survivor:_The_Amazon",
  7: "Survivor:_Pearl_Islands",
  8: "Survivor:_All-Stars",
  9: "Survivor:_Vanuatu",
  10: "Survivor:_Palau",
  11: "Survivor:_Guatemala",
  12: "Survivor:_Panama",
  13: "Survivor:_Cook_Islands",
  14: "Survivor:_Fiji",
  15: "Survivor:_China",
  16: "Survivor:_Micronesia",
  17: "Survivor:_Gabon",
  18: "Survivor:_Tocantins",
  19: "Survivor:_Samoa",
  20: "Survivor:_Heroes_vs._Villains",
  21: "Survivor:_Nicaragua",
  22: "Survivor:_Redemption_Island",
  23: "Survivor:_South_Pacific",
  24: "Survivor:_One_World",
  25: "Survivor:_Philippines",
  26: "Survivor:_Caramoan",
  27: "Survivor:_Blood_vs._Water",
  28: "Survivor:_Cagayan",
  29: "Survivor:_San_Juan_del_Sur",
  30: "Survivor:_Worlds_Apart",
  31: "Survivor:_Cambodia",
  32: "Survivor:_Kaôh_Rōng",
  33: "Survivor:_Millennials_vs._Gen_X",
};

export function getSeasonPageName(seasonNum: number): string {
  return SEASON_PAGE_NAMES[seasonNum] || `Survivor_${seasonNum}`;
}

export async function fetchWikitext(pageName: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "parse",
    page: pageName,
    prop: "wikitext",
    format: "json",
    redirects: "true",
  });

  const url = `${BASE_URL}?${params}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.error(`HTTP ${response.status} fetching ${pageName}`);
    return null;
  }

  const data = (await response.json()) as {
    parse?: { wikitext?: { "*"?: string } };
    error?: { code?: string; info?: string };
  };

  if (data.error) {
    console.error(`Wiki API error for ${pageName}: ${data.error.info}`);
    return null;
  }

  return data.parse?.wikitext?.["*"] ?? null;
}

/** Query the MediaWiki imageinfo API for the given pipe-separated titles. */
async function queryImageInfo(titles: string): Promise<ImageInfoPages | null> {
  const params = new URLSearchParams({
    action: "query",
    titles,
    prop: "imageinfo",
    iiprop: "url",
    format: "json",
  });

  const response = await fetch(`${BASE_URL}?${params}`);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    query?: { pages?: ImageInfoPages };
  };

  return data.query?.pages ?? null;
}

/**
 * Resolve a wiki image filename to its full CDN URL via the imageinfo API.
 * E.g., "S46 Ben Katzman.jpg" -> "https://static.wikia.nocookie.net/survivor/images/..."
 */
export async function fetchImageUrl(fileName: string): Promise<string | null> {
  try {
    const pages = await queryImageInfo(`File:${fileName}`);
    if (!pages) return null;

    for (const page of Object.values(pages)) {
      const imgUrl = page.imageinfo?.[0]?.url;
      if (imgUrl) return imgUrl;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Batch-resolve multiple wiki image filenames to CDN URLs.
 * Uses the API's multi-title support for efficiency (up to 50 at a time).
 */
export async function fetchImageUrls(
  fileNames: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  for (let i = 0; i < fileNames.length; i += BATCH_SIZE) {
    const batch = fileNames.slice(i, i + BATCH_SIZE);
    const titles = batch.map((f) => `File:${f}`).join("|");

    try {
      const pages = await queryImageInfo(titles);
      if (!pages) continue;

      for (const page of Object.values(pages)) {
        const imgUrl = page.imageinfo?.[0]?.url;
        if (imgUrl && page.title) {
          const fileName = page.title.replace(/^File:/, "");
          result.set(fileName, imgUrl);
          // MediaWiki normalizes "_" to " " in returned titles. Callers that
          // took the name straight from an infobox (e.g. "Jason_Linden_Alt.jpg")
          // would otherwise never match their own key.
          if (fileName.includes(" ")) {
            result.set(fileName.replace(/ /g, "_"), imgUrl);
          }
        }
      }
    } catch {
      // Skip failed batches
    }

    if (i + BATCH_SIZE < fileNames.length) await delay(200);
  }

  return result;
}

/**
 * Rewrite a wiki CDN image URL to the 400px-wide thumbnail every player
 * image in `public/images/` is downloaded at.
 */
export function toThumbnailUrl(url: string): string {
  return url.replace(
    /\/revision\/latest.*/,
    "/revision/latest/scale-to-width-down/400",
  );
}

/**
 * Fetch an image's bytes from a URL.
 * Returns null on any HTTP or network failure.
 */
export async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Download an image from a URL to a local file path.
 * Returns true on success, false on failure.
 */
export async function downloadImage(
  url: string,
  destPath: string,
): Promise<boolean> {
  const buffer = await fetchImageBytes(url);
  if (!buffer) return false;
  try {
    const dir = path.dirname(destPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}

/** Small delay to avoid rate limiting */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
