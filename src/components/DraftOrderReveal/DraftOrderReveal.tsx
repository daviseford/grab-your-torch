import { Title } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { SlimUser } from "../../types";
import { StatusBadge } from "../Layout";
import classes from "./DraftOrderReveal.module.css";

type Props = {
  pickOrder: SlimUser[];
  onComplete: () => void;
  /** The viewer, marked "(you)" in the list. */
  viewerUid?: string;
};

/** How often names shuffle (ms) */
const SHUFFLE_INTERVAL = 80;

/** Base delay before the first slot locks (ms) */
const INITIAL_DELAY = 1500;

/** Max stagger between sequential slot locks (ms) — compressed for large groups */
const MAX_STAGGER = 500;

/** Pause after all slots lock before calling onComplete (ms) */
const COMPLETION_PAUSE = 2500;

function getDisplayName(user: SlimUser): string {
  return user.displayName || user.email || user.uid;
}

function shuffleNames(names: string[]): string[] {
  const next = [...names];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/**
 * The draft order reveal. Slots lock in from the top on a fixed schedule;
 * under reduced motion the names do not cycle (unlocked slots stay blank)
 * but every slot still prints on the same schedule, so the reveal keeps its
 * timing without the shuffle.
 */
export const DraftOrderReveal = ({
  pickOrder,
  onComplete,
  viewerUid,
}: Props) => {
  const reduceMotion = useReducedMotion();
  const [lockedSlots, setLockedSlots] = useState<boolean[]>(
    () => new Array(pickOrder.length).fill(false) as boolean[],
  );
  const [displayNames, setDisplayNames] = useState<string[]>(
    () => new Array(pickOrder.length).fill("") as string[],
  );
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const completedRef = useRef(false);
  const lockedSlotsRef = useRef<boolean[]>(
    new Array(pickOrder.length).fill(false) as boolean[],
  );

  const allNames = useMemo(() => pickOrder.map(getDisplayName), [pickOrder]);

  useEffect(() => {
    const slotCount = pickOrder.length;
    if (slotCount === 0) {
      onComplete();
      return;
    }

    completedRef.current = false;
    const initialLockedSlots = new Array(slotCount).fill(false) as boolean[];
    lockedSlotsRef.current = initialLockedSlots;
    setLockedSlots(initialLockedSlots);
    setDisplayNames(
      reduceMotion
        ? (new Array(slotCount).fill("") as string[])
        : shuffleNames(allNames),
    );

    // Compute stagger so lock-in phase scales with group size
    const stagger = Math.min(MAX_STAGGER, 3000 / slotCount);

    // Shuffle all unlocked slots together so each frame shows a unique order.
    // Reduced motion: no cycling at all; unlocked slots stay blank.
    const intervals: ReturnType<typeof setInterval>[] = [];
    if (!reduceMotion) {
      const shuffleInterval = setInterval(() => {
        setDisplayNames((prev) => {
          const next = [...prev];
          const currentLockedSlots = lockedSlotsRef.current;
          const unlockedIndexes = currentLockedSlots
            .map((isLocked, index) => (!isLocked ? index : -1))
            .filter((index) => index >= 0);
          const unlockedNames = allNames.filter(
            (_, index) => !currentLockedSlots[index],
          );
          const shuffledUnlockedNames = shuffleNames(unlockedNames);

          unlockedIndexes.forEach((slotIndex, orderIndex) => {
            next[slotIndex] =
              shuffledUnlockedNames[orderIndex] ?? next[slotIndex];
          });

          return next;
        });
      }, SHUFFLE_INTERVAL);
      intervals.push(shuffleInterval);
    }
    intervalsRef.current = intervals;

    // Stagger the lock-in for each slot
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < slotCount; i++) {
      const lockDelay = INITIAL_DELAY + i * stagger;
      const timeout = setTimeout(() => {
        // Set the final name
        setDisplayNames((prev) => {
          const next = [...prev];
          next[i] = getDisplayName(pickOrder[i]);
          return next;
        });

        // Mark as locked
        setLockedSlots((prev) => {
          const next = [...prev];
          next[i] = true;
          lockedSlotsRef.current = next;
          return next;
        });

        // If this is the last slot, schedule onComplete
        if (i === slotCount - 1 && !completedRef.current) {
          completedRef.current = true;
          intervals.forEach(clearInterval);
          const completionTimeout = setTimeout(() => {
            onComplete();
          }, COMPLETION_PAUSE);
          timeouts.push(completionTimeout);
        }
      }, lockDelay);
      timeouts.push(timeout);
    }
    timeoutsRef.current = timeouts;

    // Cleanup on unmount
    return () => {
      intervals.forEach(clearInterval);
      timeouts.forEach(clearTimeout);
    };
  }, [allNames, onComplete, pickOrder, reduceMotion]);

  const allLocked = lockedSlots.every(Boolean);

  return (
    <section className={classes.root} aria-labelledby="draft-reveal-title">
      <p className={classes.eyebrow}>
        <span className={classes.liveDot} aria-hidden="true" />
        Draft order
      </p>
      <Title order={1} id="draft-reveal-title" className={classes.title}>
        Shuffling draft order...
      </Title>
      <p className={classes.sub}>Who picks first? Let's find out!</p>

      <ol className={classes.slots} aria-live="polite">
        {pickOrder.map((user, index) => {
          const isLocked = lockedSlots[index];
          const isFirstPicker = isLocked && index === 0 && allLocked;
          const slotClasses = [
            classes.slot,
            !isLocked && classes.shuffling,
            isLocked && classes.locked,
            isFirstPicker && classes.first,
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li
              key={user.uid}
              className={slotClasses}
              aria-hidden={!isLocked ? "true" : undefined}
            >
              <span className={classes.rank}>{index + 1}</span>
              <span className={classes.name}>
                {displayNames[index] || " "}
                {isLocked && user.uid === viewerUid && <small> (you)</small>}
              </span>
              {isFirstPicker ? (
                <StatusBadge kind="watch-along" size="sm">
                  Picks first
                </StatusBadge>
              ) : isLocked ? (
                <StatusBadge kind="season" size="sm">
                  Locked
                </StatusBadge>
              ) : (
                <span className={classes.state}>shuffling</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className={classes.note}>
        Slots lock in from the top. Round 1 starts when the last slot locks.
      </p>
    </section>
  );
};
