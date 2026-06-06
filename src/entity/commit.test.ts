import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { CommitCache } from "./commit.js";

import { commitEntities, commitSlices, deleteOp, sliceOps, upsertOp } from "./commit.js";
import { EntityStore } from "./store.js";

// The protocol pins live here, once, instead of per-domain: mark-before-I/O,
// clear-ALL-on-failure, one flush per cache, effects only on success, and the
// joint multi-slice rollback. The per-domain chokepoints are one-line bindings
// over this helper, covered by their own tool tests.

interface Item {
  readonly uid: string;
  readonly name: string;
}

type TestError = { readonly message: string };

class TestStore extends EntityStore<Item, string> {}

/** A fake cache that records protocol-ordered calls into a shared log and fails on demand. */
function makeCache(
  log: string[],
  tag: string,
  failures: { put?: boolean; remove?: boolean; flush?: boolean } = {},
): CommitCache<Item, TestError> {
  return {
    put: (item) => {
      log.push(`${tag}.put(${item.uid})`);
      return failures.put ? errAsync({ message: `${tag} put failed` }) : okAsync(undefined);
    },
    remove: (key) => {
      log.push(`${tag}.remove(${key})`);
      return failures.remove ? errAsync({ message: `${tag} remove failed` }) : okAsync(undefined);
    },
    flush: () => {
      log.push(`${tag}.flush`);
      return failures.flush ? errAsync({ message: `${tag} flush failed` }) : okAsync(undefined);
    },
  };
}

/** A store whose pending marks also land in the shared call log, for ordering assertions. */
function makeStore(log: string[], tag: string): TestStore {
  const store = new TestStore();
  const base = {
    up: store.markPendingUpsert.bind(store),
    del: store.markPendingDelete.bind(store),
  };
  store.markPendingUpsert = (uid, at?) => {
    log.push(`${tag}.markUpsert(${uid})`);
    base.up(uid, at);
  };
  store.markPendingDelete = (uid, at?) => {
    log.push(`${tag}.markDelete(${uid})`);
    base.del(uid, at);
  };
  return store;
}

const item = (uid: string): Item => ({ uid, name: `item ${uid}` });

function makeEffects(log: string[]) {
  return {
    onCommitted: () => {
      log.push("onCommitted");
    },
    finish: () => {
      log.push("finish");
      return okAsync<void, never>(undefined);
    },
  };
}

describe("commitEntities: op kinds drive mark / cache / store correctly", () => {
  it("upsert: marks upsert-intent, puts, sets, then effects in order", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    const cache = makeCache(log, "c");

    const result = await commitEntities({ store, cache }, [upsertOp(item("A"))], makeEffects(log));

    result._unsafeUnwrap();
    expect(log).toEqual(["s.markUpsert(A)", "c.put(A)", "c.flush", "onCommitted", "finish"]);
    expect(store.get("A")).toEqual(item("A"));
    expect(store.isPendingUpsert("A")).toBe(true);
  });

  it("upsert with markDelete (soft-delete): delete-intent mark, but the row is still put + set", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    const cache = makeCache(log, "c");

    const result = await commitEntities(
      { store, cache },
      [upsertOp(item("A"), { markDelete: true })],
      makeEffects(log),
    );

    result._unsafeUnwrap();
    expect(log).toEqual(["s.markDelete(A)", "c.put(A)", "c.flush", "onCommitted", "finish"]);
    expect(store.get("A")).toEqual(item("A"));
    expect(store.isPendingDelete("A")).toBe(true);
  });

  it("delete: delete-intent mark, cache remove, store delete", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    store.set(item("A"));
    const cache = makeCache(log, "c");

    const result = await commitEntities({ store, cache }, [deleteOp("A")], makeEffects(log));

    result._unsafeUnwrap();
    expect(log).toEqual(["s.markDelete(A)", "c.remove(A)", "c.flush", "onCommitted", "finish"]);
    expect(store.get("A")).toBeUndefined();
    expect(store.isPendingDelete("A")).toBe(true);
  });

  it("mixed batch: every mark lands before any cache op, one flush, one finish", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    store.set(item("B"));
    const cache = makeCache(log, "c");

    const result = await commitEntities(
      { store, cache },
      [upsertOp(item("A")), deleteOp("B"), upsertOp(item("C"))],
      makeEffects(log),
    );

    result._unsafeUnwrap();
    const firstCacheCall = log.findIndex((l) => l.startsWith("c."));
    const lastMark = log.map((l) => l.startsWith("s.mark")).lastIndexOf(true);
    expect(lastMark).toBeLessThan(firstCacheCall);
    expect(log.filter((l) => l === "c.flush")).toHaveLength(1);
    expect(log.filter((l) => l === "finish")).toHaveLength(1);
    expect(store.get("A")).toEqual(item("A"));
    expect(store.get("B")).toBeUndefined();
    expect(store.get("C")).toEqual(item("C"));
  });

  it("empty ops short-circuit: no marks, no flush, no effects", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    const cache = makeCache(log, "c");

    const result = await commitEntities({ store, cache }, [], makeEffects(log));

    result._unsafeUnwrap();
    expect(log).toEqual([]);
  });
});

