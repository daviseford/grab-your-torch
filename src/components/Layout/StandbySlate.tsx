import type { HTMLAttributes, ReactNode } from "react";
import classes from "./StandbySlate.module.css";

type StandbySlateProps = HTMLAttributes<HTMLElement> & {
  /** Small cyan label above the content, e.g. "404" or "Signed out". */
  code?: string;
  /** Actions row rendered under the content. */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * The standby slate: one block of content on a Night Navy plate beneath the
 * stacked lockup. Utility states (not found, route error, logout, password
 * reset, access denied) share it so they read as one brand moment.
 *
 * Buttons placed in `actions` should be primary, or
 * `variant="outline" color="dark.0"` for the secondary slate on navy.
 */
export const StandbySlate = ({
  code,
  actions,
  children,
  className,
  ...rest
}: StandbySlateProps) => (
  <div className={classes.wrapper}>
    <section
      className={[classes.root, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <img
        src="/brand/grab-your-torch-stacked-dark.svg"
        alt=""
        width={132}
        height={132}
        className={classes.lockup}
        decoding="async"
        draggable={false}
      />
      {code && <span className={classes.code}>{code}</span>}
      <div className={classes.body}>{children}</div>
      {actions && <div className={classes.actions}>{actions}</div>}
    </section>
  </div>
);
