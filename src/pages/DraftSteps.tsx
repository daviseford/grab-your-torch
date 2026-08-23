import classes from "./Draft.module.css";

const STEPS = [
  { label: "Draft", hint: "Pick your players" },
  { label: "Prop Bets", hint: "Place your predictions" },
  { label: "Summary", hint: "Review & compete" },
];

type DraftStepsProps = {
  /** Index of the current step. */
  active: number;
};

/** The draft's rundown: three steps, done in League Blue, current in Signal Cyan. */
export const DraftSteps = ({ active }: DraftStepsProps) => (
  <ol className={classes.rundown} aria-label="Draft steps">
    {STEPS.map((step, index) => {
      const isDone = index < active;
      const isNow = index === active;
      return (
        <li
          key={step.label}
          className={[
            classes.step,
            isDone && classes.stepDone,
            isNow && classes.stepNow,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={isNow ? "step" : undefined}
        >
          <span className={classes.rank} aria-hidden="true">
            {index + 1}
          </span>
          <span>
            <b className={classes.stepLabel}>{step.label}</b>
            <small className={classes.stepHint}>{step.hint}</small>
          </span>
        </li>
      );
    })}
  </ol>
);
