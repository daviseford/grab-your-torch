import type { ReactNode } from "react";
import classes from "./Notice.module.css";

type NoticeProps = {
  /** Short caps label naming the kind of notice, e.g. "Saved" or "Tip". */
  label: string;
  tone?: "info" | "success" | "warning" | "danger";
  actions?: ReactNode;
  children: ReactNode;
  /** Live-region role for outcomes that should be announced. */
  role?: "status" | "alert";
};

/** Inline guidance and outcomes as a hairline rule box, never a tinted card. */
export const Notice = ({
  label,
  tone = "info",
  actions,
  children,
  role,
}: NoticeProps) => (
  <div className={[classes.root, classes[tone]].join(" ")} role={role}>
    <span className={classes.label}>{label}</span>
    <div className={classes.body}>{children}</div>
    {actions && <div className={classes.actions}>{actions}</div>}
  </div>
);
