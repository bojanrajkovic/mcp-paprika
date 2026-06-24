import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AisleState } from "../module.js";
import type { Aisle } from "../types.js";

import { makeAisle } from "../../../../test/domains/aisle/__fixtures__/aisles.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getJson, getText } from "../../../../test/support/tool-test-utils.js";

describe("update_aisle tool", () => {
  const kh = useKernelHarness<AisleState>("aisle");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  function seedCatalog(): { produce: Aisle; dairy: Aisle; frozen: Aisle } {
    const produce = makeAisle({ name: "Produce", orderFlag: 0 });
    const dairy = makeAisle({ name: "Dairy", orderFlag: 1 });
    const frozen = makeAisle({ name: "Frozen", orderFlag: 2 });
    kh.seed({ aisles: [produce, dairy, frozen] });
    return { produce, dairy, frozen };
  }

  it("returns sync-not-ready message when the catalog has not synced", async () => {
    const text = await kh.callToolText("update_aisle", { uid: "aisle-x", name: "Veg" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found for an unknown UID", async () => {
    seedCatalog();
    const result = await kh.callTool("update_aisle", { uid: "nope", name: "Veg" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain('No aisle found with UID "nope"');
  });

  it("requires at least one of name/position", async () => {
    const { produce } = seedCatalog();
    const result = await kh.callTool("update_aisle", { uid: produce.uid });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain("Nothing to update");
  });

  it("renames an aisle, echoing the whole catalog over structuredContent", async () => {
    const { produce, dairy, frozen } = seedCatalog();

    const result = await kh.callTool("update_aisle", { uid: produce.uid, name: "Fresh Produce" });

    // The renamed catalog rides the JSON text channel — same payload as structuredContent.
    expect(getJson(result)).toEqual(result.structuredContent);
    expect(kh.state().store.get(produce.uid)?.name).toBe("Fresh Produce");
    // Only the renamed aisle is saved — order flags untouched.
    const saveAisles = vi.mocked(kh.client().saveAisles);
    expect(saveAisles).toHaveBeenCalledOnce();
    const saved = saveAisles.mock.calls[0]![0] as ReadonlyArray<Aisle>;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ uid: produce.uid, name: "Fresh Produce", orderFlag: 0 });
    // Grocery-list resources render aisle names from this catalog live, so the
    // commit must tell subscribed clients to refresh.
    expect(kh.resourceListChanged()).toHaveBeenCalled();
    // The whole post-rename catalog (same shape list_aisles produces) rides structuredContent.
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      items: [
        { uid: produce.uid, name: "Fresh Produce" },
        { uid: dairy.uid, name: "Dairy" },
        { uid: frozen.uid, name: "Frozen" },
      ],
    });
  });

  it("rejects a rename that collides with another aisle's name", async () => {
    const { produce } = seedCatalog();
    const result = await kh.callTool("update_aisle", { uid: produce.uid, name: "dairy" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain('An aisle named "Dairy" already exists');
    expect(kh.client().saveAisles).not.toHaveBeenCalled();
  });

  it("moves an aisle to a new position and renumbers contiguously", async () => {
    const { produce, dairy, frozen } = seedCatalog();

    const text = await kh.callToolText("update_aisle", { uid: frozen.uid, position: 1 });

    // The echoed catalog (JSON text) now leads with the moved aisle.
    expect((JSON.parse(text) as { items: Array<{ uid: string }> }).items[0]!.uid).toBe(frozen.uid);
    // New order: Frozen(0), Produce(1), Dairy(2).
    expect(kh.state().store.get(frozen.uid)?.orderFlag).toBe(0);
    expect(kh.state().store.get(produce.uid)?.orderFlag).toBe(1);
    expect(kh.state().store.get(dairy.uid)?.orderFlag).toBe(2);
    // The response renders the resulting walk order.
    expect(text.indexOf("Frozen")).toBeLessThan(text.indexOf("Produce"));
    expect(text.indexOf("Produce")).toBeLessThan(text.indexOf("Dairy"));
  });

  it("clamps a past-the-end position to last", async () => {
    const { produce, dairy, frozen } = seedCatalog();

    const text = await kh.callToolText("update_aisle", { uid: produce.uid, position: 99 });

    // Clamped to last: the echoed catalog (JSON text) ends with the moved aisle.
    expect((JSON.parse(text) as { items: Array<{ uid: string }> }).items[2]!.uid).toBe(produce.uid);
    expect(kh.state().store.get(dairy.uid)?.orderFlag).toBe(0);
    expect(kh.state().store.get(frozen.uid)?.orderFlag).toBe(1);
    expect(kh.state().store.get(produce.uid)?.orderFlag).toBe(2);
  });

  it("reports no changes when name and position already match", async () => {
    const { produce, dairy, frozen } = seedCatalog();
    const result = await kh.callTool("update_aisle", { uid: produce.uid, name: "Produce" });
    // An update whose requested end-state already holds is an idempotent success,
    // not an error — it echoes the unchanged catalog over structuredContent.
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      items: [
        { uid: produce.uid, name: "Produce" },
        { uid: dairy.uid, name: "Dairy" },
        { uid: frozen.uid, name: "Frozen" },
      ],
    });
    // The unchanged catalog rides the JSON text channel too.
    expect(getJson(result)).toEqual(result.structuredContent);
    expect(kh.client().saveAisles).not.toHaveBeenCalled();
  });

  it("serializes concurrent renames — only one of two same-name renames wins", async () => {
    const { produce, dairy } = seedCatalog();
    // Hold the first rename's save open so the second call arrives while the
    // first is mid-flight. With the catalog write lock, the second waits and
    // then sees the committed name; without it, both pass the clash check.
    let releaseSave: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    vi.mocked(kh.client().saveAisles)
      .mockReturnValueOnce(ResultAsync.fromSafePromise(gate) as never)
      .mockReturnValue(okAsync(undefined) as never);

    const first = kh.callToolText("update_aisle", { uid: produce.uid, name: "Snacks" });
    const second = kh.callToolText("update_aisle", { uid: dairy.uid, name: "snacks" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseSave();
    const [text1, text2] = await Promise.all([first, second]);

    expect((JSON.parse(text1) as { items: Array<{ uid: string; name: string }> }).items).toContainEqual({
      uid: produce.uid,
      name: "Snacks",
    });
    expect(text2).toContain('An aisle named "Snacks" already exists');
    expect(kh.state().store.get(dairy.uid)?.name).toBe("Dairy");
  });

  it("surfaces a save failure without touching the store", async () => {
    const { produce } = seedCatalog();
    vi.mocked(kh.client().saveAisles).mockReturnValue(
      errAsync({ kind: "http", status: 500, message: "boom" } as never),
    );

    const result = await kh.callTool("update_aisle", { uid: produce.uid, name: "Veg" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain("Failed to update aisle");
    expect(kh.state().store.get(produce.uid)?.name).toBe("Produce");
  });
});
