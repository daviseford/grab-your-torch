import { createContext, useContext, useEffect, type ReactNode } from "react";

/**
 * The bug's context segment: the caps line beside the lockup in the header
 * that names where the visitor is ("Seasons", "S50 · Ep 6 · Watch-along",
 * "Admin · S50" with the admin slate). Pages set it for as long as they are
 * mounted; it clears when they unmount.
 */
export const BugNodeContext = createContext<ReactNode>(null);
export const SetBugNodeContext = createContext<
  ((node: ReactNode) => void) | null
>(null);

/** Read the current bug context (the shell's header renders it). */
export const useBugContextNode = (): ReactNode => useContext(BugNodeContext);

/**
 * Set the bug's context segment while the calling page is mounted. The
 * effect re-runs whenever the page renders a new node; only the header
 * re-renders in response, because pages read the stable setter alone.
 */
export const useBugContext = (node: ReactNode) => {
  const setNode = useContext(SetBugNodeContext);
  useEffect(() => {
    if (!setNode) return;
    setNode(node);
    return () => setNode(null);
  }, [node, setNode]);
};
