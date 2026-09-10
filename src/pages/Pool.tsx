import { Button, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import {
  applyPoolWriteEvent,
  buildPoolCastDetails,
  describePoolWriteRejection,
  loadPoolWriteRejection,
  PoolCastPicker,
  poolEntryChangedElsewhere,
  PoolHandleField,
  PoolHandleOnlyForm,
  resolvePoolEntryControls,
  type PoolWriteKind,
  type PoolWriteRejection,
} from "../components/Pool";
import { PropBetsForm } from "../components/PropBets";
import { PropBetQuestionKeys } from "../data/propbets";
import { SEASON_METADATA, type SeasonMeta } from "../data/season-metadata";
import { useAuthContinuation } from "../hooks/useAuthContinuation";
import { usePool, usePoolCounters } from "../hooks/usePool";
import {
  isPoolWriteAcknowledged,
  usePoolEntry,
  type PoolEntrySubmitOutcome,
} from "../hooks/usePoolEntry";
import { useUser } from "../hooks/useUser";
import type {
  FirestoreTimestamp,
  PoolEntry,
  PoolPick,
  PropBetsFormData,
  Season,
} from "../types";
import { trackEvent } from "../utils/analytics";
// Importing this module is what makes the autosave survive a reload: it
// replaces the seam's session-only default with browser-local storage (U13).
import { readPoolEntryDraftForPool } from "../utils/poolDraftStorage";
import {
  clearPoolEntryDraft,
  hasPoolEntryDraft,
  savePoolEntryDraft,
} from "../utils/poolEntryDraft";
import { getPoolEntryBlockers } from "../utils/poolEntryPayload";
import {
  resolvePoolPageState,
  timestampToMillis,
} from "../utils/poolPageState";
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
 *
 * NOTHING ON THIS PAGE DISCARDS COMPLETED PICKS WITHOUT SAYING SO
 * ---------------------------------------------------------------
 * The freeze is enforced by rules against `request.time`, so the gate here is
 * cosmetic and a write can be refused at any moment (KTD4). Three things
 * follow, and they are the shape of the whole page:
 *
 *  - a refused write never clears the form. The picks stay exactly where they
 *    are and a notice says the pool has closed (AE2),
 *  - a refusal is recorded before it is rendered, so one that arrives after
 *    the entrant has navigated away still reaches them on their next load
 *    (`poolWriteRejection`),
 *  - a transient failure offers a retry and never claims the pool has closed.
 */

/** How often the page re-evaluates the freeze. */
const FREEZE_TICK_MS = 30_000;

/** One complete entry, as the form holds it. */
type EntryValues = {
  picks: PoolPick[];
  handle: string;
  propBets: PropBetsFormData;
};

type SaveEntryResult = { ok: boolean; message: string; denied: boolean };

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
  const {
    entry,
    isLoading: entryLoading,
    submitEntry,
    updateEntry,
    updateHandle,
    withdrawEntry,
  } = usePoolEntry(poolId);

  const [picks, setPicks] = useState<PoolPick[]>([]);
  const [handle, setHandle] = useState("");
  const [propBets, setPropBets] = useState<PropBetsFormData>({});
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [showHandleError, setShowHandleError] = useState(false);
  const [blockerMessage, setBlockerMessage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingStateKey, setPendingStateKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Mantine's useForm reads initialValues once, at mount. The autosave can
  // arrive after that, so the prop bets form is remounted when it does.
  const [propBetsFormKey, setPropBetsFormKey] = useState(0);
  // Set while the entrant is revising an entry that is already in.
  const [editing, setEditing] = useState(false);
  // The entry's `updated_at` at the moment the open form read it, so a save
  // made in a second tab is noticed instead of being overwritten blind.
  const [editBaseline, setEditBaseline] = useState<
    FirestoreTimestamp | undefined
  >(undefined);
  const [rejection, setRejection] = useState<PoolWriteRejection | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FREEZE_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // A write refused while no form was mounted, read back on this load.
  useEffect(() => {
    if (!poolId) return;
    setRejection(loadPoolWriteRejection(poolId));
  }, [poolId]);

  // SEASON_METADATA is used for the season's display name, and for choosing
  // between two messages when there is no configuration document at all. It is
  // never an input to whether entry is open: that is the config's job (KTD3).
  const meta: SeasonMeta | undefined = seasonId
    ? SEASON_METADATA[seasonId as Season["id"]]
    : undefined;
  const airStatus = meta ? getSeasonAirStatus(meta) : "upcoming";
  const state = resolvePoolPageState({ pool, poolLoaded, airStatus, now });
  const controls = resolvePoolEntryControls({ state, hasEntry: !!entry });

  const details = useMemo(
    () => buildPoolCastDetails(pool?.season_id),
    [pool?.season_id],
  );

  useBugContext(pool ? pool.name : null);

  // Restore whatever this browser had in progress, once per pool, and only
  // once the configuration has arrived: the cast and the question set are what
  // decide whether a stored draft is one this page could have produced, and
  // browser-local storage is writable by anything on the origin. An invalid
  // draft is dropped whole rather than partly restored.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!poolId || !pool || restoredFor.current === poolId) return;
    restoredFor.current = poolId;
    const draft = readPoolEntryDraftForPool(poolId, pool);
    if (!draft) return;
    setPicks(draft.picks);
    setHandle(draft.handle);
    setPropBets(draft.prop_bets);
    setPropBetsFormKey((key) => key + 1);
  }, [poolId, pool]);

  const persist = useCallback(
    (next: {
      picks?: PoolPick[];
      handle?: string;
      prop_bets?: PropBetsFormData;
    }) => {
      if (!poolId || !pool) return;
      // The prop bets form renders every question; a pool asks for a subset,
      // and the submit payload keeps only that subset. The autosave stores the
      // same subset, so what is restored is exactly what would be submitted.
      const answers = next.prop_bets ?? propBets;
      const prop_bets: PropBetsFormData = {};
      for (const key of pool.prop_bet_keys) {
        const answer = answers[key];
        if (typeof answer === "string" && answer.length > 0) {
          prop_bets[key] = answer;
        }
      }
      savePoolEntryDraft({
        pool_id: poolId,
        picks: next.picks ?? picks,
        handle: next.handle ?? handle,
        prop_bets,
        saved_at: Date.now(),
      });
    },
    [poolId, pool, picks, handle, propBets],
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

  /**
   * Run one write and record what came back.
   *
   * The recording happens here rather than inside the hook because this async
   * function runs to completion whether or not the component is still mounted.
   * An offline write replayed on reconnect and refused after the freeze
   * therefore still leaves a record, even though the state setters below are
   * no-ops by then, and the next load explains it (step 4).
   */
  const runWrite = useCallback(
    async (
      kind: PoolWriteKind,
      write: () => Promise<PoolEntrySubmitOutcome>,
    ): Promise<PoolEntrySubmitOutcome> => {
      if (!poolId) {
        return { status: "failed", message: "This pool could not be loaded." };
      }
      applyPoolWriteEvent({ type: "started", pool_id: poolId });
      setSubmitting(true);
      setRetryMessage(null);

      const outcome = await write();

      setSubmitting(false);
      if (isPoolWriteAcknowledged(outcome)) {
        setRejection(
          applyPoolWriteEvent({ type: "acknowledged", pool_id: poolId }),
        );
        return outcome;
      }
      if (outcome.status === "denied") {
        if (outcome.reason === "payload") {
          // The client refused an unfinished entry. Nothing was sent, so
          // there is nothing to record: name the field and let them fix it.
          setBlockerMessage(outcome.message);
          return outcome;
        }
        // The boundary refused it. Terminal, and the picks stay on screen
        // while one notice explains it, mounted form or not (AE2).
        setRejection(
          applyPoolWriteEvent({
            type: "denied",
            pool_id: poolId,
            kind,
            at: Date.now(),
          }),
        );
        return outcome;
      }
      applyPoolWriteEvent({ type: "failed", pool_id: poolId });
      setRetryMessage(outcome.message);
      return outcome;
    },
    [poolId],
  );

  /** What the retry button re-runs after a transient failure. */
  const lastAttempt = useRef<null | (() => Promise<void>)>(null);

  const performSave = useCallback(
    async (values: EntryValues, isEdit: boolean): Promise<SaveEntryResult> => {
      if (!pool) {
        return {
          ok: false,
          message: "This pool could not be loaded.",
          denied: true,
        };
      }
      const outcome = await runWrite(isEdit ? "update" : "create", () =>
        (isEdit ? updateEntry : submitEntry)({
          pool,
          picks: values.picks,
          handle: values.handle,
          propBets: values.propBets,
        }),
      );

      if (isPoolWriteAcknowledged(outcome)) {
        if (poolId) clearPoolEntryDraft(poolId);
        lastAttempt.current = null;
        setEditing(false);
        setEditBaseline(undefined);
        setStatusMessage(isEdit ? "Your entry has been updated." : null);
        trackEvent(isEdit ? "pool_entry_updated" : "pool_entry_submitted", {
          pool_id: pool.id,
        });
        return { ok: true, message: "", denied: false };
      }
      return {
        ok: false,
        message: outcome.message,
        denied: outcome.status === "denied",
      };
    },
    [pool, poolId, runWrite, submitEntry, updateEntry],
  );

  /**
   * Save, and arm the retry with the same values before anything can fail.
   *
   * A transient failure must be retryable with exactly what the entrant
   * entered, not with whatever the form holds by the time they press the
   * button, so the values are captured here rather than read back later.
   */
  const saveEntry = useCallback(
    (values: EntryValues): Promise<SaveEntryResult> => {
      const isEdit = editing;
      lastAttempt.current = async () => {
        await performSave(values, isEdit);
      };
      return performSave(values, isEdit);
    },
    [editing, performSave],
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
      setStatusMessage(null);

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

      await saveEntry({ picks, handle, propBets: values });
    },
    [pool, poolId, picks, handle, persist, slimUser, saveEntry],
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
      const stored = intent.resume
        ? readPoolEntryDraftForPool(poolId, pool)
        : null;
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

      const outcome = await saveEntry(values);
      if (outcome.ok) return { result: "completed" as const };
      return {
        result: (outcome.denied ? "invalid" : "failed") as "invalid" | "failed",
        message: outcome.message,
      };
    },
    [pool, poolId, slimUser, saveEntry],
  );

  const continuation = useAuthContinuation({
    isReady: !!slimUser && !!pool && isAuthReady,
    stateKey: pendingStateKey,
    matches: matchesEnterPool,
    execute: executeEnterPool,
  });

  /** Prefill the form from the entry the server holds, and start editing. */
  const startEditing = useCallback(() => {
    if (!entry) return;
    setPicks(entry.picks);
    setHandle(entry.handle);
    setPropBets(entry.prop_bets);
    setPropBetsFormKey((key) => key + 1);
    setEditBaseline(entry.updated_at);
    setShowHandleError(false);
    setBlockerMessage(null);
    setRetryMessage(null);
    setStatusMessage(null);
    setEditing(true);
  }, [entry]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditBaseline(undefined);
    setBlockerMessage(null);
    setRetryMessage(null);
    lastAttempt.current = null;
  }, []);

  const withdraw = useCallback(() => {
    const run = async () => {
      lastAttempt.current = run;
      const outcome = await runWrite("withdraw", withdrawEntry);
      if (!isPoolWriteAcknowledged(outcome)) return;
      lastAttempt.current = null;
      // The listener drops the entry on its own; clear the form behind it so
      // the empty entry form is genuinely empty.
      setPicks([]);
      setHandle("");
      setPropBets({});
      setPropBetsFormKey((key) => key + 1);
      setEditing(false);
      setEditBaseline(undefined);
      if (poolId) clearPoolEntryDraft(poolId);
      setStatusMessage(
        "Your entry has been withdrawn. You can enter again until entries close.",
      );
    };
    modals.openConfirmModal({
      title: "Withdraw your entry?",
      children: (
        <Text size="sm">
          Your picks, handle, and prop bets are removed from this pool. You can
          enter again any time before entries close.
        </Text>
      ),
      labels: { confirm: "Withdraw my entry", cancel: "Keep my entry" },
      confirmProps: { color: "red" },
      onConfirm: () => void run(),
    });
  }, [poolId, runWrite, withdrawEntry]);

  const saveHandleOnly = useCallback(
    async (next: string) => {
      const outcome = await runWrite("handle", () => updateHandle(next));
      if (isPoolWriteAcknowledged(outcome))
        return { ok: true, retryable: false };
      return { ok: false, retryable: outcome.status === "failed" };
    },
    [runWrite, updateHandle],
  );

  const dismissRejection = useCallback(() => {
    if (!poolId) return;
    setRejection(applyPoolWriteEvent({ type: "dismissed", pool_id: poolId }));
  }, [poolId]);

  const retryLastAttempt = useCallback(() => {
    void lastAttempt.current?.();
  }, []);

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

  /**
   * The one place a refused write is explained. It renders whether or not the
   * form that caused it is still mounted, and clears itself on the next
   * acknowledged write or when the entrant dismisses it.
   */
  const rejectionNotice = rejection ? (
    <Notice
      label={describePoolWriteRejection(rejection).label}
      tone="danger"
      role="alert"
      actions={
        <Button size="xs" variant="default" onClick={dismissRejection}>
          Got it
        </Button>
      }
    >
      {describePoolWriteRejection(rejection).message}
    </Notice>
  ) : null;

  const retryNotice = retryMessage ? (
    <Notice
      label="Not saved"
      tone="danger"
      role="alert"
      actions={
        <Button size="xs" variant="default" onClick={retryLastAttempt}>
          Try again
        </Button>
      }
    >
      {retryMessage}
    </Notice>
  ) : null;

  if (state === "closed" || state === "frozen") {
    return (
      <div className={classes.page}>
        {intro}
        <Notice label={state === "closed" ? "Closed" : "Frozen"} tone="warning">
          {state === "closed"
            ? "This pool is not accepting entries at the moment. Nothing you do here will be saved."
            : `Entries closed on ${formatFreeze(freezeMillis)}, so this pool can no longer be entered.`}
        </Notice>
        {rejectionNotice}
        {retryNotice}
        {blockerMessage && (
          <Notice label="Not yet" tone="warning" role="alert">
            {blockerMessage}
          </Notice>
        )}
        {entry && <SubmittedEntry entry={entry} />}
        {controls === "handle-only" && entry && (
          <section className={classes.section} aria-labelledby="pool-handle">
            <h2 className={classes.heading} id="pool-handle">
              Your handle
            </h2>
            <PoolHandleOnlyForm handle={entry.handle} onSave={saveHandleOnly} />
          </section>
        )}
      </div>
    );
  }

  if (entry && !editing) {
    return (
      <div className={classes.page}>
        {intro}
        <Notice label="Entered" tone="success" role="status">
          Your entry is in. You can change it until entries close on{" "}
          {formatFreeze(freezeMillis)}.
        </Notice>
        {rejectionNotice}
        {retryNotice}
        {statusMessage && (
          <Notice label="Saved" tone="success" role="status">
            {statusMessage}
          </Notice>
        )}
        <SubmittedEntry
          entry={entry}
          actions={
            controls === "edit-and-withdraw" ? (
              <div className={classes.actions}>
                <Button variant="default" onClick={startEditing}>
                  Change my entry
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  disabled={submitting}
                  onClick={withdraw}
                >
                  Withdraw my entry
                </Button>
              </div>
            ) : undefined
          }
        />
      </div>
    );
  }

  const changedElsewhere = poolEntryChangedElsewhere(
    editBaseline,
    entry?.updated_at,
  );

  return (
    <div className={classes.page}>
      {intro}

      {statusMessage && !editing && (
        <Notice label="Withdrawn" tone="info" role="status">
          {statusMessage}
        </Notice>
      )}

      {editing && (
        <Notice label="Editing" tone="info">
          You are changing an entry that is already in. Nothing changes until
          you save.
        </Notice>
      )}

      {changedElsewhere && (
        <Notice
          label="Changed elsewhere"
          tone="warning"
          role="alert"
          actions={
            <Button size="xs" variant="default" onClick={startEditing}>
              Load the newer entry
            </Button>
          }
        >
          This entry was changed in another tab or on another device after you
          started editing. Saving now replaces that newer version.
        </Notice>
      )}

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
        {rejectionNotice}
        {retryNotice}
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
          submitLabel={
            submitting
              ? "Saving..."
              : editing
                ? "Save my changes"
                : "Submit my entry"
          }
          onSubmit={onPropBetsSubmit}
        />
        {editing && (
          <div className={classes.actions}>
            <Button variant="subtle" color="gray" onClick={cancelEditing}>
              Cancel and keep my entry as it is
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

/**
 * The entrant's own submitted entry. Only they can read it: entry documents
 * stay owner-only before and after the freeze (KTD6, AE5).
 *
 * `actions` is where the edit and withdrawal controls attach. They are absent
 * after the freeze, which is `resolvePoolEntryControls`' decision rather than
 * this component's.
 */
const SubmittedEntry = ({
  entry,
  actions,
}: {
  entry: Pick<PoolEntry, "handle" | "picks" | "prop_bets">;
  actions?: ReactNode;
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
    {actions}
  </section>
);
