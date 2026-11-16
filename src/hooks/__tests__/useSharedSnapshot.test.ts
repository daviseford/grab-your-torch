import { beforeEach, describe, expect, it, vi } from "vitest";

type Next = (snap: {
  data: () => unknown;
  metadata: { fromCache: boolean };
}) => void;
type Fail = (error: { code: string }) => void;

const listeners: { next: Next; fail: Fail; unsub: ReturnType<typeof vi.fn> }[] =
  [];

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("../useUser", () => ({ useUser: () => ({}) }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  onSnapshot: (_ref: unknown, next: Next, fail: Fail) => {
    const unsub = vi.fn();
    listeners.push({ next, fail, unsub });
    return unsub;
  },
}));

const { subscribeSharedSnapshot } = await import("../useSharedSnapshot");

const PATH = "uid:competitions/competition_a";
const subscribe = (fn = vi.fn()) => ({
  fn,
  release: subscribeSharedSnapshot(PATH, "competitions", "competition_a", fn),
});
const serverSnap = (data: unknown) => ({
  data: () => data,
  metadata: { fromCache: false },
});

beforeEach(() => {
  listeners.length = 0;
});

describe("shared snapshot listeners", () => {
  it("shares one Firestore listener between subscribers and closes it with the last", () => {
    const a = subscribe();
    const b = subscribe();
    expect(listeners).toHaveLength(1);

    listeners[0].next(serverSnap({ name: "x" }));
    expect(a.fn).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { name: "x" }, loaded: true }),
    );
    expect(b.fn).toHaveBeenCalledTimes(1);

    a.release();
    expect(listeners[0].unsub).not.toHaveBeenCalled();
    b.release();
    expect(listeners[0].unsub).toHaveBeenCalledTimes(1);
  });

  it("reports the error code to every subscriber and never reopens the failed listener", () => {
    const a = subscribe();
    const b = subscribe();
    listeners[0].fail({ code: "permission-denied" });
    for (const fn of [a.fn, b.fn]) {
      expect(fn).toHaveBeenLastCalledWith(
        expect.objectContaining({ loaded: true, error: "permission-denied" }),
      );
    }
    // A late subscriber gets the failure without opening another listener.
    const c = subscribe();
    expect(c.fn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "permission-denied" }),
    );
    expect(listeners).toHaveLength(1);

    a.release();
    b.release();
    c.release();
    expect(listeners[0].unsub).toHaveBeenCalledTimes(1);
    // A fresh visit (e.g. after the page reloads) opens exactly one new listener.
    const d = subscribe();
    expect(listeners).toHaveLength(2);
    d.release();
  });

  it("marks cache-only snapshots so a missing document isn't trusted", () => {
    const a = subscribe();
    listeners[0].next({ data: () => undefined, metadata: { fromCache: true } });
    expect(a.fn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: undefined,
        loaded: true,
        fromCache: true,
      }),
    );
    a.release();
  });

  it("gives a late subscriber the current state without opening a listener", () => {
    const a = subscribe();
    listeners[0].next(serverSnap({ name: "x" }));
    const b = subscribe();
    expect(listeners).toHaveLength(1);
    expect(b.fn).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: "x" }, loaded: true }),
    );
    a.release();
    b.release();
  });
});
