// Cast bootstrapped from the Survivor Wiki, then moved to survivoR's ids and
// names (doehm/survivoR@7336413) by
// `yarn remap-castaway-ids 51 --rewrite-season-file`, mapping fe734ff53fbaf8a3.
// See docs/castaway-id-mapping.md.
//
// The cast block is curated. The daily survivoR sync (scripts/sync-season.ts)
// keeps every committed cast field and only fills fields a castaway lacks; see
// scripts/lib/curated-cast.ts. The episode, challenge, elimination, event and
// vote history exports are regenerated from survivoR on every sync, so edit
// survivoR's data or the transformer rather than these exports.
import {
  CastawayLookup,
  Challenge,
  Elimination,
  Episode,
  GameEvent,
  Player,
  VoteHistory,
} from "../../types";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used only in typeof for type derivation
const CastawayIds = [
  "US0752",
  "US0753",
  "US0755",
  "US0757",
  "US0758",
  "US0759",
  "US0760",
  "US0761",
  "US0762",
  "US0756",
  "US0763",
  "US0764",
  "US0765",
  "US0766",
  "US0767",
  "US0768",
  "US0769",
  "US0770",
  "US0771",
  "US0772",
  "US0754",
] as const;

type CastawayIdType = (typeof CastawayIds)[number];

type SeasonNumber = 51;

const buildPlayer = <T extends CastawayIdType>(
  p: { castaway_id: T; full_name: string; img: string } & Partial<
    Omit<
      Player<T, SeasonNumber>,
      "season_id" | "season_num" | "castaway_id" | "full_name" | "img"
    >
  >,
): Player<T, SeasonNumber> => ({
  ...p,
  season_num: 51,
  season_id: "season_51",
});

export const SEASON_51_CASTAWAY_LOOKUP: CastawayLookup = {
  US0752: { full_name: "Aaliyah Puglia", castaway: "Aaliyah" },
  US0753: { full_name: "Alexis Levine", castaway: "Alexis" },
  US0755: { full_name: "Ana Sani", castaway: "Ana" },
  US0757: { full_name: "Brady Booker", castaway: "Brady" },
  US0758: { full_name: "Carter Krull", castaway: "Carter" },
  US0759: { full_name: "Cristian Chavez", castaway: "Cristian" },
  US0760: { full_name: "Danny Kilby", castaway: "Danny" },
  US0761: { full_name: "Devin Way", castaway: "Devin" },
  US0762: { full_name: "Eric Macksoud", castaway: "Eric" },
  US0756: { full_name: "Angelica Loblack", castaway: "Jelly" },
  US0763: { full_name: "Jenna Doore", castaway: "Jenna" },
  US0764: { full_name: "Kristin Flickinger", castaway: "Kristin" },
  US0765: { full_name: "Lewis Kelly", castaway: "Lewis" },
  US0766: { full_name: "Linnea Capobianco", castaway: "Linnea" },
  US0767: { full_name: "Maggie Nestor", castaway: "Maggie" },
  US0768: { full_name: "Mike Pinsky", castaway: "Mike" },
  US0769: { full_name: "Ori Jean-Charles", castaway: "Ori" },
  US0770: { full_name: "Patt Cannaday", castaway: "Patt" },
  US0771: { full_name: "Rob Antonson", castaway: "Rob" },
  US0772: { full_name: "Sharonda Cox", castaway: "Sharonda" },
  US0754: { full_name: "Thien An Nguyen", castaway: "Thien An" },
};

