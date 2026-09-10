import { Button } from "@mantine/core";
import { useState } from "react";
import { Notice } from "../Layout";
import { validatePoolHandle } from "../../utils/poolHandle";
import { PoolHandleField } from "./PoolHandleField";
import classes from "./PoolHandleOnlyForm.module.css";

/**
 * The one edit that survives the freeze (R5, R9).
 *
 * After entries close, picks and prop bets are settled and only the handle can
 * still change. The rules accept a two-key diff and reject the same write the
 * moment a pick rides along (AE6), so this form has no access to picks at all.
 *
 * KTD5 is why the note about the next update is not optional: a handle is not
 * part of any revision the standings cache is stamped with, so the published
 * leaderboard keeps showing the old one until the next recompute. Saying so is
 * the difference between a delay and an apparently broken save.
 */
export type PoolHandleOnlyFormProps = {
  /** The handle currently stored on the entry. */
  handle: string;
  /** Resolves once the server has answered. */
  onSave: (handle: string) => Promise<{ ok: boolean; retryable: boolean }>;
};

export const PoolHandleOnlyForm = ({
  handle,
  onSave,
}: PoolHandleOnlyFormProps) => {
  const [value, setValue] = useState(handle);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const [outcome, setOutcome] = useState<"saved" | "retry" | null>(null);

  const invalid = validatePoolHandle(value) !== null;
  const unchanged = value === handle;

  const save = async () => {
    setTouched(true);
    if (invalid || unchanged) return;
    setSaving(true);
    setOutcome(null);
    const result = await onSave(value);
    setSaving(false);
    // A denial is reported by the page, which keeps one record of it whether
    // or not this form is still mounted.
    setOutcome(result.ok ? "saved" : result.retryable ? "retry" : null);
  };

  return (
    <div className={classes.root}>
      <PoolHandleField
        value={value}
        onChange={(next) => {
          setValue(next);
          setOutcome(null);
        }}
        showError={touched}
        disabled={saving}
      />
      <p className={classes.note}>
        Entries are closed, so your picks and prop bets are settled. Your handle
        can still change: a new one appears on the leaderboard at the next
        update, not straight away.
      </p>
      {outcome === "saved" && (
        <Notice label="Saved" tone="success" role="status">
          Your handle is now {value}. It appears on the leaderboard at the next
          update.
        </Notice>
      )}
      {outcome === "retry" && (
        <Notice
          label="Not saved"
          tone="danger"
          role="alert"
          actions={
            <Button size="xs" variant="default" onClick={() => void save()}>
              Try again
            </Button>
          }
        >
          We could not save your handle. Check your connection and try again.
        </Notice>
      )}
      <div>
        <Button
          type="button"
          variant="default"
          disabled={saving || unchanged}
          onClick={() => void save()}
        >
          {saving ? "Saving..." : "Save my handle"}
        </Button>
      </div>
    </div>
  );
};
