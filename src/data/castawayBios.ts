import type { CastawayId } from "../types";

/** Curated preseason facts only. Never add results or wiki career summaries.
 * Season 51 entries are keyed by survivoR castaway_id, so a name change upstream
 * keeps the bio. The trailing comment on each id is the name it was curated as.
 * Hobbies are short summaries of cast questionnaires published by TV Insider.
 * Locations are CBS's hometown/current-residence fields, not birthplaces.
 */
export type CastawayBio = {
  gender?: string;
  hometown?: string;
  residence?: string;
  birthplace?: string;
  height?: string;
  weight?: string;
  hobbies?: string;
  sources?: { label: string; url: string }[];
};

const questionnaire = {
  label: "Preseason questionnaire",
  url: "https://www.tvinsider.com/gallery/survivor-51-cast-open-era/",
};
const castReveal = {
  label: "Cast reveal interviews",
  url: "https://www.aol.com/articles/survivor-cast-2026-revealed-meet-174527000.html",
};
const locations = {
  label: "CBS cast announcement",
  url: "https://www.paramountpressexpress.com/cbs-entertainment/shows/survivor/releases/?view=113157-survivor-reveals-the-21-new-castaways-competing-on-the-51st-edition-the-first-in-the-series-new-open-era-with-a-two-hour-season-premiere-on-wednesday",
};

// Reviewed 2026-09-12. Gender follows published cast bios, never portraits/names.
export const SEASON_51_BIOS: Partial<Record<CastawayId, CastawayBio>> =
  Object.fromEntries(
    (
      [
        [
          "US0752", // Aaliyah Puglia
          "Female",
          "Gloucester City, New Jersey",
          "Providence, Rhode Island",
          undefined,
        ],
        [
          "US0753", // Alexis Levine
          "Female",
          "Atlanta, Georgia",
          "Atlanta, Georgia",
          "Books, gardening, family walks",
        ],
        [
          "US0755", // Ana Sani
          "Female",
          "Richmond Hill, Ontario, Canada",
          "Toronto, Ontario, Canada",
          "Gaming, piano, coffee, fitness",
        ],
        [
          "US0757", // Brady Booker
          "Male",
          "La Salle, Illinois",
          "Knoxville, Tennessee",
          "Outdoor recreation and strength training",
        ],
        [
          "US0758", // Carter Krull
          "Male",
          "Rock Rapids, Iowa",
          "Sioux Falls, South Dakota",
          "Woodworking and resin-table making",
        ],
        [
          "US0759", // Cristian Chavez
          "Male",
          "Salt Lake City, Utah",
          "Salt Lake City, Utah",
          "Baking, philosophy, family activities",
        ],
        [
          "US0760", // Danny Kilby
          "Male",
          "Mount Forest, Ontario, Canada",
          "London, Ontario, Canada",
          "Filmmaking, tabletop games, improv, kayaking",
        ],
        [
          "US0761", // Devin Way
          "Male",
          "Lufkin, Texas",
          "Los Angeles, California",
          "Tabletop roleplaying, dancing, comics",
        ],
        [
          "US0762", // Eric Macksoud
          "Male",
          "Lincoln, Rhode Island",
          "Windsor Locks, Connecticut",
          "Theater, guitar, games, swimming",
        ],
        [
          "US0756", // Jelly Loblack
          "Female",
          "Garland, Texas, and Midwest City, Oklahoma",
          "Bloomington, Indiana",
          "Writing, volleyball, sci-fi, running",
        ],
        [
          "US0763", // Jenna Doore
          "Female",
          "Perrysburg, Ohio",
          "Toledo, Ohio",
          "Poetry, trail adventures, running",
        ],
        [
          "US0764", // Kristin Flickinger
          "Female",
          "Ketchum, Idaho",
          "Santa Barbara, California",
          "Cycling and dog communication training",
        ],
        [
          "US0765", // Lewis Kelly
          "Male",
          "Dublin, Ireland",
          "Puerto Rico",
          "Travel and school-bus renovation",
        ],
        [
          "US0766", // Linnea Capobianco
          "Female",
          "Kearny, New Jersey",
          "Jersey City, New Jersey",
          "Photography, jazz performances, Lagree workouts",
        ],
        [
          "US0767", // Maggie Nestor
          "Female",
          "Middleway, West Virginia",
          "Charlestown, West Virginia",
          "Agriculture, outdoor sports, guitar",
        ],
        [
          "US0768", // Mike Pinsky
          "Male",
          "New York City, New York",
          "New York City, New York",
          "Home cooking, basketball, tennis, improv",
        ],
        [
          "US0769", // Ori Jean-Charles
          "Male",
          "Spring Valley, New York",
          "Spring Valley, New York",
          "Food exploration, travel, fashion",
        ],
        [
          "US0770", // Patt Cannaday
          "Female",
          "Tampa, Florida",
          "Washington, D.C.",
          "Boxing, parachuting, hikes, dramatic readings",
        ],
        [
          "US0771", // Rob Antonson
          "Male",
          "Johnston, Rhode Island",
          "Cumberland, Rhode Island",
          "Youth coaching, family trips, karaoke",
        ],
        [
          "US0772", // Sharonda Cox
          "Female",
          "Pompano Beach, Florida",
          "Richmond, Kentucky",
          "Books, fishing, spectator sports",
        ],
        [
          "US0754", // Thien An Nguyen
          "Female",
          "Fort Worth, Texas",
          "Fort Worth, Texas",
          "Travel, distance running, Catan",
        ],
      ] satisfies [
        id: CastawayId,
        gender: string,
        hometown: string,
        residence: string,
        hobbies: string | undefined,
      ][]
    ).map(([id, gender, hometown, residence, hobbies]) => [
      id,
      {
        gender,
        hometown,
        residence,
        hobbies,
        ...(id === "US0754"
          ? { height: "5 ft (self-reported, preseason)" }
          : {}),
        ...(id === "US0769"
          ? {
              height: "6 ft 3 in (self-reported, preseason)",
              weight: "230–235 lb (self-reported, preseason)",
            }
          : {}),
        sources: [locations, questionnaire, castReveal],
      },
    ]),
  );
