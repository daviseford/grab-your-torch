/** Refresh the spoiler-free gender lookup. Does not write to Firebase. */
import { writeFile } from "node:fs/promises";

const source =
  "https://raw.githubusercontent.com/doehm/survivoR/master/dev/json/castaway_details.json";
const response = await fetch(source);
if (!response.ok) throw new Error(`survivoR returned ${response.status}`);
const rows: unknown = await response.json();
if (!Array.isArray(rows)) throw new Error("Expected a castaway array");
const players: Record<string, { name: string; gender: string }> = {};
for (const row of rows) {
  if (!row || typeof row.castaway_id !== "string") {
    throw new Error("Invalid castaway identity in demographics response");
  }
  if (!/^US\d{4}$/.test(row.castaway_id)) continue;
  if (typeof row.full_name !== "string")
    throw new Error(`Missing name for ${row.castaway_id}`);
  if (row.gender == null) continue;
  if (typeof row.gender !== "string" || !row.gender.trim()) {
    throw new Error(`Invalid gender for ${row.castaway_id}`);
  }
  players[row.castaway_id] = { name: row.full_name, gender: row.gender };
}
if (Object.keys(players).length < 700)
  throw new Error("Incomplete demographics response");
await writeFile(
  new URL("../src/data/castawayDemographics.json", import.meta.url),
  JSON.stringify({ source, players }, null, 2) + "\n",
);
console.log(
  `Updated ${Object.keys(players).length} castaway demographics. Run yarn format before committing.`,
);
