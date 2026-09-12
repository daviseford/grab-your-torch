import { Button, Select } from "@mantine/core";
import { isNotEmpty, useForm } from "@mantine/form";
import { useMemo } from "react";
import {
  PropBetQuestionKey,
  PropBetQuestionKeys,
  PropBetsQuestions,
} from "../../data/propbets";
import type { CastawayLookup, PropBetsFormData } from "../../types";
import classes from "./PropBetsForm.module.css";
import { PropBetHelp } from "./propBetHelp";
import {
  buildPropBetOptions,
  countAnsweredPropBets,
  normalizePropBetValues,
  type PropBetRosterEntry,
} from "./propBetsFormLogic";

export type PropBetsFormProps = {
  /**
   * The castaways the castaway-typed questions choose from. A season's
   * `players` satisfy this, and so does a bare pool roster.
   */
  cast: readonly PropBetRosterEntry[];
  /**
   * Display-name lookup used to order the options. Optional: a roster with no
   * season document behind it orders by full name.
   */
  castawayLookup?: CastawayLookup;
  /**
   * Answers to start from. Read once, when the form mounts: a consumer whose
   * prefill arrives asynchronously should render the form only after it has
   * loaded, or remount it with a `key`.
   */
  initialValues?: PropBetsFormData;
  /** Wording on the submit slate. */
  submitLabel?: string;
  onSubmit: (values: PropBetsFormData) => void;
  /** Optional draft autosave, called whenever an answer changes. */
  onValuesChange?: (values: PropBetsFormData) => void;
};

export const PropBetsForm = ({
  cast,
  castawayLookup,
  initialValues,
  submitLabel = "Submit Prop Bets",
  onSubmit,
  onValuesChange,
}: PropBetsFormProps) => {
  const startingValues = useMemo(
    () => normalizePropBetValues(initialValues),
    // Mantine's useForm reads initialValues once, so recomputing this on a
    // later prop change would have no effect anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const validate = useMemo(
    () =>
      PropBetQuestionKeys.reduce<
        Partial<Record<PropBetQuestionKey, ReturnType<typeof isNotEmpty>>>
      >((accum, key) => {
        accum[key] = isNotEmpty("Enter an answer");
        return accum;
      }, {}),
    [],
  );

  const form = useForm<PropBetsFormData>({
    initialValues: startingValues,
    validate,
    onValuesChange,
  });

  const playerOptions = useMemo(
    () => buildPropBetOptions(cast, castawayLookup),
    [cast, castawayLookup],
  );

  const handleSubmit = async (
    e: React.FormEvent<HTMLFormElement> | undefined,
  ) => {
    e?.preventDefault();

    const _validate = form.validate();

    if (_validate.hasErrors) return;

    onSubmit(form.values);
  };

  const answered = countAnsweredPropBets(form.values);

  return (
    <form onSubmit={handleSubmit}>
      <div className={classes.formGrid}>
        {PropBetQuestionKeys.map((key) => {
          const question = PropBetsQuestions[key];
          const help = PropBetHelp[key];
          return (
            <Select
              key={key}
              required
              label={question.description}
              description={
                help
                  ? `${question.point_value} points · ${help}`
                  : `${question.point_value} points`
              }
              placeholder="Pick one"
              data={
                question.answer_type === "boolean"
                  ? ["Yes", "No"]
                  : playerOptions
              }
              {...form.getInputProps(key)}
            />
          );
        })}
      </div>
      <div className={classes.formActions}>
        <Button type="submit" size="md">
          {submitLabel}
        </Button>
        <span className={classes.formCount}>
          {answered} of {PropBetQuestionKeys.length} answered
        </span>
      </div>
    </form>
  );
};
