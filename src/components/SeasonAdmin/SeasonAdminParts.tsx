import { Accordion, Button, Loader, Title } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./SeasonAdminParts.module.css";

/**
 * Chrome shared by the season workspace's CRUD families. Each family keeps
 * its own data flow, validation, and mutations; these parts only give the
 * create panel, form grid, row actions, and board cells one grammar.
 */

type CreatePanelProps = {
  /** Accordion value; also the collapsed-state key. */
  id: string;
  /** Caps title in the control, e.g. "Add Episode". */
  title: string;
  /** Muted caps qualifier after the title, e.g. "next is episode 14". */
  hint?: ReactNode;
  /** Whether the panel starts open. Families keep their existing default. */
  defaultOpen?: boolean;
  /** Guidance rendered beside the form on wide screens. */
  aside?: ReactNode;
  children: ReactNode;
};

/**
 * The collapsible create panel above a CRUD board. The control is a real
 * h2 so the workspace reads h1 (season) > h2 (panel, board) > h3 (aside).
 */
export const CreatePanel = ({
  id,
  title,
  hint,
  defaultOpen = true,
  aside,
  children,
}: CreatePanelProps) => (
  <Accordion
    defaultValue={defaultOpen ? id : null}
    order={2}
    classNames={{
      root: classes.panel,
      item: classes.panelItem,
      control: classes.panelControl,
      label: classes.panelLabel,
      chevron: classes.panelChevron,
      panel: classes.panelBody,
      content: classes.panelContent,
    }}
  >
    <Accordion.Item value={id}>
      <Accordion.Control>
        <span className={classes.panelTitle}>{title}</span>
        {hint && <span className={classes.panelHint}>{hint}</span>}
      </Accordion.Control>
      <Accordion.Panel>
        {aside ? (
          <div className={classes.twoUp}>
            <div className={classes.formCol}>{children}</div>
            <div>{aside}</div>
          </div>
        ) : (
          <div className={classes.formCol}>{children}</div>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  </Accordion>
);

type PanelAsideProps = {
  title: ReactNode;
  children: ReactNode;
};

/** Guidance card beside a create form ("Before you save"). */
export const PanelAside = ({ title, children }: PanelAsideProps) => (
  <aside className={classes.asideCard}>
    <Title order={3} className={classes.asideTitle}>
      {title}
    </Title>
    {children}
  </aside>
);

export const FormStack = ({ children }: { children: ReactNode }) => (
  <div className={classes.form}>{children}</div>
);

export const FormRow = ({
  children,
  short = false,
}: {
  children: ReactNode;
  /** A short numeric field beside a long one (keeps two-up on phones). */
  short?: boolean;
}) => (
  <div
    className={[classes.formRow, short && classes.formRowShort]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </div>
);

export const FormActions = ({ children }: { children: ReactNode }) => (
  <div className={classes.formActions}>{children}</div>
);

type RowActionsProps = {
  onEdit: () => void;
  onDelete: () => void;
  editLabel: string;
  deleteLabel: string;
};

/**
 * Edit and delete for a board row. Delete is semantic red, separated from
 * edit by a rule, and grows to a 40 px target on phones.
 */
export const RowActions = ({
  onEdit,
  onDelete,
  editLabel,
  deleteLabel,
}: RowActionsProps) => (
  <div className={classes.rowActions}>
    <Button
      size="xs"
      variant="subtle"
      onClick={onEdit}
      aria-label={editLabel}
      className={classes.rowBtn}
    >
      Edit
    </Button>
    <Button
      size="xs"
      variant="subtle"
      color="red"
      onClick={onDelete}
      aria-label={deleteLabel}
      className={`${classes.rowBtn} ${classes.rowDelete}`}
    >
      Delete
    </Button>
  </div>
);

type EditRowActionsProps = {
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
  cancelLabel: string;
};

/** Save and cancel for a board row in edit mode. */
export const EditRowActions = ({
  onSave,
  onCancel,
  saveLabel,
  cancelLabel,
}: EditRowActionsProps) => (
  <div className={classes.rowActions}>
    <Button
      size="xs"
      onClick={onSave}
      aria-label={saveLabel}
      className={classes.rowBtn}
    >
      Save
    </Button>
    <Button
      size="xs"
      variant="default"
      onClick={onCancel}
      aria-label={cancelLabel}
      className={classes.rowBtn}
    >
      Cancel
    </Button>
  </div>
);

/** Empty or prerequisite content inside a flush board body. */
export const BoardEmpty = ({ children }: { children: ReactNode }) => (
  <div className={classes.boardEmpty}>{children}</div>
);

/** Inline loading row for a panel or board. */
export const LoadingRow = ({ label }: { label: string }) => (
  <div className={classes.loadingRow} role="status" aria-live="polite">
    <Loader size="xs" />
    {label}
  </div>
);
