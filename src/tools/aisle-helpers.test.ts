import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { Aisle } from "../aisle/types.js";
import type { ServerContext } from "../types/server-context.js";

import { AisleStore } from "../aisle/store.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { RecipeStore } from "../recipe/store.js";
import { aisleStartGuard, commitAisle, ensureAisle } from "./aisle-helpers.js";
import { makeCtx, makeTestServer, seed } from "./tool-test-utils.js";

function makeAisleCtx(
  aisleStore: AisleStore,
  overrides?: {
    saveAisle?: (a: Readonly<Aisle>) => Promise<Aisle>;
    notifySync?: () => Promise<void>;
    putAisle?: () => Promise<void>;
    flush?: () => Promise<void>;
  },
): ServerContext {
  const { server } = makeTestServer();
  return makeCtx(new RecipeStore(), server, {
    aisleStore,
    client: fromAny({
      saveAisle: overrides?.saveAisle ?? vi.fn(),
      notifySync: overrides?.notifySync ?? vi.fn().mockResolvedValue(undefined),
    }),
    cache: fromAny({
      aisles: { put: overrides?.putAisle ?? vi.fn().mockResolvedValue(undefined) },
      flush: overrides?.flush ?? vi.fn().mockResolvedValue(undefined),
    }),
  });
}

