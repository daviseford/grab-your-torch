import { Badge, Button, Table, Title } from "@mantine/core";
import { useMemo, useState } from "react";
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
import { HomeDraftExample } from "./HomeDraftExample";
import { HomeResumeDrafts } from "./HomeResumeDrafts";

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

/** Fictional per-episode points for the reveal-strip example (13 episodes). */
const EXAMPLE_EPISODES = 13;

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
  const [exampleRevealed, setExampleRevealed] = useState(6);
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
        {/* Way back into an open draft (only renders when one exists) */}
        <HomeResumeDrafts />

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
                All {SEASON_COUNT} US seasons and {CASTAWAY_COUNT}+ castaways
                are ready to play, from the original Borneo to the season airing
                now. Browse by era, search by name or location, and start a
                competition on any of them.
              </p>
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
              <RevealStrip
                total={EXAMPLE_EPISODES}
                revealedThrough={exampleRevealed}
                legend
                ariaLabel="Example episode reveal"
                onSelect={setExampleRevealed}
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
            <HomeDraftExample />
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
