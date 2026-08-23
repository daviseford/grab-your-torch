import type { ReactNode } from "react";
import classes from "./EmptySlate.module.css";

type EmptySlateProps = {
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
};

/** Empty and no-match states as an outlined rule box with one next action. */
export const EmptySlate = ({ title, children, actions }: EmptySlateProps) => (
  <div className={classes.root}>
    <div className={classes.title}>{title}</div>
    {children && <div className={classes.text}>{children}</div>}
    {actions && <div className={classes.actions}>{actions}</div>}
  </div>
);
