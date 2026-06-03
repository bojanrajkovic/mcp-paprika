// scripts/smoke-pantry-write.ts
//
// Manual-validation smoke test runner for pantry write operations.
// Exercises the full pantry write path against a real Paprika account.
// Output is suitable for direct paste into a PR comment.
//
// Usage: npx tsx scripts/smoke-pantry-write.ts > /tmp/pantry-smoke-report.md
// Output goes to stdout (markdown report) and stderr (progress messages).

import { randomUUID } from "node:crypto";

import type { PantryItem } from "../src/pantry/types.js";

import { PantryItemUidSchema } from "../src/ids.js";
import { PaprikaClient } from "../src/paprika/client.js";
import { loadConfig } from "../src/utils/config.js";
import { todayWire } from "../src/utils/dates.js";

const SMOKE_PREFIX = "[mcp-smoke]";

type StepResult = { name: string; status: "pass" | "fail"; detail: string };

function logProgress(message: string): void {
  process.stderr.write(`${message}\n`);
}

function emitReport(steps: ReadonlyArray<StepResult>): void {
  const lines: Array<string> = [];
  lines.push("## Pantry Write Smoke Test Report");
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Step | Result | Detail |");
  lines.push("|------|--------|--------|");
  for (const step of steps) {
    const icon = step.status === "pass" ? "✓" : "✗";
    const detail = step.detail.replaceAll("|", "\\|").replaceAll("\n", " ");
    lines.push(`| ${step.name} | ${icon} | ${detail} |`);
  }
  lines.push("");
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function runCleanup(client: PaprikaClient, steps: Array<StepResult>): Promise<void> {
  logProgress("Cleanup: listing current pantry...");
  const all = await client.listPantry();
  // Also sweep [mcp-e2e] orphans from scripts/e2e-mcp-pantry.ts so a crashed
  // e2e run that left items behind gets cleaned up on the next smoke run.
  const stale = all.filter((i) => i.ingredient.startsWith(SMOKE_PREFIX) || i.ingredient.startsWith("[mcp-e2e]"));
  logProgress(`Found ${stale.length.toString()} stale [mcp-smoke] items.`);

  for (const item of stale) {
    try {
      await client.savePantryItem({ ...item, deleted: true });
      logProgress(`Cleaned up: ${item.uid} (${item.ingredient})`);
    } catch (error) {
      logProgress(`Cleanup failed for ${item.uid}: ${error instanceof Error ? error.message : String(error)}`);
      steps.push({
        name: "Cleanup",
        status: "fail",
        detail: `${item.uid}: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  }

  if (stale.length > 0) {
    await client.notifySync();
  }

  steps.push({
    name: "Cleanup",
    status: "pass",
    detail: `Cleaned up ${stale.length.toString()} stale items.`,
  });
}

async function runHappyPath(client: PaprikaClient, steps: Array<StepResult>): Promise<PantryItem | null> {
  const uid = PantryItemUidSchema.parse(randomUUID());
  const ingredient = `${SMOKE_PREFIX} ${Date.now().toString()}`;
  const newItem: PantryItem = {
    uid,
    ingredient,
    quantity: "1",
    aisle: "",
    aisleUid: "",
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: todayWire(),
    locationUid: null,
    notes: null,
    deleted: false,
  };

  // Add
  try {
    await client.savePantryItem(newItem);
    await client.notifySync();
    steps.push({
      name: "Happy-path: add",
      status: "pass",
      detail: `Saved ${uid} (${ingredient}).`,
    });
  } catch (error) {
    steps.push({
      name: "Happy-path: add",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  // Verify presence
  const afterAdd = await client.listPantry();
  if (!afterAdd.some((i) => i.uid === uid)) {
    steps.push({
      name: "Happy-path: add (verify)",
      status: "fail",
      detail: "Item not present after add+notifySync.",
    });
    return null;
  }
  steps.push({
    name: "Happy-path: add (verify)",
    status: "pass",
    detail: "Item present in list.",
  });

  // Update
  const updated: PantryItem = { ...newItem, quantity: "5" };
  try {
    await client.savePantryItem(updated);
    await client.notifySync();
  } catch (error) {
    steps.push({
      name: "Happy-path: update",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const afterUpdate = await client.listPantry();
  const updatedItem = afterUpdate.find((i) => i.uid === uid);
  if (!updatedItem || updatedItem.quantity !== "5") {
    steps.push({
      name: "Happy-path: update (verify)",
      status: "fail",
      detail: `Quantity mismatch: expected "5", got "${updatedItem?.quantity ?? "<missing>"}".`,
    });
    return null;
  }
  steps.push({
    name: "Happy-path: update",
    status: "pass",
    detail: `quantity changed to "5".`,
  });

  // Delete
  const deletedItem: PantryItem = { ...updated, deleted: true };
  try {
    await client.savePantryItem(deletedItem);
    await client.notifySync();
  } catch (error) {
    steps.push({
      name: "Happy-path: delete",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  const afterDelete = await client.listPantry();
  if (afterDelete.some((i) => i.uid === uid)) {
    steps.push({
      name: "Happy-path: delete (verify)",
      status: "fail",
      detail: "Item still present after delete.",
    });
    return null;
  }
  steps.push({
    name: "Happy-path: delete",
    status: "pass",
    detail: "Item absent from list after delete.",
  });

  return deletedItem;
}

async function runFailureProbes(
  client: PaprikaClient,
  happyPathItem: PantryItem | null,
  steps: Array<StepResult>,
): Promise<void> {
  // Probe (a): UPDATE on a random unknown UID (NOT a delete) — observe whether Paprika
  // treats POSTs to unknown UIDs as upserts (creating the item) or rejects them.
  // We send a non-deleted item; if it's accepted, we immediately soft-delete it to clean up.
  const phantomUid = PantryItemUidSchema.parse(randomUUID());
  const phantomItem: PantryItem = {
    uid: phantomUid,
    ingredient: `${SMOKE_PREFIX} phantom-update-test`,
    quantity: "1",
    aisle: "",
    aisleUid: "",
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: todayWire(),
    locationUid: null,
    notes: null,
    deleted: false, // <-- update (live item), not delete
  };
  let probeAcceptedUnknownUid = false;
  try {
    await client.savePantryItem(phantomItem);
    probeAcceptedUnknownUid = true;
    steps.push({
      name: "Probe (a): update unknown UID",
      status: "pass",
      detail: `Server accepted POST for unknown UID ${phantomUid} (likely treated as upsert/create).`,
    });
  } catch (error) {
    steps.push({
      name: "Probe (a): update unknown UID",
      status: "pass", // empirical recording: either outcome is informative
      detail: `Server rejected POST for unknown UID: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  // Cleanup: if the upsert succeeded, soft-delete to avoid leaving smoke artifacts behind.
  if (probeAcceptedUnknownUid) {
    try {
      await client.savePantryItem({ ...phantomItem, deleted: true });
    } catch {
      // best-effort cleanup; ignore failures here
    }
  }
  try {
    await client.notifySync();
  } catch {
    // best-effort sync; ignore failures here
  }

  // Probe (b): RE-DELETE the just-deleted happy-path item (AC7.3.b literal: "second delete
  // of the just-deleted item"). Skip the probe if Section 2 didn't reach the delete step.
  if (happyPathItem === null) {
    steps.push({
      name: "Probe (b): re-delete just-deleted UID",
      status: "fail",
      detail: "Skipped — Section 2 (happy-path) did not produce a deleted item to re-target.",
    });
  } else {
    try {
      await client.savePantryItem(happyPathItem); // happyPathItem already has deleted: true
      await client.notifySync();
      steps.push({
        name: "Probe (b): re-delete just-deleted UID",
        status: "pass",
        detail: `Server accepted second delete on UID ${happyPathItem.uid}.`,
      });
    } catch (error) {
      steps.push({
        name: "Probe (b): re-delete just-deleted UID",
        status: "pass",
        detail: `Server response on re-delete: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Probe (c): add with empty ingredient
  const emptyIngredientItem: PantryItem = {
    uid: PantryItemUidSchema.parse(randomUUID()),
    ingredient: "",
    quantity: "1",
    aisle: "",
    aisleUid: "",
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: todayWire(),
    locationUid: null,
    notes: null,
    deleted: false,
  };
  try {
    await client.savePantryItem(emptyIngredientItem);
    // If this succeeds, immediately delete to avoid pollution
    await client.savePantryItem({ ...emptyIngredientItem, deleted: true });
    await client.notifySync();
    steps.push({
      name: "Probe (c): empty ingredient",
      status: "pass",
      detail: "Server accepted empty ingredient string (cleanup performed).",
    });
  } catch (error) {
    steps.push({
      name: "Probe (c): empty ingredient",
      status: "pass",
      detail: `Server rejected empty ingredient: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // Probe (d): explicit empty-aisle smoke contingency for issue #56.
  // The happy-path also uses empty aisle/aisleUid, but isolating this as a labeled probe
  // gives the operator a clear actionable signal on whether #56 is a hard prerequisite.
  const emptyAisleItem: PantryItem = {
    uid: PantryItemUidSchema.parse(randomUUID()),
    ingredient: `${SMOKE_PREFIX} empty-aisle-test`,
    quantity: "1",
    aisle: "", // explicit
    aisleUid: "", // explicit
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: todayWire(),
    locationUid: null,
    notes: null,
    deleted: false,
  };
  try {
    await client.savePantryItem(emptyAisleItem);
    // Cleanup
    await client.savePantryItem({ ...emptyAisleItem, deleted: true });
    await client.notifySync();
    steps.push({
      name: "Probe (d): empty-aisle add",
      status: "pass",
      detail: "Empty aisle accepted — issue #56 is NOT a blocking prerequisite.",
    });
  } catch (error) {
    steps.push({
      name: "Probe (d): empty-aisle add",
      status: "pass", // empirical recording
      detail:
        `Empty aisle REJECTED: ${error instanceof Error ? error.message : String(error)} ` +
        `— issue #56 (aisle support) is a HARD prerequisite; do not merge until #56 lands.`,
    });
  }

  logProgress("Failure probes complete.");
}

async function main(): Promise<void> {
  const config = loadConfig().match(
    (cfg) => cfg,
    (err) => {
      throw err;
    },
  );
  const client = new PaprikaClient(config.paprika.email, config.paprika.password);
  await client.authenticate();
  logProgress("Authenticated.");

  const steps: Array<StepResult> = [];

  // Section 1: cleanup
  await runCleanup(client, steps);

  // Section 2: happy-path round-trip — returns the deleted item so probes can re-target it
  const happyPathItem = await runHappyPath(client, steps);

  // Section 3: failure probes
  await runFailureProbes(client, happyPathItem, steps);

  emitReport(steps);

  // Exit code: 0 only if all "pass"; 1 if any "fail" (manual operator can still inspect the markdown)
  process.exit(steps.some((s) => s.status === "fail") ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(`Smoke runner failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