describe("aisle-helpers", () => {
  describe("aisleStartGuard", () => {
    it("aisle-helpers.AC1.1: returns Ok when aisleStore has synced", () => {
      const aisleStore = new AisleStore();
      const ctx = makeAisleCtx(aisleStore);
      seed(ctx, { aisles: [] });
      const result = aisleStartGuard(ctx);
      expect(result.isOk()).toBe(true);
    });

    it("aisle-helpers.AC1.2: returns Err when aisleStore has not synced", () => {
      const aisleStore = new AisleStore();
      const result = aisleStartGuard(makeAisleCtx(aisleStore));
      expect(result.isErr()).toBe(true);
    });

    it("aisle-helpers.AC1.3: Err message mentions not yet synced", () => {
      const aisleStore = new AisleStore();
      const result = aisleStartGuard(makeAisleCtx(aisleStore));
      result.match(
        () => {
          throw new Error("should not be ok");
        },
        (err) => {
          const text = err.content.find((c) => c.type === "text")?.text ?? "";
          expect(text.toLowerCase()).toContain("not yet synced");
        },
      );
    });
  });

  describe("commitAisle", () => {
    it("aisle-helpers.AC2.1: marks pending upsert before cache I/O", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle({ name: "Bakery" });

      let pendingFlagDuringPut = false;
      const putAisle = vi.fn().mockImplementation(async () => {
        pendingFlagDuringPut = aisleStore.isPendingUpsert(aisle.uid);
      });
      const flush = vi.fn().mockResolvedValue(undefined);
      const notifySync = vi.fn().mockResolvedValue(undefined);

      const ctx = makeAisleCtx(aisleStore, { putAisle, flush, notifySync });
      seed(ctx, { aisles: [] });
      await commitAisle(ctx, aisle);

      expect(pendingFlagDuringPut).toBe(true);
    });

    it("aisle-helpers.AC2.2: puts aisle in cache and flushes", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle({ name: "Produce" });

      const putAisle = vi.fn().mockResolvedValue(undefined);
      const flush = vi.fn().mockResolvedValue(undefined);
      const notifySync = vi.fn().mockResolvedValue(undefined);

      const ctx = makeAisleCtx(aisleStore, { putAisle, flush, notifySync });
      seed(ctx, { aisles: [] });
      await commitAisle(ctx, aisle);

      expect(putAisle).toHaveBeenCalledWith(aisle);
      expect(flush).toHaveBeenCalledOnce();
    });

    it("aisle-helpers.AC2.3: sets aisle in store after cache commit", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle({ name: "Deli" });

      const ctx = makeAisleCtx(aisleStore);
      seed(ctx, { aisles: [] });
      await commitAisle(ctx, aisle);

      expect(aisleStore.resolveByName("Deli")).toEqual(aisle);
    });

    it("aisle-helpers.AC2.4: calls notifySync after store update", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle();

      const notifySync = vi.fn().mockResolvedValue(undefined);
      const ctx = makeAisleCtx(aisleStore, { notifySync });
      seed(ctx, { aisles: [] });
      await commitAisle(ctx, aisle);

      expect(notifySync).toHaveBeenCalledOnce();
    });

    it("aisle-helpers.AC2.5: clears pending on cache put failure", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle();

      const putAisle = vi.fn().mockRejectedValue(new Error("disk full"));
      const ctx = makeAisleCtx(aisleStore, { putAisle });
      seed(ctx, { aisles: [] });

      await expect(commitAisle(ctx, aisle)).rejects.toThrow("disk full");
      expect(aisleStore.isPendingUpsert(aisle.uid)).toBe(false);
    });
  });

  describe("ensureAisle", () => {
    it("aisle-helpers.AC3.1: empty string returns empty pair without I/O", async () => {
      const aisleStore = new AisleStore();
      const saveAisle = vi.fn();

      const ctx = makeAisleCtx(aisleStore, { saveAisle });
      seed(ctx, { aisles: [] });
      const result = await ensureAisle(ctx, "");

      expect(result).toEqual({ aisle: "", aisleUid: "" });
      expect(saveAisle).not.toHaveBeenCalled();
    });

    it("aisle-helpers.AC3.2: known aisle resolves without calling saveAisle", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle({ name: "Produce" });
      const saveAisle = vi.fn();

      const ctx = makeAisleCtx(aisleStore, { saveAisle });
      seed(ctx, { aisles: [aisle] });
      const result = await ensureAisle(ctx, "Produce");

      expect(result).toEqual({ aisle: "Produce", aisleUid: aisle.uid });
      expect(saveAisle).not.toHaveBeenCalled();
    });

    it("aisle-helpers.AC3.3: case-insensitive resolution", async () => {
      const aisleStore = new AisleStore();
      const aisle = makeAisle({ name: "Dairy" });
      const saveAisle = vi.fn();

      const ctx = makeAisleCtx(aisleStore, { saveAisle });
      seed(ctx, { aisles: [aisle] });
      const result = await ensureAisle(ctx, "dairy");

      expect(result.aisle).toBe("Dairy");
      expect(saveAisle).not.toHaveBeenCalled();
    });

    it("aisle-helpers.AC3.4: unknown aisle calls saveAisle and commits", async () => {
      const aisleStore = new AisleStore();
      const newAisle = makeAisle({ name: "Exotic" });
      const saveAisle = vi.fn().mockResolvedValue(newAisle);
      const putAisle = vi.fn().mockResolvedValue(undefined);
      const flush = vi.fn().mockResolvedValue(undefined);
      const notifySync = vi.fn().mockResolvedValue(undefined);

      const ctx = makeAisleCtx(aisleStore, { saveAisle, putAisle, flush, notifySync });
      seed(ctx, { aisles: [] });
      const result = await ensureAisle(ctx, "Exotic");

      expect(saveAisle).toHaveBeenCalledOnce();
      expect(result).toEqual({ aisle: newAisle.name, aisleUid: newAisle.uid });
    });

    it("aisle-helpers.AC3.5: auto-create uses uppercase UUID v4 as UID", async () => {
      const aisleStore = new AisleStore();

      const saveAisle = vi.fn().mockImplementation(async (a: Aisle) => a);
      const ctx = makeAisleCtx(aisleStore, { saveAisle });
      seed(ctx, { aisles: [] });
      await ensureAisle(ctx, "New Aisle");

      const passedAisle = saveAisle.mock.calls[0]?.[0] as Aisle | undefined;
      const uuidUppercaseRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
      expect(passedAisle?.uid).toMatch(uuidUppercaseRegex);
    });

    it("aisle-helpers.AC3.6: auto-create orderFlag is 0 when store is empty", async () => {
      const aisleStore = new AisleStore();

      const saveAisle = vi.fn().mockImplementation(async (a: Aisle) => a);
      const ctx = makeAisleCtx(aisleStore, { saveAisle });
      seed(ctx, { aisles: [] });
      await ensureAisle(ctx, "First Aisle");

      const passedAisle = saveAisle.mock.calls[0]?.[0] as Aisle | undefined;
      expect(passedAisle?.orderFlag).toBe(0);
    });

    it("aisle-helpers.AC3.7: auto-create orderFlag is max+1 when aisles exist", async () => {
      const aisleStore = new AisleStore();
      const a1 = makeAisle({ orderFlag: 3 });
      const a2 = makeAisle({ orderFlag: 7 });

      const saveAisle = vi.fn().mockImplementation(async (a: Aisle) => a);
      const ctx = makeAisleCtx(aisleStore, { saveAisle });
      seed(ctx, { aisles: [a1, a2] });
      await ensureAisle(ctx, "New Aisle");

      const passedAisle = saveAisle.mock.calls[0]?.[0] as Aisle | undefined;
      expect(passedAisle?.orderFlag).toBe(8);
    });
  });
});
