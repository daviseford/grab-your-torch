import { StatCard } from "../../utils/seasonStats";
import classes from "./SeasonStatsSection.module.css";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

export const SeasonStatsCard = ({
  card,
  portraits,
}: {
  card: StatCard;
  /** Portrait URL by winner id (castaway cards only). */
  portraits?: Record<string, string | undefined>;
}) => {
  const isNegative = card.tone === "negative";
  const isTied = card.winners.length > 1;

  return (
    <div
      className={`${classes.card} ${isNegative ? classes.cardNegative : ""}`}
    >
      <div>
        <h4 className={classes.cardTitle}>{card.title}</h4>
        {card.subtitle && (
          <div className={classes.cardSubtitle}>{card.subtitle}</div>
        )}
      </div>

      {isTied ? (
        <div>
          <div className={classes.tied}>
            {card.winners.map((w) => w.label).join(", ")}
          </div>
          <div className={classes.cardSubtitle}>
            Tied: {card.winners[0].value} {card.unit}
          </div>
        </div>
      ) : (
        card.winners.map((w, idx) => {
          const img = portraits?.[w.id];
          const showPortrait = card.group === "castaway";
          return (
            <div key={`${w.id}_${idx}`} className={classes.winner}>
              {showPortrait &&
                (img ? (
                  <img
                    src={img}
                    alt=""
                    width={36}
                    height={46}
                    loading="lazy"
                    decoding="async"
                    className={classes.face}
                  />
                ) : (
                  <span className={classes.facePlaceholder} aria-hidden="true">
                    {initials(w.label)}
                  </span>
                ))}
              <div>
                <div className={classes.winnerName}>{w.label}</div>
                <div className={classes.value}>
                  {w.value}
                  <small>
                    {card.unit}
                    {w.detail ? ` · ${w.detail}` : ""}
                  </small>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
