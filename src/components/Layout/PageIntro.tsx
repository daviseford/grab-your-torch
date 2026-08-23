import { Text, Title, type TitleOrder } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./PageIntro.module.css";

type PageIntroProps = {
  /** Short caps tag above the title, e.g. "Seasons" or "Competition". */
  eyebrow?: string;
  /** Caps context line beside the tag, e.g. "Season 50 · Watch-along". */
  context?: string;
  title: ReactNode;
  titleOrder?: TitleOrder;
  description?: ReactNode;
  /** Badges or facts under the description. */
  meta?: ReactNode;
  /** Primary and secondary actions, right-aligned on wide screens. */
  actions?: ReactNode;
  /** Element the title should receive focus through (utility pages). */
  titleId?: string;
};

/**
 * The lower-third: every page's intro in one grammar. One h1 per page, so
 * pass `titleOrder` only for nested surfaces.
 */
export const PageIntro = ({
  eyebrow,
  context,
  title,
  titleOrder = 1,
  description,
  meta,
  actions,
  titleId,
}: PageIntroProps) => (
  <header className={classes.root}>
    <div className={classes.text}>
      {(eyebrow || context) && (
        <div className={classes.eyebrow}>
          {eyebrow && <span className={classes.tag}>{eyebrow}</span>}
          {context && <span className={classes.context}>{context}</span>}
        </div>
      )}
      <Title order={titleOrder} className={classes.title} id={titleId}>
        {title}
      </Title>
      {description && (
        <Text className={classes.description}>{description}</Text>
      )}
      {meta && <div className={classes.meta}>{meta}</div>}
    </div>
    {actions && <div className={classes.actions}>{actions}</div>}
  </header>
);
