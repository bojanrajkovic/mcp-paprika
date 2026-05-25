import { describe, it, expect, beforeEach } from "vitest";
import { TombstoneEntityStore } from "./tombstone-store.js";

type TestUid = string & { readonly __brand: "TestUid" };

function uid(s: string): TestUid {
  return s as TestUid;
}

interface TestEntity {
  uid: TestUid;
  value: string;
}

class TestStore extends TombstoneEntityStore<TestEntity, TestUid> {}

function makeEntity(u: string, value = "v"): TestEntity {
  return { uid: uid(u), value };
}

describe("TombstoneEntityStore", () => {
  let store: TestStore;

  beforeEach(() => {
    store = new TestStore();
  });

  it("delete() of a present item records tombstone", () => {
    store.load([makeEntity("a")]);
    expect(store.isTombstone(uid("a"))).toBe(false);

    store.delete(uid("a"));

    expect(store.get(uid("a"))).toBeUndefined();
    expect(store.isTombstone(uid("a"))).toBe(true);
  });

  it("delete() always tombstones even when UID is absent (sync-race defense)", () => {
    store.load([]);

    store.delete(uid("never-existed"));

    expect(store.isTombstone(uid("never-existed"))).toBe(true);
  });

  it("set() clears tombstone for that UID (resurrection via upsert)", () => {
    const entity = makeEntity("a");
    store.load([entity]);
    store.delete(uid("a"));
    expect(store.isTombstone(uid("a"))).toBe(true);

    store.set(entity);

    expect(store.isTombstone(uid("a"))).toBe(false);
    expect(store.get(uid("a"))).toEqual(entity);
  });

  it("load() preserves tombstones for UIDs absent from the new snapshot", () => {
    store.load([makeEntity("a")]);
    store.delete(uid("a"));
    expect(store.isTombstone(uid("a"))).toBe(true);

    store.load([]);

    expect(store.isTombstone(uid("a"))).toBe(true);
  });

  it("load() clears tombstones for UIDs that reappear in the new snapshot (resurrection via sync)", () => {
    const entity = makeEntity("a");
    store.load([entity]);
    store.delete(uid("a"));
    expect(store.isTombstone(uid("a"))).toBe(true);

    store.load([entity]);

    expect(store.isTombstone(uid("a"))).toBe(false);
    expect(store.get(uid("a"))).toEqual(entity);
  });

  it("isTombstone() returns false for unknown UIDs", () => {
    expect(store.isTombstone(uid("not-here"))).toBe(false);
  });

  it("load() sets hasSynced and replaces items", () => {
    const a = makeEntity("a");
    const b = makeEntity("b");
    store.load([a]);
    expect(store.hasSynced).toBe(true);
    expect(store.get(uid("a"))).toEqual(a);

    store.load([b]);

    expect(store.get(uid("a"))).toBeUndefined();
    expect(store.get(uid("b"))).toEqual(b);
    expect(store.hasSynced).toBe(true);
  });
});
