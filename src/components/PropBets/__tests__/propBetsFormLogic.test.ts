import { describe, expect, it } from "vitest";
import {
  PropBetQuestionKeys,
  type PropBetQuestionKey,
} from "../../../data/propbets";
import type { CastawayId, CastawayLookup } from "../../../types";
import {
  buildPropBetOptions,
  countAnsweredPropBets,
  isPropBetFormComplete,
  normalizePropBetValues,
  type PropBetRosterEntry,
} from "../propBetsFormLogic";

const roster = (
  entries: Array<[string, string]>,
): readonly PropBetRosterEntry[] =>
  entries.map(([castaway_id, full_name]) => ({
    castaway_id: castaway_id as CastawayId,
    full_name,
  }));

describe("buildPropBetOptions", () => {
  it("orders a bare roster alphabetically by name and labels with the full name", () => {
    const options = buildPropBetOptions(
      roster([
        ["US0003", "Charlie Brown"],
        ["US0001", "alice Adams"],
        ["US0002", "Bob Barker"],
      ]),
    );

    expect(options).toEqual([
      { value: "US0001", label: "alice Adams" },
      { value: "US0002", label: "Bob Barker" },
      { value: "US0003", label: "Charlie Brown" },
    ]);
  });

  it("orders by the lookup's display name when one is supplied", () => {
    const cast = roster([
      ["US0001", "Zoe Aaronson"],
      ["US0002", "Aaron Zimmer"],
    ]);
    const lookup = {
      US0001: { full_name: "Zoe Aaronson", castaway: "Aaron" },
      US0002: { full_name: "Aaron Zimmer", castaway: "Zoe" },
    } as unknown as CastawayLookup;

    expect(buildPropBetOptions(cast, lookup)).toEqual([
      { value: "US0001", label: "Zoe Aaronson" },
      { value: "US0002", label: "Aaron Zimmer" },
    ]);
  });

  it("does not mutate the roster it was given", () => {
    const cast = roster([
      ["US0002", "Bob Barker"],
      ["US0001", "Alice Adams"],
    ]);
    buildPropBetOptions(cast);
    expect(cast[0].castaway_id).toBe("US0002");
  });

  it("returns an empty list for an empty roster", () => {
    expect(buildPropBetOptions([])).toEqual([]);
  });
});

describe("normalizePropBetValues", () => {
  it("fills every question with an empty answer when nothing is prefilled", () => {
    const values = normalizePropBetValues();

    expect(Object.keys(values).sort()).toEqual([...PropBetQuestionKeys].sort());
    expect(Object.values(values).every((v) => v === "")).toBe(true);
  });

  it("prefills the answers it is given and blanks the rest", () => {
    const values = normalizePropBetValues({
      propbet_winner: "US0001",
      propbet_quit: "Yes",
    });

    expect(values.propbet_winner).toBe("US0001");
    expect(values.propbet_quit).toBe("Yes");
    expect(values.propbet_ftc).toBe("");
    expect(Object.keys(values).sort()).toEqual([...PropBetQuestionKeys].sort());
  });

  it("treats undefined answers in the prefill as unanswered", () => {
    const values = normalizePropBetValues({ propbet_winner: undefined });
    expect(values.propbet_winner).toBe("");
  });

  it("ignores keys that are not prop bet questions", () => {
    const values = normalizePropBetValues({
      not_a_question: "x",
    } as unknown as Record<PropBetQuestionKey, string>);
    expect("not_a_question" in values).toBe(false);
  });
});

const everyAnswer = () =>
  PropBetQuestionKeys.reduce<Record<string, string>>((accum, key) => {
    accum[key] = "US0001";
    return accum;
  }, {});

describe("countAnsweredPropBets", () => {
  it("treats whitespace-only answers as unanswered", () => {
    const values = { ...everyAnswer(), propbet_winner: "  \t " };
    expect(countAnsweredPropBets(values)).toBe(PropBetQuestionKeys.length - 1);
    expect(isPropBetFormComplete(values)).toBe(false);
  });
  it("counts nothing for a blank form", () => {
    expect(countAnsweredPropBets(normalizePropBetValues())).toBe(0);
  });

  it("counts only the questions with a non-empty answer", () => {
    expect(
      countAnsweredPropBets(
        normalizePropBetValues({
          propbet_winner: "US0001",
          propbet_medical_evac: "No",
        }),
      ),
    ).toBe(2);
  });

  it("counts every question when the form is full", () => {
    expect(countAnsweredPropBets(everyAnswer())).toBe(
      PropBetQuestionKeys.length,
    );
  });
});

describe("isPropBetFormComplete", () => {
  it("is false while any question is unanswered", () => {
    expect(isPropBetFormComplete(normalizePropBetValues())).toBe(false);
    expect(
      isPropBetFormComplete(
        normalizePropBetValues({ propbet_winner: "US0001" }),
      ),
    ).toBe(false);
  });

  it("is true once every question has an answer", () => {
    expect(isPropBetFormComplete(everyAnswer())).toBe(true);
  });
});
