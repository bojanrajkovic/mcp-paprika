import { describe, it, expect, vi } from "vitest";
import { PantryStore } from "../cache/pantry-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { commitPantryItem } from "./pantry-helpers.js";
import { makeTestServer, makeCtx, makeStubNotifier } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";

describe("pantry-mutations.AC3: commitPantryItem helper", () => {
  describe("AC3.1: upsert branch (deleted: false)", () => {
    it("should call putPantryItem, flush, set, resourceListChanged, notifySync in order", async () => {
      // Arrange
      const saved = makePantryItem({ deleted: false });
      const pantryStore = new PantryStore();
      const setSpy = vi.spyOn(pantryStore, "set");
      const _deleteSpy = vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new PantryStore(), server, {
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: {
          putPantryItem: mockPutPantryItem,
          removePantryItem: mockRemovePantryItem,
          flush: mockFlush,
        } as unknown as DiskCache,
        pantryStore,
        notifier: stub.notifier,
      });

      // Act
      await commitPantryItem(ctx, saved);

      // Assert: verify full ordering using invocationCallOrder
      expect(mockPutPantryItem.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]!);
      expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(
        mockNotifySync.mock.invocationCallOrder[0]!,
      );

      // Assert: verify delete-branch mocks were NOT called
      expect(mockRemovePantryItem).not.toHaveBeenCalled();
      expect(_deleteSpy).not.toHaveBeenCalled();

      // Assert: verify item was set in store
      expect(setSpy).toHaveBeenCalledWith(saved);
      expect(pantryStore.get(saved.uid)).toEqual(saved);
    });
  });

  describe("AC3.2: delete branch (deleted: true)", () => {
    it("should call removePantryItem, flush, delete, resourceListChanged, notifySync in order", async () => {
      // Arrange
      const item = makePantryItem({ deleted: false });
      const saved = { ...item, deleted: true };
      const pantryStore = new PantryStore();
      pantryStore.load([item]);
      const _setSpy = vi.spyOn(pantryStore, "set");
      const deleteSpy = vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new PantryStore(), server, {
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: {
          putPantryItem: mockPutPantryItem,
          removePantryItem: mockRemovePantryItem,
          flush: mockFlush,
        } as unknown as DiskCache,
        pantryStore,
        notifier: stub.notifier,
      });

      // Act
      await commitPantryItem(ctx, saved);

      // Assert: verify full ordering using invocationCallOrder
      expect(mockRemovePantryItem.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(deleteSpy.mock.invocationCallOrder[0]!);
      expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(
        mockNotifySync.mock.invocationCallOrder[0]!,
      );

      // Assert: verify upsert-branch mocks were NOT called
      expect(mockPutPantryItem).not.toHaveBeenCalled();
      expect(_setSpy).not.toHaveBeenCalled();

      // Assert: verify item was deleted from store
      expect(deleteSpy).toHaveBeenCalledWith(saved.uid);
      expect(pantryStore.get(saved.uid)).toBeUndefined();
    });
  });

  describe("AC3.3: flush rejection propagation", () => {
    it("should reject when flush fails in upsert branch, preventing subsequent steps", async () => {
      // Arrange
      const saved = makePantryItem({ deleted: false });
      const pantryStore = new PantryStore();
      const setSpy = vi.spyOn(pantryStore, "set");
      vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn();
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new PantryStore(), server, {
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: {
          putPantryItem: mockPutPantryItem,
          removePantryItem: mockRemovePantryItem,
          flush: mockFlush,
        } as unknown as DiskCache,
        pantryStore,
        notifier: stub.notifier,
      });

      // Act & Assert
      await expect(commitPantryItem(ctx, saved)).rejects.toThrow("flush failed");

      // Assert: putPantryItem WAS called (before flush)
      expect(mockPutPantryItem).toHaveBeenCalledWith(saved);

      // Assert: subsequent steps did NOT run
      expect(setSpy.mock.calls.length).toBe(0);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();
      expect(pantryStore.get(saved.uid)).toBeUndefined();
    });

    it("should reject when flush fails in delete branch, preventing subsequent steps", async () => {
      // Arrange
      const item = makePantryItem({ deleted: false });
      const saved = { ...item, deleted: true };
      const pantryStore = new PantryStore();
      pantryStore.load([item]);
      vi.spyOn(pantryStore, "set");
      const deleteSpy = vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new PantryStore(), server, {
        client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: {
          putPantryItem: mockPutPantryItem,
          removePantryItem: mockRemovePantryItem,
          flush: mockFlush,
        } as unknown as DiskCache,
        pantryStore,
        notifier: stub.notifier,
      });

      // Act & Assert
      await expect(commitPantryItem(ctx, saved)).rejects.toThrow("flush failed");

      // Assert: removePantryItem WAS called (before flush)
      expect(mockRemovePantryItem).toHaveBeenCalledWith(saved.uid);

      // Assert: subsequent steps did NOT run
      expect(deleteSpy.mock.calls.length).toBe(0);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();
      // Item should still be in store (not deleted by the helper)
      expect(pantryStore.get(saved.uid)).toEqual(item);
    });
  });
});
