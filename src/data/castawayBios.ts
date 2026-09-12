/** Curated preseason facts only. Never add results or wiki career summaries.
 * Season 51 IDs are provisional, so these entries match season + full name.
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
export const SEASON_51_BIOS: Record<string, CastawayBio> = Object.fromEntries(
  (
    [
      [
        "Aaliyah Puglia",
        "Female",
        "Gloucester City, New Jersey",
        "Providence, Rhode Island",
        undefined,
      ],
      [
        "Alexis Levine",
        "Female",
        "Atlanta, Georgia",
        "Atlanta, Georgia",
        "Books, gardening, family walks",
      ],
      [
        "Ana Sani",
        "Female",
        "Richmond Hill, Ontario, Canada",
        "Toronto, Ontario, Canada",
        "Gaming, piano, coffee, fitness",
      ],
      [
        "Brady Booker",
        "Male",
        "La Salle, Illinois",
        "Knoxville, Tennessee",
        "Outdoor recreation and strength training",
      ],
      [
        "Carter Krull",
        "Male",
        "Rock Rapids, Iowa",
        "Sioux Falls, South Dakota",
        "Woodworking and resin-table making",
      ],
      [
        "Cristian Chavez",
        "Male",
        "Salt Lake City, Utah",
        "Salt Lake City, Utah",
        "Baking, philosophy, family activities",
      ],
      [
        "Danny Kilby",
        "Male",
        "Mount Forest, Ontario, Canada",
        "London, Ontario, Canada",
        "Filmmaking, tabletop games, improv, kayaking",
      ],
      [
        "Devin Way",
        "Male",
        "Lufkin, Texas",
        "Los Angeles, California",
        "Tabletop roleplaying, dancing, comics",
      ],
      [
        "Eric Macksoud",
        "Male",
        "Lincoln, Rhode Island",
        "Windsor Locks, Connecticut",
        "Theater, guitar, games, swimming",
      ],
      [
        "Jelly Loblack",
        "Female",
        "Garland, Texas, and Midwest City, Oklahoma",
        "Bloomington, Indiana",
        "Writing, volleyball, sci-fi, running",
      ],
      [
        "Jenna Doore",
        "Female",
        "Perrysburg, Ohio",
        "Toledo, Ohio",
        "Poetry, trail adventures, running",
      ],
      [
        "Kristin Flickinger",
        "Female",
        "Ketchum, Idaho",
        "Santa Barbara, California",
        "Cycling and dog communication training",
      ],
      [
        "Lewis Kelly",
        "Male",
        "Dublin, Ireland",
        "Puerto Rico",
        "Travel and school-bus renovation",
      ],
      [
        "Linnea Capobianco",
        "Female",
        "Kearny, New Jersey",
        "Jersey City, New Jersey",
        "Photography, jazz performances, Lagree workouts",
      ],
      [
        "Maggie Nestor",
        "Female",
        "Middleway, West Virginia",
        "Charlestown, West Virginia",
        "Agriculture, outdoor sports, guitar",
      ],
      [
        "Mike Pinsky",
        "Male",
        "New York City, New York",
        "New York City, New York",
        "Home cooking, basketball, tennis, improv",
      ],
      [
        "Ori Jean-Charles",
        "Male",
        "Spring Valley, New York",
        "Spring Valley, New York",
        "Food exploration, travel, fashion",
      ],
      [
        "Patt Cannaday",
        "Female",
        "Tampa, Florida",
        "Washington, D.C.",
        "Boxing, parachuting, hikes, dramatic readings",
      ],
      [
        "Rob Antonson",
        "Male",
        "Johnston, Rhode Island",
        "Cumberland, Rhode Island",
        "Youth coaching, family trips, karaoke",
      ],
      [
        "Sharonda Cox",
        "Female",
        "Pompano Beach, Florida",
        "Richmond, Kentucky",
        "Books, fishing, spectator sports",
      ],
      [
        "Thien An Nguyen",
        "Female",
        "Fort Worth, Texas",
        "Fort Worth, Texas",
        "Travel, distance running, Catan",
      ],
    ] satisfies [
      name: string,
      gender: string,
      hometown: string,
      residence: string,
      hobbies: string | undefined,
    ][]
  ).map(([name, gender, hometown, residence, hobbies]) => [
    name,
    {
      gender,
      hometown,
      residence,
      hobbies,
      ...(name === "Thien An Nguyen"
        ? { height: "5 ft (self-reported, preseason)" }
        : {}),
      ...(name === "Ori Jean-Charles"
        ? {
            height: "6 ft 3 in (self-reported, preseason)",
            weight: "230–235 lb (self-reported, preseason)",
          }
        : {}),
      sources: [locations, questionnaire, castReveal],
    },
  ]),
);
