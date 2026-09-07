/**
 * Firebase Auth error boundary (KTD5).
 *
 * Provider error codes map to stable product categories with fixed,
 * user-readable messages. Raw provider message text never reaches the UI.
 * Sign-in credential failures share one generic message, and the
 * reset-request confirmation is identical whether or not the email identifies
 * an account.
 */

export type AuthErrorCategory =
  | "invalid-credentials"
  | "email-in-use"
  | "weak-password"
  | "too-many-requests"
  | "network"
  | "expired-action-code"
  | "cancelled"
  | "popup-blocked"
  | "account-exists"
  | "provider-disabled"
  | "generic";

export type AuthError = {
  category: AuthErrorCategory;
  message: string;
};

const GENERIC_MESSAGE = "Something went wrong. Try again.";

const INVALID_CREDENTIALS_MESSAGE =
  "We could not sign you in with that email and password. Check both and try again.";

/** Shown for invalid, expired, and reused reset links (KTD5). */
export const RESET_LINK_INVALID_MESSAGE =
  "This password reset link is invalid or has expired. Request a new reset email.";

const MESSAGES: Record<AuthErrorCategory, string> = {
  "invalid-credentials": INVALID_CREDENTIALS_MESSAGE,
  "email-in-use":
    "An account already exists with this email. Sign in instead, or reset your password.",
  "weak-password": "Choose a stronger password. Use at least 6 characters.",
  "too-many-requests": "Too many attempts. Wait a few minutes and try again.",
  network: "The network request failed. Check your connection and try again.",
  "expired-action-code": RESET_LINK_INVALID_MESSAGE,
  // Social sign-in (popup) outcomes. "cancelled" is never shown by the auth
  // modal, which treats a closed popup as a plain release of the form.
  cancelled: "Sign-in was cancelled before it finished.",
  "popup-blocked":
    "Your browser blocked the sign-in window. Allow popups for this site and try again.",
  "account-exists":
    "An account already exists with this email using a different sign-in method. Sign in with that method instead.",
  "provider-disabled":
    "This sign-in method is not available right now. Try another way to sign in.",
  generic: GENERIC_MESSAGE,
};

const CATEGORY_BY_CODE: Record<string, AuthErrorCategory> = {
  // Sign-in credential failures deliberately collapse into one generic
  // message so responses cannot reveal which part failed.
  "auth/invalid-credential": "invalid-credentials",
  "auth/wrong-password": "invalid-credentials",
  "auth/user-not-found": "invalid-credentials",
  "auth/invalid-email": "invalid-credentials",
  "auth/email-already-in-use": "email-in-use",
  "auth/weak-password": "weak-password",
  "auth/too-many-requests": "too-many-requests",
  "auth/network-request-failed": "network",
  "auth/expired-action-code": "expired-action-code",
  "auth/invalid-action-code": "expired-action-code",
  "auth/popup-closed-by-user": "cancelled",
  "auth/cancelled-popup-request": "cancelled",
  "auth/user-cancelled": "cancelled",
  "auth/popup-blocked": "popup-blocked",
  "auth/account-exists-with-different-credential": "account-exists",
  "auth/operation-not-allowed": "provider-disabled",
};

const extractAuthCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("auth/") ? code : null;
};

/** Map any thrown value to a stable product-safe auth error. */
export const mapAuthError = (error: unknown): AuthError => {
  const code = extractAuthCode(error);
  const category = (code && CATEGORY_BY_CODE[code]) || "generic";
  return { category, message: MESSAGES[category] };
};

/**
 * Neutral reset-request confirmation. It must never disclose whether the
 * submitted email identifies an account.
 */
export const RESET_REQUEST_CONFIRMATION =
  "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder, or try again with a different email.";

export type ResetRequestOutcome =
  | { status: "confirmed"; message: string }
  | { status: "error"; error: AuthError };

/**
 * Resolve the outcome of a password-reset request. Success and
 * account-existence outcomes (unknown or malformed email) produce the same
 * confirmation; only genuine service failures surface an error.
 */
export const getResetRequestOutcome = (
  error: unknown | null,
): ResetRequestOutcome => {
  if (error === null || error === undefined) {
    return { status: "confirmed", message: RESET_REQUEST_CONFIRMATION };
  }
  const mapped = mapAuthError(error);
  if (mapped.category === "invalid-credentials") {
    return { status: "confirmed", message: RESET_REQUEST_CONFIRMATION };
  }
  return { status: "error", error: mapped };
};