export const SEASON_51_PLAYERS = [
  buildPlayer({
    castaway_id: "US0752",
    full_name: "Aaliyah Puglia",
    img: "/images/season_51/Aaliyah-Puglia.jpg",
    description:
      "Age: 24 | Hometown: Providence, Rhode Island | Occupation: Chef",
    age: 24,
    profession: "Chef",
    hometown: "Providence, Rhode Island",
  }),
  buildPlayer({
    castaway_id: "US0753",
    full_name: "Alexis Levine",
    img: "/images/season_51/Alexis-Levine.jpg",
    description:
      "Age: 34 | Hometown: Atlanta, Georgia | Occupation: Criminal Defense Attorney",
    age: 34,
    profession: "Criminal Defense Attorney",
    hometown: "Atlanta, Georgia",
  }),
  buildPlayer({
    castaway_id: "US0755",
    full_name: "Ana Sani",
    img: "/images/season_51/Ana-Sani.jpg",
    description:
      "Age: 34 | Hometown: Toronto, Ontario | Occupation: Voice Actress",
    age: 34,
    profession: "Voice Actress",
    hometown: "Toronto, Ontario",
  }),
  buildPlayer({
    castaway_id: "US0757",
    full_name: "Brady Booker",
    img: "/images/season_51/Brady-Booker.jpg",
    description:
      "Age: 27 | Hometown: Knoxville, Tennessee | Occupation: Pro Wrestler",
    age: 27,
    profession: "Pro Wrestler",
    hometown: "Knoxville, Tennessee",
  }),
  buildPlayer({
    castaway_id: "US0758",
    full_name: "Carter Krull",
    img: "/images/season_51/Carter-Krull.jpg",
    description:
      "Age: 24 | Hometown: Sioux Falls, South Dakota | Occupation: Livestock Farmer",
    age: 24,
    profession: "Livestock Farmer",
    hometown: "Sioux Falls, South Dakota",
  }),
  buildPlayer({
    castaway_id: "US0759",
    full_name: "Cristian Chavez",
    img: "/images/season_51/Cristian-Chavez.jpg",
    description:
      "Age: 26 | Hometown: Salt Lake City, Utah | Occupation: Head of HR",
    age: 26,
    profession: "Head of HR",
    hometown: "Salt Lake City, Utah",
  }),
  buildPlayer({
    castaway_id: "US0760",
    full_name: "Danny Kilby",
    img: "/images/season_51/Danny-Kilby.jpg",
    description:
      "Age: 30 | Hometown: London, Ontario | Occupation: Game Designer",
    age: 30,
    profession: "Game Designer",
    hometown: "London, Ontario",
  }),
  buildPlayer({
    castaway_id: "US0761",
    full_name: "Devin Way",
    img: "/images/season_51/Devin-Way.jpg",
    description:
      "Age: 33 | Hometown: Los Angeles, California | Occupation: Actor",
    age: 33,
    profession: "Actor",
    hometown: "Los Angeles, California",
  }),
  buildPlayer({
    castaway_id: "US0762",
    full_name: "Eric Macksoud",
    img: "/images/season_51/Eric-Macksoud.jpg",
    description:
      "Age: 34 | Hometown: Windsor Locks, Connecticut | Occupation: Mental Health Counselor",
    age: 34,
    profession: "Mental Health Counselor",
    hometown: "Windsor Locks, Connecticut",
  }),
  buildPlayer({
    castaway_id: "US0756",
    full_name: "Angelica Loblack",
    img: "/images/season_51/Jelly-Loblack.jpg",
    description:
      "Age: 29 | Hometown: Bloomington, Indiana | Occupation: Sociology Professor",
    age: 29,
    profession: "Sociology Professor",
    hometown: "Bloomington, Indiana",
    nickname: "Jelly",
  }),
  buildPlayer({
    castaway_id: "US0763",
    full_name: "Jenna Doore",
    img: "/images/season_51/Jenna-Doore.jpg",
    description:
      "Age: 30 | Hometown: Toledo, Ohio | Occupation: Wedding Photographer",
    age: 30,
    profession: "Wedding Photographer",
    hometown: "Toledo, Ohio",
  }),
  buildPlayer({
    castaway_id: "US0764",
    full_name: "Kristin Flickinger",
    img: "/images/season_51/Kristin-Flickinger.jpg",
    description:
      "Age: 53 | Hometown: Santa Barbara, California | Occupation: Crisis Management",
    age: 53,
    profession: "Crisis Management",
    hometown: "Santa Barbara, California",
  }),
  buildPlayer({
    castaway_id: "US0765",
    full_name: "Lewis Kelly",
    img: "/images/season_51/Lewis-Kelly.jpg",
    description: "Age: 28 | Hometown: Puerto Rico | Occupation: Farmer",
    age: 28,
    profession: "Farmer",
    hometown: "Puerto Rico",
  }),
  buildPlayer({
    castaway_id: "US0766",
    full_name: "Linnea Capobianco",
    img: "/images/season_51/Linnea-Capobianco.jpg",
    description:
      "Age: 25 | Hometown: Jersey City, New Jersey | Occupation: Entrepreneur",
    age: 25,
    profession: "Entrepreneur",
    hometown: "Jersey City, New Jersey",
  }),
  buildPlayer({
    castaway_id: "US0767",
    full_name: "Maggie Nestor",
    img: "/images/season_51/Maggie-Nestor.jpg",
    description:
      "Age: 40 | Hometown: Charlestown, West Virginia | Occupation: Farmer",
    age: 40,
    profession: "Farmer",
    hometown: "Charlestown, West Virginia",
  }),
  buildPlayer({
    castaway_id: "US0768",
    full_name: "Mike Pinsky",
    img: "/images/season_51/Mike-Pinsky.jpg",
    description:
      "Age: 32 | Hometown: New York City, New York | Occupation: Baseball Executive",
    age: 32,
    profession: "Baseball Executive",
    hometown: "New York City, New York",
    nickname: "Mike",
  }),
  buildPlayer({
    castaway_id: "US0769",
    full_name: "Ori Jean-Charles",
    img: "/images/season_51/Ori-Jean-Charles.jpg",
    description:
      "Age: 27 | Hometown: Spring Valley, New York | Occupation: Personal Trainer",
    age: 27,
    profession: "Personal Trainer",
    hometown: "Spring Valley, New York",
  }),
  buildPlayer({
    castaway_id: "US0770",
    full_name: "Patt Cannaday",
    img: "/images/season_51/Patt-Cannaday.jpg",
    description:
      "Age: 33 | Hometown: Washington, District of Columbia | Occupation: Federal Prosecutor",
    age: 33,
    profession: "Federal Prosecutor",
    hometown: "Washington, District of Columbia",
    nickname: "Patt",
  }),
  buildPlayer({
    castaway_id: "US0771",
    full_name: "Rob Antonson",
    img: "/images/season_51/Rob-Antonson.jpg",
    description:
      "Age: 34 | Hometown: Cumberland, Rhode Island | Occupation: Airline Gate Agent",
    age: 34,
    profession: "Airline Gate Agent",
    hometown: "Cumberland, Rhode Island",
  }),
  buildPlayer({
    castaway_id: "US0772",
    full_name: "Sharonda Cox",
    img: "/images/season_51/Sharonda-Cox.jpg",
    description:
      "Age: 34 | Hometown: Richmond, Kentucky | Occupation: Resident, OBGYN",
    age: 34,
    profession: "Resident, OBGYN",
    hometown: "Richmond, Kentucky",
  }),
  buildPlayer({
    castaway_id: "US0754",
    full_name: "Thien An Nguyen",
    img: "/images/season_51/Thien-An-Nguyen.jpg",
    description:
      "Age: 24 | Hometown: Fort Worth, Texas | Occupation: Medical Student",
    age: 24,
    profession: "Medical Student",
    hometown: "Fort Worth, Texas",
    nickname: "Thien An",
  }),
] satisfies Player<CastawayIdType, SeasonNumber>[];

