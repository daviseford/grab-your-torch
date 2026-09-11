import { Button, TextInput } from "@mantine/core";
import { useId } from "react";
import {
  POOL_HANDLE_MAX,
  suggestPoolHandle,
  validatePoolHandle,
} from "../../utils/poolHandle";
import classes from "./PoolHandleField.module.css";

/**
 * The public handle field.
 *
 * Required, and deliberately EMPTY on arrival. It is never defaulted from the
 * account display name (R5): Google supplies legal names, this page is public
 * and crawlable, and under the signed-out autosave a default would be applied
 * long after the moment the entrant was attending to this field.
 *
 * Handles are not unique, and the field says so. Entry documents are readable
 * only by their owner, so the client cannot check what other people have
 * chosen without machinery this feature does not build; two entrants who pick
 * the same handle both appear on the leaderboard exactly as written.
 */
export type PoolHandleFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Show the validation message even before the field has been touched. */
  showError?: boolean;
  disabled?: boolean;
};

export const PoolHandleField = ({
  value,
  onChange,
  showError = false,
  disabled = false,
}: PoolHandleFieldProps) => {
  const descriptionId = useId();
  const error = showError ? validatePoolHandle(value) : null;

  return (
    <div className={classes.root}>
      <TextInput
        required
        label="Your handle"
        placeholder="e.g. TorchSnuffer12"
        value={value}
        maxLength={POOL_HANDLE_MAX}
        disabled={disabled}
        error={error ?? undefined}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <p id={descriptionId} className={classes.help}>
        This is the only thing shown beside your score on the public
        leaderboard, so pick something you are happy for anyone to see. Two
        people can choose the same handle: it does not have to be unique.
        Letters, numbers, spaces, hyphens, and underscores, up to{" "}
        {POOL_HANDLE_MAX} characters.
      </p>
      <Button
        type="button"
        size="compact-xs"
        variant="subtle"
        color="gray"
        disabled={disabled}
        className={classes.suggest}
        onClick={() => onChange(suggestPoolHandle())}
      >
        Suggest one for me
      </Button>
    </div>
  );
};
