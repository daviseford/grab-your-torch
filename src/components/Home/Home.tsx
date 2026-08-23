import { Badge, Button, Table, Title } from "@mantine/core";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { PropBetsQuestions } from "../../data/propbets";
import { BASE_PLAYER_SCORING, type ScoringCategory } from "../../data/scoring";
import { SEASON_METADATA } from "../../data/season-metadata";
import { useUser } from "../../hooks/useUser";
import { getSeasonEra } from "../../pages/SeasonEras";
import { SeasonTile } from "../../pages/SeasonTile";
import { BrandEmblem } from "../Brand";
import { Board, RevealStrip } from "../Layout";
import classes from "./Home.module.css";

/** Scoring category colors, kept semantic app-wide. */
const CATEGORY_COLORS: Record<ScoringCategory, string> = {
  Challenges: "blue",
  Milestones: "teal",
  Idols: "yellow",
  Advantages: "grape",
  Other: "gray",
};

const CATEGORY_ORDER: ScoringCategory[] = [
  "Challenges",
  "Milestones",
  "Idols",
  "Advantages",
  "Other",
];

/** Four actions that show the range of the system. */
const EXAMPLE_ACTIONS = [
  "immunity",
  "use_idol",
  "use_knowledge_is_power",
  "win_survivor",
] as const;

/** Five predictions that show the range of the prop bets. */
const EXAMPLE_BETS = [
  "propbet_winner",
  "propbet_first_vote",
  "propbet_idols",
  "propbet_medical_evac",
  "propbet_successful_shot_in_the_dark",
] as const;

/**
 * The example standings are fictional: made-up participants and points,
 * no castaways, no season, no episode. The homepage never shows a real
 * competition's results.
 */
const EXAMPLE_STANDINGS = [
  { name: "Marisol", points: 184 },
  { name: "Theo", points: 171 },
  { name: "Priya", points: 158 },
  { name: "Jordan", points: 142 },
];

const ACTION_COUNT = BASE_PLAYER_SCORING.length;
const CATEGORY_COUNT = new Set(BASE_PLAYER_SCORING.map((s) => s.category)).size;
const ALL_BETS = Object.values(PropBetsQuestions);
const BET_COUNT = ALL_BETS.length;
const MAX_BET_POINTS = ALL_BETS.reduce((sum, bet) => sum + bet.point_value, 0);
const SEASON_COUNT = Object.keys(SEASON_METADATA).length;
// Unique people, not appearances: returning players would inflate a sum of
// per-season cast sizes. The figure is pinned to the hundreds and checked
// against the season data in src/data/__tests__/castawayClaim.test.ts, so
// the homepage never imports every season file just to print it.
const CASTAWAY_COUNT = 700;

const scoringByAction = new Map(
  BASE_PLAYER_SCORING.map((entry) => [entry.action, entry]),
);