export const SEASON_51_EPISODES = [
  {
    id: "episode_1",
    season_id: "season_51",
    season_num: 51,
    order: 1,
    name: "Permanent Uncertainty",
    air_date: "2026-09-23",
    post_merge: false,
    finale: false,
    merge_occurs: false,
  },
] satisfies Episode<SeasonNumber>[];

export const SEASON_51_CHALLENGES = {
  challenge_0: {
    id: "challenge_0",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    variant: "team_immunity",
    order: 0,
    winning_castaways: [
      "US0753",
      "US0755",
      "US0758",
      "US0759",
      "US0762",
      "US0764",
      "US0766",
      "US0769",
      "US0771",
      "US0772",
    ],
  },
} satisfies Record<Challenge["id"], Challenge<CastawayIdType, SeasonNumber>>;

export const SEASON_51_ELIMINATIONS = {
  elimination_1: {
    id: "elimination_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    order: 1,
    castaway_id: "US0752",
    variant: "tribal",
  },
} satisfies Record<
  Elimination["id"],
  Elimination<CastawayIdType, SeasonNumber>
>;

export const SEASON_51_EVENTS = {
  event_1: {
    id: "event_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    castaway_id: "US0771",
    action: "find_idol",
    multiplier: null,
  },
  event_2: {
    id: "event_2",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    castaway_id: "US0752",
    action: "use_shot_in_the_dark_unsuccessfully",
    multiplier: null,
  },
  event_3: {
    id: "event_3",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    castaway_id: "US0763",
    action: "use_shot_in_the_dark_unsuccessfully",
    multiplier: null,
  },
} satisfies Record<GameEvent["id"], GameEvent<CastawayIdType, SeasonNumber>>;

export const SEASON_51_VOTE_HISTORY = {
  vote_1_US0754_US0752_1: {
    id: "vote_1_US0754_US0752_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0754",
    target_castaway_id: "US0752",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0756_US0763_1: {
    id: "vote_1_US0756_US0763_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0756",
    target_castaway_id: "US0763",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0757_US0752_1: {
    id: "vote_1_US0757_US0752_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0757",
    target_castaway_id: "US0752",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0760_US0752_1: {
    id: "vote_1_US0760_US0752_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0760",
    target_castaway_id: "US0752",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0761_US0763_1: {
    id: "vote_1_US0761_US0763_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0761",
    target_castaway_id: "US0763",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0767_US0752_1: {
    id: "vote_1_US0767_US0752_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0767",
    target_castaway_id: "US0752",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0768_US0752_1: {
    id: "vote_1_US0768_US0752_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0768",
    target_castaway_id: "US0752",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
  vote_1_US0770_US0752_1: {
    id: "vote_1_US0770_US0752_1",
    season_id: "season_51",
    season_num: 51,
    episode_id: "episode_1",
    episode_num: 1,
    tribe: "Toka",
    voter_castaway_id: "US0770",
    target_castaway_id: "US0752",
    voted_out_castaway_id: "US0752",
    nullified: false,
    tie: false,
    sog_id: 1,
    vote_order: 1,
  },
} satisfies Record<
  VoteHistory["id"],
  VoteHistory<CastawayIdType, SeasonNumber>
>;
