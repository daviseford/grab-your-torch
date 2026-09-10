import { Button, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { saveAuthIntent, type AuthIntent } from "../components/Auth/authIntent";
import {
  EmptySlate,
  Notice,
  PageIntro,
  RouteLoading,
  StatusBadge,
  useBugContext,
} from "../components/Layout";
import { buildPoolCastDetails, PoolCastPicker, PoolHandleField } from "../components/Pool";
import { PropBetsForm } from "../components/PropBets";
import { SEASON_METADATA, type SeasonMeta } from "../data/season-metadata";
import { PropBetQuestionKeys } from "../data/propbets";
import { useAuthContinuation } from "../hooks/useAuthContinuation";
import { usePool, usePoolCounters } from "../hooks/usePool";
import { usePoolEntry } from "../hooks/usePoolEntry";
import { useUser } from "../hooks/useUser";
import type { PoolPick, PropBetsFormData, Season } from "../types";
import { trackEvent } from "../utils/analytics";
import {
  clearPoolEntryDraft,
  hasPoolEntryDraft,
  loadPoolEntryDraft,
  savePoolEntryDraft,
} from "../utils/poolEntryDraft";
import { getPoolEntryBlockers } from "../utils/poolEntryPayload";
import { resolvePoolPageState, timestampToMillis } from "../utils/poolPageState";
import { togglePoolPick } from "../utils/poolPicks";
import { getSeasonAirStatus } from "../utils/seasonAirStatus";
import classes from "./Pool.module.css";

/**
 * The public season pool entry page.
 *
 * One pool per upcoming season, entered alone: no lobby, no host, and no
 * second participant (R1). Picks are non-exclusive, so no castaway is ever
 * unavailable however many entrants hold them (R3).
 *
 * There is deliberately NO page-level sign-in gate. A signed-out visitor must
 * be able to see the pool and fill the entry in (R18, AE1); the account gate
 * is at submit, where the `enter-pool` intent carries the entry across sign-in.
 *
 * The cast comes from the pool configuration document, not from `useSeason`:
 * season 51 is deliberately absent from Firestore, so the season document is
 * empty and the config roster is the only cast source this page has (KTD3).
 * The freeze instant and the kill switch are read from that same document and
 * never from `SEASON_METADATA.premiere` (R11).
 */

/** How often the page re-evaluates the freeze. */
const FREEZE_TICK_MS = 30_000;

const formatFreeze = (millis: number): string =>
  new Date(millis).toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });

export const Pool = () => {
  const { seasonId } = useParams();
  const { data: pool, isLoaded: poolLoaded, poolId } = usePool();
  // The entrant count lives on the counters document, never on the config
  // (KTD3), and is readable signed-out along with it.
  const { data: counters } = usePoolCounters(poolId);
  const { slimUser, isAuthReady } = useUser();
  const { entry, isLoading: entryLoading, submitEntry } = usePoolEntry(poolId);

  const [picks, setPicks] = useState<PoolPick[]>([]);
  const [handle, setHandle] = useState("");
  const [propBets, setPropBets] = useState<PropBetsFormData>({});
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [showHandleError, setShowHandleError] = useState(false);
  const [blockerMessage, setBlockerMessage] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingStateKey, setPendingStateKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Mantine's useForm reads initialValues once, at mount. The autosave can
  // arrive after that, so the prop bets form is remounted when it does.
  const [propBetsFormKey, setPropBetsFormKey] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FREEZE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // SEASON_METADATA is used for the season's display name, and for choosing
  // between two messages when there is no configuration document at all. It is
  // never an input to whether entry is open: that is the config's job (KTD3).
  const meta: SeasonMeta | undefined = seasonId
    ? SEASON_METADATA[seasonId as Season["id"]]
    : undefined;
  const airStatus = meta ? getSeasonAirStatus(meta) : "upcoming";
  const state = resolvePoolPageState({ pool, poolLoaded, airStatus, now });

  const details = useMemo(
    () => buildPoolCastDetails(pool?.season_id),
    [pool?.season_id],
  );

  useBugContext(pool ? pool.name : null);

  // Restore whatever this browser had in progress, once per pool. The store
  // is the autosave seam (U13); until that unit lands it is session-lifetime.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!poolId || restoredFor.current === poolId) return;
    restoredFor.current = poolId;
    const draft = loadPoolEntryDraft(poolId);
    if (!draft) return;
    setPicks(draft.picks);
    setHandle(draft.handle);
    setPropBets(draft.prop_bets);
    setPropBetsFormKey((key) => key + 1);
  }, [poolId]);

  const persist = useCallback(
    (next: {
      picks?: PoolPick[];
      handle?: string;
      prop_bets?: PropBetsFormData;
    }) => {
      if (!poolId) return;
      savePoolEntryDraft({
        pool_id: poolId,
        picks: next.picks ?? picks,
        handle: next.handle ?? handle,
        prop_bets: next.prop_bets ?? propBets,
        saved_at: Date.now(),
      });
    },
    [poolId, picks, handle, propBets],
  );

  const limit = pool?.picks_per_entry ?? 0;

  const onToggle = useCallback(
    (candidate: PoolPick) => {
      const result = togglePoolPick(picks, candidate, limit);
      if (result.action === "swapped" && result.removed) {
        setAnnouncement(
          `${candidate.full_name} replaced ${result.removed.full_name}.`,
        );
      } else if (result.action === "removed") {
        setAnnouncement(`${candidate.full_name} removed.`);
      } else if (result.action === "added") {
        setAnnouncement(`${candidate.full_name} added.`);
      }
      setPicks(result.picks);
      persist({ picks: result.picks });
      setBlockerMessage(null);
    },
    [picks, limit, persist],
  );

  const onHandleChange = useCallback(
    (value: string) => {
      setHandle(value);
      persist({ handle: value });
      setBlockerMessage(null);
    },
    [persist],
  );

  // The values a continuation needs after the account modal closes, without
  // rebuilding every callback whenever one of them changes.
  const latest = useRef({ picks, handle, propBets });
  useEffect(() => {
    latest.current = { picks, handle, propBets };
  }, [picks, handle, propBets]);

  const write = useCallback(
    async (values: {
      picks: PoolPick[];
      handle: string;
      propBets: PropBetsFormData;
    }): Promise<{ ok: boolean; message: string; denied: boolean }> => {
      if (!pool) {
        return {
          ok: false,
          message: "This pool could not be loaded.",
          denied: true,
        };
      }
      setSubmitting(true);
      const outcome = await submitEntry({
        pool,
        picks: values.picks,
        handle: values.handle,
        propBets: values.propBets,
      });
      setSubmitting(false);
      if (outcome.status === "created") {
        if (poolId) clearPoolEntryDraft(poolId);
        setSubmitMessage(null);
        trackEvent("pool_entry_submitted", { pool_id: pool.id });
        return { ok: true, message: "", denied: false };
      }
      setSubmitMessage(outcome.message);
      return {
        ok: false,
        message: outcome.message,
        denied: outcome.status === "denied",
      };
    },
    [pool, poolId, submitEntry],
  );

  /**
   * The prop bets form's submit is the entry's submit. It validates its own
   * questions; everything else is checked here so a blocked submit always
   * names what is missing instead of failing silently.
   */
  const onPropBetsSubmit = useCallback(
    async (values: PropBetsFormData) => {
      if (!pool || !poolId) return;
      setPropBets(values);
      persist({ prop_bets: values });
      setShowHandleError(true);

      const blockers = getPoolEntryBlockers({
        pool,
        picks,
        handle,
        propBets: values,
      });
      if (blockers.length > 0) {
        setBlockerMessage(blockers.map((b) => b.message).join(" "));
        return;
      }
      setBlockerMessage(null);

      if (!slimUser) {
        // The account gate, at submit and nowhere earlier (KD5). The intent
        // carries only the pool id and a resume marker; the entry itself is
        // in the autosave, which the line above has just written.
        const stateKey = saveAuthIntent({
          kind: "enter-pool",
          poolId,
          resume: hasPoolEntryDraft(poolId),
          returnPath: `/pool/${pool.season_id}`,
        });
        setPendingStateKey(stateKey);
        modals.openContextModal({
          modal: "AuthModal",
          innerProps: {
            initialMode: "register",
            actionDescription: `Enter the ${pool.name}`,
            pendingStateKey: stateKey,
          },
        });
        return;
      }

      await write({ picks, handle, propBets: values });
    },
    [pool, poolId, picks, handle, persist, slimUser, write],
  );

  const matchesEnterPool = useCallback(
    (intent: AuthIntent) =>
      intent.kind === "enter-pool" && intent.poolId === pool?.id,
    [pool?.id],
  );

  const executeEnterPool = useCallback(
    async (intent: AuthIntent) => {
      if (intent.kind !== "enter-pool" || !pool || !poolId || !slimUser) {
        return {
          result: "failed" as const,
          message:
            "We could not finish submitting your entry. Check your connection and try again.",
        };
      }
      // After a reload the form state is gone; the autosave is the one copy.
      const stored = intent.resume ? loadPoolEntryDraft(poolId) : null;
      const values = stored
        ? {
            picks: stored.picks,
            handle: stored.handle,
            propBets: stored.prop_bets,
          }
        : latest.current;

      const blockers = getPoolEntryBlockers({ pool, ...values });
      if (blockers.length > 0) {
        // Nothing was lost: the entry is still on screen, just unfinished.
        setPicks(values.picks);
        setHandle(values.handle);
        setPropBets(values.propBets);
        setShowHandleError(true);
        setBlockerMessage(blockers.map((b) => b.message).join(" "));
        return { result: "invalid" as const, message: blockers[0].message };
      }

      const outcome = await write(values);
      if (outcome.ok) return { result: "completed" as const };
      return {
        result: (outcome.denied ? "invalid" : "failed") as "invalid" | "failed",
        message: outcome.message,
      };
    },
    [pool, poolId, slimUser, write],
  );

  const continuation = useAuthContinuation({
    isReady: !!slimUser && !!pool && isAuthReady,
    stateKey: pendingStateKey,
    matches: matchesEnterPool,
    execute: executeEnterPool,
  });

  if (state === "loading" || (poolLoaded && pool && entryLoading)) {
    return <RouteLoading />;
  }

  if (state === "not-upcoming" || state === "no-pool") {
    return (
      <div className={classes.page}>
        <EmptySlate
          title={
            state === "not-upcoming"
              ? "This season is already under way"
              : "No pool for this season yet"
          }
          actions={
            <Button component={Link} to="/seasons" variant="default">
              Browse seasons
            </Button>
          }
        >
          {state === "not-upcoming"
            ? "A season pool runs only for a season that has not premiered, so predictions are predictions."
            : "There is no pool open for this season right now."}
        </EmptySlate>
      </div>
    );
  }

  if (!pool) return <RouteLoading />;

  const freezeMillis = timestampToMillis(pool.freeze_at);
  const seasonName = meta?.name ?? pool.name;

  const intro = (
    <PageIntro
      eyebrow="Season Pool"
      title={pool.name}
      description={
        <>
          Pick {pool.picks_per_entry} of the {pool.roster.length} castaways,
          answer the prop bets, and choose a handle. You play on your own: there
          is no lobby and nobody else to wait for. Anyone can pick the same
          castaways you do.
        </>
      }
      meta={
        <>
          <StatusBadge kind="season" size="sm">
            {state === "open"
              ? `Entries close ${formatFreeze(freezeMillis)}`
              : "Entries closed"}
          </StatusBadge>
          {counters && (
            <StatusBadge kind="season" size="sm">
              {counters.entry_count === 1
                ? "1 entrant"
                : `${counters.entry_count} entrants`}
            </StatusBadge>
          )}
        </>
      }
    />
  );

  if (state === "closed" || state === "frozen") {
    return (
      <div className={classes.page}>
        {intro}
        <Notice label={state === "closed" ? "Closed" : "Frozen"} tone="warning">
          {state === "closed"
            ? "This pool is not accepting entries at the moment. Nothing you do here will be saved."
            : `Entries closed on ${formatFreeze(freezeMillis)}, so this pool can no longer be entered.`}
        </Notice>
        {entry && <SubmittedEntry entry={entry} />}
      </div>
    );
  }

  if (entry) {
    return (
      <div className={classes.page}>
        {intro}
        <Notice label="Entered" tone="success" role="status">
          Your entry is in. You can change it until entries close on{" "}
          {formatFreeze(freezeMillis)}.
        </Notice>
        <SubmittedEntry entry={entry} />
      </div>
    );
  }

  return (
    <div className={classes.page}>
      {intro}

      <section className={classes.section} aria-labelledby="pool-picks">
        <h2 className={classes.heading} id="pool-picks">
          Your picks
        </h2>
        <Text className={classes.sectionNote}>
          Nobody can take a castaway from you. Any number of entrants can hold
          the same castaway, so pick the {pool.picks_per_entry} you believe in.
        </Text>
        <PoolCastPicker
          cast={pool.roster}
          details={details}
          picks={picks}
          limit={pool.picks_per_entry}
          seasonName={seasonName}
          onToggle={onToggle}
          announcement={announcement}
        />
      </section>

      <section className={classes.section} aria-labelledby="pool-handle">
        <h2 className={classes.heading} id="pool-handle">
          Your handle
        </h2>
        <PoolHandleField
          value={handle}
          onChange={onHandleChange}
          showError={showHandleError}
        />
      </section>

      <section className={classes.section} aria-labelledby="pool-propbets">
        <h2 className={classes.heading} id="pool-propbets">
          Prop bets
        </h2>
        <Text className={classes.sectionNote}>
          Answer every question. These break ties on the leaderboard.
        </Text>
        {blockerMessage && (
          <Notice label="Not yet" tone="warning" role="alert">
            {blockerMessage}
          </Notice>
        )}
        {submitMessage && (
          <Notice label="Not saved" tone="danger" role="alert">
            {submitMessage}
          </Notice>
        )}
        {continuation.status === "failed" && continuation.error && (
          <Notice
            label="Not saved"
            tone="danger"
            role="alert"
            actions={
              <Button size="xs" variant="default" onClick={continuation.retry}>
                Try again
              </Button>
            }
          >
            {continuation.error}
          </Notice>
        )}
        <PropBetsForm
          key={propBetsFormKey}
          cast={pool.roster}
          initialValues={propBets}
          submitLabel={submitting ? "Submitting..." : "Submit my entry"}
          onSubmit={onPropBetsSubmit}
        />
      </section>
    </div>
  );
};

/**
 * The entrant's own submitted entry. Only they can read it: entry documents
 * stay owner-only before and after the freeze (KTD6, AE5).
 *
 * The edit and withdrawal controls are a separate unit. This view is the seam
 * they attach to.
 */
const SubmittedEntry = ({
  entry,
}: {
  entry: { handle: string; picks: PoolPick[]; prop_bets: PropBetsFormData };
}) => (
  <section className={classes.section} aria-labelledby="pool-entry">
    <h2 className={classes.heading} id="pool-entry">
      Your entry
    </h2>
    <dl className={classes.summary}>
      <dt>Handle</dt>
      <dd>{entry.handle}</dd>
      <dt>Picks</dt>
      <dd>{entry.picks.map((pick) => pick.full_name).join(", ")}</dd>
      <dt>Prop bets</dt>
      <dd>
        {Object.keys(entry.prop_bets).length} of {PropBetQuestionKeys.length}{" "}
        answered
      </dd>
    </dl>
  </section>
);
