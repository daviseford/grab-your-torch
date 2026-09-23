import { useReducedMotion } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { type RefObject, useEffect, useRef, useState } from "react";
import { turnAlertAction, turnAlertMessage } from "../utils/draftAttention";
import classes from "./Draft.module.css";

/** Hides the turn toast currently on screen, if any. */
const hideToast = (toastIdRef: RefObject<string | null>) => {
  if (toastIdRef.current === null) return;
  notifications.hide(toastIdRef.current);
  toastIdRef.current = null;
};

type DraftTurnAlertProps = {
  draftId: string;
  /** Namespaces the per-tab dedupe slot so a previous signed-in account on this tab can never suppress the current viewer's alert. */
  viewerUid: string | undefined;
  /** `turnAlertKey` for the current snapshot; null when it is not the viewer's turn. */
  alertKey: string | null;
  /** The viewer also made the previous pick (snake turnaround). */
  repeat: boolean;
};

/**
 * Own-turn alert for the live draft: a "You're up!" toast, a one-shot inset
 * edge glow, and a best-effort vibration, fired once per pick identity per
 * tab. A turn that starts while the tab is hidden is deferred until the tab
 * is visible again, and only fires if it is still the viewer's turn.
 *
 * StrictMode notes: cleanup never hides the toast synchronously (it schedules
 * a hide the replayed setup cancels), and the alert is consumed inside the
 * firing path, so a replayed setup sees the pick as already alerted instead
 * of firing twice or swallowing the toast.
 */
export const DraftTurnAlert = ({
  draftId,
  viewerUid,
  alertKey,
  repeat,
}: DraftTurnAlertProps) => {
  // Computed synchronously on first render so a reduced-motion user never
  // gets one animated frame before the media query effect runs.
  const reduceMotion = useReducedMotion(false, {
    getInitialValueInEffect: false,
  });
  const [edgeKey, setEdgeKey] = useState<string | null>(null);

  const storageSlot = `gyt:draft-turn-alert:${draftId}:${viewerUid ?? "anon"}`;

  const alertedKeyRef = useRef<string | null>(null);
  const storageReadRef = useRef(false);
  const pendingHideRef = useRef<number | null>(null);
  // The toast currently on screen. Each turn gets its own id: Mantine keys
  // the rendered toast by id, so hiding and re-showing one id in the same
  // tick keeps the old toast's autoClose timer, which then closes the new one.
  const toastIdRef = useRef<string | null>(null);
  // Current values for the deferred visibilitychange callback, so a stale
  // listener can never fire for an old pick.
  const currentRef = useRef({ alertKey, repeat });
  useEffect(() => {
    currentRef.current = { alertKey, repeat };
  });

  useEffect(() => {
    if (pendingHideRef.current !== null) {
      window.clearTimeout(pendingHideRef.current);
      pendingHideRef.current = null;
    }

    if (!storageReadRef.current) {
      storageReadRef.current = true;
      try {
        alertedKeyRef.current = window.sessionStorage.getItem(storageSlot);
      } catch {
        alertedKeyRef.current = null;
      }
    }

    const fire = (key: string, isRepeat: boolean) => {
      alertedKeyRef.current = key;
      try {
        window.sessionStorage.setItem(storageSlot, key);
      } catch {
        // Private mode or quota: the in-memory ref still dedupes this tab.
      }

      // Replace the previous turn's toast so at most one is ever on screen.
      hideToast(toastIdRef);
      const toastId = `draft-turn-${key}`;
      toastIdRef.current = toastId;
      notifications.show({
        id: toastId,
        title: "You're up!",
        message: turnAlertMessage(isRepeat),
        color: "signal",
        autoClose: 5000,
      });

      if (!reduceMotion) {
        setEdgeKey(key);
      }

      const nav = navigator as Navigator & {
        userActivation?: { hasBeenActive: boolean };
      };
      if (
        typeof nav.vibrate === "function" &&
        nav.userActivation?.hasBeenActive !== false
      ) {
        try {
          nav.vibrate([60, 40, 60]);
        } catch {
          // Best effort only; iOS Safari has no vibrate at all.
        }
      }
    };

    if (alertKey === null) {
      // The viewer just picked (or the draft moved on): no stale "You're up!".
      hideToast(toastIdRef);
      return;
    }

    const action = turnAlertAction({
      key: alertKey,
      alertedKey: alertedKeyRef.current,
      hidden: document.visibilityState === "hidden",
    });

    if (action === "alert") {
      fire(alertKey, repeat);
      return;
    }

    if (action === "defer") {
      const handleVisible = () => {
        if (document.visibilityState !== "visible") return;
        const current = currentRef.current;
        if (
          turnAlertAction({
            key: current.alertKey,
            alertedKey: alertedKeyRef.current,
            hidden: false,
          }) === "alert" &&
          current.alertKey !== null
        ) {
          fire(current.alertKey, current.repeat);
        }
      };
      document.addEventListener("visibilitychange", handleVisible);
      return () =>
        document.removeEventListener("visibilitychange", handleVisible);
    }
    return;
  }, [alertKey, repeat, reduceMotion, storageSlot]);

  // On unmount (the drafting branch unmounts on phase change) hide the toast,
  // but deferred so a StrictMode replay cancels it before it fires.
  useEffect(() => {
    return () => {
      pendingHideRef.current = window.setTimeout(
        () => hideToast(toastIdRef),
        0,
      );
    };
  }, []);

  // Fallback clear in case animationend never fires (tab hidden mid-pulse).
  useEffect(() => {
    if (!edgeKey) return;
    const timeout = window.setTimeout(() => setEdgeKey(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [edgeKey]);

  return edgeKey ? (
    <div
      key={edgeKey}
      className={classes.turnEdge}
      aria-hidden="true"
      data-turn-edge=""
      onAnimationEnd={() => setEdgeKey(null)}
    />
  ) : null;
};
