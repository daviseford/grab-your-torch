import { describe, expect, it } from "vitest";
import {
  getResetRequestOutcome,
  mapAuthError,
  RESET_REQUEST_CONFIRMATION,
} from "../authErrors";

const firebaseError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

const RAW_PROVIDER_MESSAGE =
  "Firebase: Error (auth/internal-raw-provider-text).";

describe("mapAuthError", () => {
  it("maps credential failures to one generic sign-in message", () => {
    const codes = [
      "auth/invalid-credential",
      "auth/wrong-password",
      "auth/user-not-found",
      "auth/invalid-email",
    ];
    const messages = codes.map(
      (code) =>
        mapAuthError(firebaseError(code, "sensitive provider detail")).message,
    );

    expect(new Set(messages).size).toBe(1);
    for (const code of codes) {
      expect(mapAuthError(firebaseError(code, "x")).category).toBe(
        "invalid-credentials",
      );
    }
  });

  it("maps duplicate email registration", () => {
    const result = mapAuthError(
      firebaseError("auth/email-already-in-use", "raw provider text"),
    );
    expect(result.category).toBe("email-in-use");
  });

  it("maps weak password", () => {
    const result = mapAuthError(
      firebaseError("auth/weak-password", "raw provider text"),
    );
    expect(result.category).toBe("weak-password");
  });

  it("maps throttling", () => {
    const result = mapAuthError(
      firebaseError("auth/too-many-requests", "raw provider text"),
    );
    expect(result.category).toBe("too-many-requests");
  });

  it("maps network failure", () => {
    const result = mapAuthError(
      firebaseError("auth/network-request-failed", "raw provider text"),
    );
    expect(result.category).toBe("network");
  });

  it("maps expired and invalid action codes", () => {
    for (const code of [
      "auth/expired-action-code",
      "auth/invalid-action-code",
    ]) {
      expect(mapAuthError(firebaseError(code, "raw")).category).toBe(
        "expired-action-code",
      );
    }
  });

  it("maps a closed or superseded social sign-in popup to cancelled", () => {
    for (const code of [
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/user-cancelled",
    ]) {
      expect(mapAuthError(firebaseError(code, "raw")).category).toBe(
        "cancelled",
      );
    }
  });

  it("maps blocked popups, provider collisions, and disabled providers", () => {
    expect(
      mapAuthError(firebaseError("auth/popup-blocked", "raw")).category,
    ).toBe("popup-blocked");
    expect(
      mapAuthError(
        firebaseError("auth/account-exists-with-different-credential", "raw"),
      ).category,
    ).toBe("account-exists");
    expect(
      mapAuthError(firebaseError("auth/operation-not-allowed", "raw")).category,
    ).toBe("provider-disabled");
  });

  it("returns a generic safe message for unknown Firebase codes", () => {
    const result = mapAuthError(
      firebaseError("auth/some-future-code", "do not leak this"),
    );
    expect(result.category).toBe("generic");
    expect(result.message).not.toContain("do not leak this");
  });

  it("returns a generic safe message for non-Firebase errors", () => {
    for (const error of [
      new Error("boom"),
      "plain string failure",
      null,
      undefined,
      42,
    ]) {
      const result = mapAuthError(error);
      expect(result.category).toBe("generic");
      expect(result.message).not.toContain("boom");
      expect(result.message).not.toContain("plain string failure");
    }
  });

  it("never includes raw provider message text in the user-facing message", () => {
    const codes = [
      "auth/invalid-credential",
      "auth/email-already-in-use",
      "auth/weak-password",
      "auth/too-many-requests",
      "auth/network-request-failed",
      "auth/expired-action-code",
      "auth/invalid-action-code",
      "auth/unknown-thing",
    ];
    for (const code of codes) {
      const result = mapAuthError(firebaseError(code, RAW_PROVIDER_MESSAGE));
      expect(result.message).not.toContain(RAW_PROVIDER_MESSAGE);
      expect(result.message).not.toContain(code);
    }
  });

  it("uses no em-dash characters in any user-facing message", () => {
    const codes = [
      "auth/invalid-credential",
      "auth/email-already-in-use",
      "auth/weak-password",
      "auth/too-many-requests",
      "auth/network-request-failed",
      "auth/expired-action-code",
      "auth/unknown",
    ];
    for (const code of codes) {
      expect(mapAuthError(firebaseError(code, "raw")).message).not.toContain(
        "—",
      );
    }
    expect(RESET_REQUEST_CONFIRMATION).not.toContain("—");
  });
});

describe("getResetRequestOutcome", () => {
  it("produces an identical confirmation for registered and unregistered emails", () => {
    const success = getResetRequestOutcome(null);
    const unknownEmail = getResetRequestOutcome(
      firebaseError("auth/user-not-found", "There is no user for this email"),
    );
    const invalidEmail = getResetRequestOutcome(
      firebaseError(
        "auth/invalid-email",
        "The email address is badly formatted",
      ),
    );

    expect(success).toEqual({
      status: "confirmed",
      message: RESET_REQUEST_CONFIRMATION,
    });
    expect(unknownEmail).toEqual(success);
    expect(invalidEmail).toEqual(success);
  });

  it("does not disclose account existence in the confirmation message", () => {
    expect(RESET_REQUEST_CONFIRMATION).not.toMatch(/no account/i);
    expect(RESET_REQUEST_CONFIRMATION).not.toMatch(/not found/i);
  });

  it("surfaces real failures instead of a false confirmation", () => {
    const outcome = getResetRequestOutcome(
      firebaseError("auth/network-request-failed", "raw"),
    );

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.error.category).toBe("network");
    }
  });
});
