import { useState, type ReactNode } from "react";
import { BugNodeContext, SetBugNodeContext } from "./bugContext";

/** Holds the bug's context segment for the shell; see bugContext.ts. */
export const BugContextProvider = ({ children }: { children: ReactNode }) => {
  const [node, setNode] = useState<ReactNode>(null);
  return (
    <SetBugNodeContext.Provider value={setNode}>
      <BugNodeContext.Provider value={node}>{children}</BugNodeContext.Provider>
    </SetBugNodeContext.Provider>
  );
};