export const Home = () => {
  const { slimUser } = useUser();

  const seasons = useMemo(
    () => Object.values(SEASON_METADATA).sort((a, b) => b.order - a.order),
    [],
  );
  const liveSeasonId = seasons.find((m) => !m.complete)?.id ?? null;
  const guideSeasons = seasons.slice(0, 5);

  return (
    <div className={classes.root}>
      {/* Hero: the broadcast frame, navy in both schemes */}
      <section aria-label="Hero" className={classes.frame}>
        <div className={`${classes.inner} ${classes.hero}`}>
          <div className={classes.copy}>
            <p className={classes.eyebrow}>Fantasy Survivor for friends</p>
            <Title order={1} className={classes.title}>
              Grab your torch and draft your Survivor fantasy team
            </Title>
            <p className={classes.sub}>
              Pick a season, draft your favorite contestants, and compete to see
              whose team racks up the most points as the game plays out.
            </p>
            <div className={classes.ctas}>
              <Button size="lg" component={Link} to="/seasons">
                Pick a season to get started
              </Button>
              {slimUser && (
                <Button
                  size="lg"
                  variant="outline"
                  color="dark.0"
                  component={Link}
                  to="/competitions"
                >
                  Your competitions
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                color="dark.0"
                component={Link}
                to="/scoring"
              >
                How scoring works
              </Button>
            </div>
          </div>
          <BrandEmblem height={240} className={classes.emblem} />
        </div>
      </section>

      <div className={classes.sections}>
        {/* Example standings: fictional participants and points only */}
        <section aria-labelledby="home-standings" className={classes.section}>
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-standings" className={classes.h2}>
                A competition in progress
              </h2>
              <p className={classes.lead}>
                Example standings for a four-person competition. The names and
                points are made up; your board fills in as your group watches.
              </p>
            </div>
            <Board
              title="Example standings"
              subtitle="Four participants"
              flush
              className={classes.boardNarrow}
            >
              <ol className={classes.standings}>
                {EXAMPLE_STANDINGS.map((row, index) => (
                  <li key={row.name}>
                    <span
                      className={`${classes.rank} ${index === 0 ? classes.rankFirst : ""}`}
                    >
                      {index + 1}
                    </span>
                    <span className={classes.standingName}>{row.name}</span>
                    <span className={classes.points}>
                      {row.points}
                      <small>pts</small>
                    </span>
                  </li>
                ))}
              </ol>
            </Board>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="home-how" className={classes.section}>
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-how" className={classes.h2}>
                How it works
              </h2>
            </div>
            <ol className={classes.steps}>
              <li>
                <b>Pick a season</b>
                <p>Browse seasons and check out the cast before you commit.</p>
              </li>
              <li>
                <b>Draft your team</b>
                <p>
                  Invite friends, take turns picking players, and build your
                  roster.
                </p>
              </li>
              <li>
                <b>Compete for points</b>
                <p>
                  Earn points as your players win challenges, find idols, and
                  survive.
                </p>
              </li>
            </ol>
          </div>
        </section>

        {/* Program guide preview */}
        <section aria-labelledby="home-seasons" className={classes.section}>
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-seasons" className={classes.h2}>
                Every season of Survivor
              </h2>
              <p className={classes.lead}>
                All {SEASON_COUNT} US seasons are ready to play, from the
                original Borneo to the newest season. Browse by era, search by
                name or location, and start a competition on any season, past or
                present. The season currently airing gets live updates as each
                episode airs.
              </p>
              <div className={classes.facts}>
                <span>
                  <b>{SEASON_COUNT}</b> seasons
                </span>
                <span>
                  <b>{CASTAWAY_COUNT}+</b> castaways
                </span>
                <span>
                  <b>4</b> eras
                </span>
                <span>
                  <b>Live</b> updates
                </span>
              </div>
            </div>
            <div className={classes.guide}>
              {guideSeasons.map((meta) => {
                const live = meta.id === liveSeasonId;
                return (
                  <SeasonTile
                    key={meta.id}
                    meta={meta}
                    live={live}
                    metaLine={
                      live ? "Now airing" : getSeasonEra(meta.order).label
                    }
                  />
                );
              })}
            </div>
            <div className={classes.foot}>
              <Button component={Link} to="/seasons" variant="outline">
                Browse all seasons
              </Button>
            </div>
          </div>
        </section>

        {/* Watch-along: the reveal strip example */}
        <section
          aria-labelledby="home-watch"
          className={`${classes.section} ${classes.sectionPlate}`}
        >
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-watch" className={classes.h2}>
                Watch at your own pace
              </h2>
              <p className={classes.lead}>
                Every competition has its own current episode, set by its
                creator, so groups on different seasons and paces never see each
                other's results. Scores, standings, and predictions only reflect
                what your group has actually watched. When you're ready for the
                next episode, advance the counter and watch the points shift.
              </p>
            </div>
            <figure className={`${classes.example} ${classes.exampleStrip}`}>
              <figcaption className={classes.caption}>
                Example: a competition that has revealed episodes 1 to 6
              </figcaption>
              <RevealStrip
                total={13}
                revealedThrough={6}
                legend
                ariaLabel="Example episode reveal"
              />
            </figure>
          </div>
        </section>

        {/* Scoring */}
        <section aria-labelledby="home-scoring" className={classes.section}>
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-scoring" className={classes.h2}>
                A system that rewards smart drafting
              </h2>
              <p className={classes.lead}>
                {ACTION_COUNT} scoring actions across {CATEGORY_COUNT}{" "}
                categories, so challenge beasts, idol players, and social
                savants all earn points their own way. Even early boots
                contribute: elimination points scale by episode, so every pick
                matters.
              </p>
              <div className={classes.cats}>
                {CATEGORY_ORDER.map((category) => (
                  <Badge
                    key={category}
                    variant="filled"
                    color={CATEGORY_COLORS[category]}
                  >
                    {category}
                  </Badge>
                ))}
              </div>
            </div>
            <figure className={`${classes.example} ${classes.exampleNarrow}`}>
              <figcaption className={classes.caption}>
                Example: 4 of the {ACTION_COUNT} actions
              </figcaption>
              <Board title="Sample actions" flush scroll>
                <Table className={classes.table}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Action</Table.Th>
                      <Table.Th>Category</Table.Th>
                      <Table.Th ta="right">Points</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {EXAMPLE_ACTIONS.map((action) => {
                      const entry = scoringByAction.get(action);
                      if (!entry || entry.fixed_value == null) return null;
                      return (
                        <Table.Tr key={action}>
                          <Table.Td>
                            <span className={classes.action}>
                              {entry.description.replace(/\.$/, "")}
                            </span>
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              variant="filled"
                              color={CATEGORY_COLORS[entry.category]}
                            >
                              {entry.category}
                            </Badge>
                          </Table.Td>
                          <Table.Td ta="right">
                            <span
                              className={`${classes.scoreVal} ${action === "win_survivor" ? classes.flame : ""}`}
                            >
                              +{entry.fixed_value}
                            </span>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Board>
            </figure>
            <div className={classes.foot}>
              <Button component={Link} to="/scoring" variant="outline">
                How scoring works
              </Button>
            </div>
          </div>
        </section>

        {/* Predictions */}
        <section
          aria-labelledby="home-bets"
          className={`${classes.section} ${classes.sectionPlate}`}
        >
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-bets" className={classes.h2}>
                Predict the game before it starts
              </h2>
              <p className={classes.lead}>
                After the draft, every participant answers {BET_COUNT}{" "}
                predictions. Correct calls earn up to {MAX_BET_POINTS} bonus
                points, enough to swing the standings even if your draft goes
                sideways.
              </p>
            </div>
            <figure className={`${classes.example} ${classes.exampleNarrow}`}>
              <figcaption className={classes.caption}>
                Example: {EXAMPLE_BETS.length} of the {BET_COUNT} predictions
              </figcaption>
              <ol className={classes.bets}>
                {EXAMPLE_BETS.map((key) => {
                  const bet = PropBetsQuestions[key];
                  return (
                    <li key={key}>
                      <span>{bet.description}</span>
                      <span className={classes.betPts}>
                        {bet.point_value}
                        <small>pts</small>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </figure>
          </div>
        </section>

        {/* Draft night */}
        <section aria-labelledby="home-draft" className={classes.section}>
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-draft" className={classes.h2}>
                Draft night, every night
              </h2>
              <p className={classes.lead}>
                Share a link and friends join with a free account, then everyone
                takes turns picking from the full cast in real time on any
                device, after an animated order reveal. Browsing seasons and
                castaways never needs an account.
              </p>
            </div>
            <figure className={`${classes.example} ${classes.exampleNarrow}`}>
              <figcaption className={classes.caption}>
                Example: the draft order for a four-person draft
              </figcaption>
              <ol className={classes.picks}>
                {EXAMPLE_STANDINGS.map((row, index) => (
                  <li key={row.name}>
                    <span className={`${classes.rank} ${classes.pickRank}`}>
                      {index + 1}
                    </span>
                    <span>
                      {row.name} picks {ordinal(index + 1)}
                    </span>
                  </li>
                ))}
              </ol>
            </figure>
          </div>
        </section>

        {/* Trades */}
        <section
          aria-labelledby="home-trades"
          className={`${classes.section} ${classes.sectionPlate}`}
        >
          <div className={classes.inner}>
            <div className={classes.head}>
              <h2 id="home-trades" className={classes.h2}>
                Outwit your friends after the draft
              </h2>
              <p className={classes.lead}>
                Package active players into an offer, send it to another
                participant, and negotiate your way back into contention.
                Accept, reject, or withdraw while an offer is pending. Deals
                take effect at the next episode reveal, so past points stay put.
              </p>
            </div>
          </div>
        </section>

        {/* Closing slate */}
        <section aria-labelledby="home-cta" className={classes.section}>
          <div className={classes.inner}>
            <div className={classes.closing}>
              <div>
                <h2 id="home-cta" className={classes.closingTitle}>
                  Ready to play?
                </h2>
                <p className={classes.closingText}>
                  Pick a season, invite your friends, and find out who really
                  knows Survivor best.
                </p>
              </div>
              <Button size="lg" component={Link} to="/seasons">
                Browse seasons
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

const ordinal = (n: number) =>
  n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`;
