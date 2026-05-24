import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { AisleStore } from "../cache/aisle-store.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { registerAislesTool } from "./aisles.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

function makeAisleTestCtx(aisleStore: AisleStore) {
  const store = new RecipeStore();
  const { server, callTool } = makeTestServer();
  const ctx = makeCtx(store, server, { aisleStore });
  registerAislesTool(server, ctx);
  return { callTool };
}

describe("list_aisles tool", () => {
  it("aisles.AC1.1: cold-start guard blocks when aisleStore not synced", async () => {
    const aisleStore = new AisleStore();
    const { callTool } = makeAisleTestCtx(aisleStore);

    const result = await callTool("list_aisles", {});
    const text = getText(result);
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("aisles.AC1.2: empty aisle list returns helpful message", async () => {
    const aisleStore = new AisleStore();
    aisleStore.load([]);
    const { callTool } = makeAisleTestCtx(aisleStore);

    const result = await callTool("list_aisles", {});
    const text = getText(result);
    expect(text.toLowerCase()).toContain("no aisles found");
    expect(text).toContain("Paprika app");
  });

  it("aisles.AC1.3: aisles sorted by orderFlag ascending", async () => {
    const aisleStore = new AisleStore();
    const a1 = makeAisle({ name: "Produce", orderFlag: 3 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 1 });
    const a3 = makeAisle({ name: "Bakery", orderFlag: 2 });
    aisleStore.load([a1, a2, a3]);
    const { callTool } = makeAisleTestCtx(aisleStore);

    const result = await callTool("list_aisles", {});
    const text = getText(result);
    const dairyIdx = text.indexOf("Dairy");
    const bakeryIdx = text.indexOf("Bakery");
    const produceIdx = text.indexOf("Produce");
    expect(dairyIdx).toBeLessThan(bakeryIdx);
    expect(bakeryIdx).toBeLessThan(produceIdx);
  });

  it("aisles.AC1.4: aisles with same orderFlag sorted by name", async () => {
    const aisleStore = new AisleStore();
    const a1 = makeAisle({ name: "Produce", orderFlag: 1 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 1 });
    aisleStore.load([a1, a2]);
    const { callTool } = makeAisleTestCtx(aisleStore);

    const result = await callTool("list_aisles", {});
    const text = getText(result);
    expect(text.indexOf("Dairy")).toBeLessThan(text.indexOf("Produce"));
  });

  it("aisles.AC1.5: output includes aisle name in bold and UID in backticks", async () => {
    const aisleStore = new AisleStore();
    const aisle = makeAisle({ name: "Bakery", orderFlag: 1 });
    aisleStore.load([aisle]);
    const { callTool } = makeAisleTestCtx(aisleStore);

    const result = await callTool("list_aisles", {});
    const text = getText(result);
    expect(text).toContain(`**Bakery**`);
    expect(text).toContain(`\`${aisle.uid}\``);
  });

  it("aisles.AC1.6: each aisle is on its own line with dash prefix", async () => {
    const aisleStore = new AisleStore();
    const a1 = makeAisle({ name: "Produce", orderFlag: 1 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 2 });
    aisleStore.load([a1, a2]);
    const { callTool } = makeAisleTestCtx(aisleStore);

    const result = await callTool("list_aisles", {});
    const text = getText(result);
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \*\*/);
    expect(lines[1]).toMatch(/^- \*\*/);
  });
});
