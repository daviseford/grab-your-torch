import { Board, PageIntro, useBugContext } from "../components/Layout";
import { ScoringLegendTable } from "../components/ScoringTables/ScoringLegendTable";
import { BASE_PLAYER_SCORING } from "../data/scoring";
import classes from "./ScoringReference.module.css";

const ACTION_COUNT = BASE_PLAYER_SCORING.length;
const CATEGORY_COUNT = new Set(BASE_PLAYER_SCORING.map((s) => s.category)).size;

export const ScoringReference = () => {
  useBugContext("Scoring");
  return (
    <div className={classes.page}>
      <PageIntro
        eyebrow="Scoring"
        title="Scoring reference"
        description="Points awarded for in-game actions across all competitions."
        meta={
          <span className={classes.facts}>
            <span>
              <b>{ACTION_COUNT}</b> actions
            </span>
            <span>
              <b>{CATEGORY_COUNT}</b> categories
            </span>
          </span>
        }
      />
      <Board
        title="Scoring legend"
        subtitle="Points per action"
        titleAs="h2"
        flush
        className={classes.legendBoard}
      >
        <ScoringLegendTable />
      </Board>
    </div>
  );
};