describe("commitEntities: the failure path clears every mark and runs no effects", () => {
  it("flush failure: all pending marks cleared, store untouched, error surfaces", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    const cache = makeCache(log, "c", { flush: true });

    const result = await commitEntities({ store, cache }, [upsertOp(item("A")), deleteOp("B")], makeEffects(log));

    expect(result._unsafeUnwrapErr().message).toBe("c flush failed");
    expect(store.pendingWriteCount).toBe(0);
    expect(store.get("A")).toBeUndefined();
    expect(log).not.toContain("onCommitted");
    expect(log).not.toContain("finish");
  });

  it("per-op (put) failure: same clear-all, no store mutation, error surfaces", async () => {
    const log: string[] = [];
    const store = makeStore(log, "s");
    const cache = makeCache(log, "c", { put: true });

    const result = await commitEntities({ store, cache }, [upsertOp(item("A")), upsertOp(item("B"))], makeEffects(log));

    expect(result._unsafeUnwrapErr()).toBeDefined();
    expect(store.pendingWriteCount).toBe(0);
    expect(store.get("A")).toBeUndefined();
    expect(store.get("B")).toBeUndefined();
    expect(log).not.toContain("onCommitted");
  });
});

describe("commitSlices: the joint multi-slice commit (the photo-upload shape)", () => {
  it("two slices: all marks first, both caches' ops, both flushed, one finish", async () => {
    const log: string[] = [];
    const recipeStore = makeStore(log, "recipe");
    const photoStore = makeStore(log, "photo");
    const recipeCache = makeCache(log, "rc");
    const photoCache = makeCache(log, "pc");

    const result = await commitSlices(
      [
        sliceOps({ store: recipeStore, cache: recipeCache }, [upsertOp(item("R"))]),
        sliceOps({ store: photoStore, cache: photoCache }, [upsertOp(item("P"))]),
      ],
      makeEffects(log),
    );

    result._unsafeUnwrap();
    expect(log).toEqual([
      "recipe.markUpsert(R)",
      "photo.markUpsert(P)",
      "rc.put(R)",
      "pc.put(P)",
      "rc.flush",
      "pc.flush",
      "onCommitted",
      "finish",
    ]);
    expect(recipeStore.get("R")).toEqual(item("R"));
    expect(photoStore.get("P")).toEqual(item("P"));
  });

  it("first slice's flush failure rolls back BOTH slices' marks and skips the second flush", async () => {
    const log: string[] = [];
    const recipeStore = makeStore(log, "recipe");
    const photoStore = makeStore(log, "photo");
    const recipeCache = makeCache(log, "rc", { flush: true });
    const photoCache = makeCache(log, "pc");

    const result = await commitSlices(
      [
        sliceOps({ store: recipeStore, cache: recipeCache }, [upsertOp(item("R"))]),
        sliceOps({ store: photoStore, cache: photoCache }, [upsertOp(item("P"))]),
      ],
      makeEffects(log),
    );

    expect(result._unsafeUnwrapErr()).toBeDefined();
    // Sequential flushes: a failed earlier flush leaves later caches unflushed
    // (their buffered ops never hit disk), matching the hand-written original.
    expect(log).not.toContain("pc.flush");
    expect(recipeStore.pendingWriteCount).toBe(0);
    expect(photoStore.pendingWriteCount).toBe(0);
    expect(recipeStore.get("R")).toBeUndefined();
    expect(photoStore.get("P")).toBeUndefined();
  });
});
