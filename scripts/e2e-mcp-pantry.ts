// scripts/e2e-mcp-pantry.ts
//
// Phase 4/5 of the local test plan: drives the actual MCP server via stdio
// to verify the full pantry write path end-to-end (MCP transport + cache disk
// persistence + in-memory store sync). Distinct from smoke-pantry-write.ts
// which exercises only the PaprikaClient layer.
//
// Usage: npx tsx scripts/e2e-mcp-pantry.ts > /tmp/e2e-report.md
// stdout = markdown report; stderr = progress.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import envPaths from "env-paths";

const TEST_PREFIX = "[mcp-e2e]";

type StepResult = { name: string; status: "pass" | "fail"; detail: string };

function progress(s: string): void {
  process.stderr.write(`${s}\n`);
}

function emit(steps: ReadonlyArray<StepResult>): void {
  const lines: Array<string> = [];
  lines.push("## E2E MCP Pantry Test Report");
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Drives the actual MCP server (`tsx src/index.ts`) via stdio to verify the full");
  lines.push("pantry write path: MCP transport → tool handler → PaprikaClient → live API → cache");
  lines.push("disk persistence → in-memory store → MCP response.");
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

function getText(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (first?.type !== "text" || first.text === undefined) {
    return JSON.stringify(result);
  }
  return first.text;
}

function extractUid(markdown: string): string | null {
  // pantryItemToMarkdown emits "**UID:** `<uid>`" with the UID wrapped in backticks.
  const m = /\*\*UID:\*\*\s*`?([A-Fa-f0-9-]{36})`?/.exec(markdown);
  return m?.[1] ?? null;
}

// Match the server's xdg.ts: envPaths with suffix:"" (drops default "-nodejs").
const cacheDir = envPaths("mcp-paprika", { suffix: "" }).cache;
const pantryCacheDir = join(cacheDir, "pantry");
progress(`Cache dir: ${cacheDir}`);

const steps: Array<StepResult> = [];

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "/Users/brajkovic/Projects/mcp-paprika/src/index.ts"],
  stderr: "pipe",
});

// Forward server stderr to our stderr with a prefix
transport.stderr?.on("data", (chunk: Buffer) => {
  const text = chunk.toString().replace(/\n$/, "");
  for (const line of text.split("\n")) {
    if (line.length > 0) progress(`  [server] ${line}`);
  }
});

const client = new Client({ name: "e2e-mcp-pantry", version: "0.1.0" });
progress("Connecting to MCP server (initial sync may take 30-90s on cold cache)...");
await client.connect(transport);
progress("Connected.");

// Helper: call a tool, return the text content
async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return getText(result as { content: ReadonlyArray<{ type: string; text?: string }> });
}

let savedUid: string | null = null;

// Step 4.3: add_pantry_item
try {
  const ingredient = `${TEST_PREFIX} ${Date.now().toString()}`;
  const text = await callTool("add_pantry_item", { ingredient });
  savedUid = extractUid(text);
  if (savedUid === null) {
    steps.push({
      name: "4.3 add_pantry_item",
      status: "fail",
      detail: `Could not parse UID from response: ${text.slice(0, 200)}`,
    });
  } else if (!text.includes(ingredient)) {
    steps.push({
      name: "4.3 add_pantry_item",
      status: "fail",
      detail: `Response missing ingredient: ${text.slice(0, 200)}`,
    });
  } else if (!/\*\*In stock:\*\*\s*Yes/.test(text)) {
    steps.push({
      name: "4.3 add_pantry_item",
      status: "fail",
      detail: `Response missing default in-stock=Yes: ${text.slice(0, 200)}`,
    });
  } else {
    steps.push({
      name: "4.3 add_pantry_item",
      status: "pass",
      detail: `Saved ${savedUid} (${ingredient}); response includes name, UID, in-stock=Yes`,
    });
  }
} catch (error) {
  steps.push({
    name: "4.3 add_pantry_item",
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
  });
}

// Step 4.4: cache file written
if (savedUid !== null) {
  const cacheFile = join(pantryCacheDir, `${savedUid}.json`);
  if (existsSync(cacheFile)) {
    steps.push({
      name: "4.4 cache file written",
      status: "pass",
      detail: `pantry/${savedUid}.json present in ${cacheDir}`,
    });
  } else {
    const all = existsSync(pantryCacheDir) ? readdirSync(pantryCacheDir).slice(0, 5) : [];
    steps.push({
      name: "4.4 cache file written",
      status: "fail",
      detail: `Expected ${cacheFile} but not found. Other pantry files: ${all.join(", ") || "(none)"}`,
    });
  }
}

// Step 4.5: update_pantry_item with quantity
if (savedUid !== null) {
  try {
    const text = await callTool("update_pantry_item", { uid: savedUid, quantity: "2 cups" });
    if (/\*\*Quantity:\*\*\s*2 cups/.test(text)) {
      steps.push({
        name: "4.5 update_pantry_item quantity",
        status: "pass",
        detail: `Response shows Quantity: 2 cups`,
      });
    } else {
      steps.push({
        name: "4.5 update_pantry_item quantity",
        status: "fail",
        detail: `Response missing Quantity: 2 cups: ${text.slice(0, 200)}`,
      });
    }
  } catch (error) {
    steps.push({
      name: "4.5 update_pantry_item quantity",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// Step 5.1: get_pantry_item by UID returns the updated item (cross-tool: store reflects update)
if (savedUid !== null) {
  try {
    const text = await callTool("get_pantry_item", { lookup: { uid: savedUid } });
    if (/\*\*Quantity:\*\*\s*2 cups/.test(text)) {
      steps.push({
        name: "5.1 get_pantry_item reflects update",
        status: "pass",
        detail: `In-memory store shows Quantity: 2 cups (not just cache)`,
      });
    } else {
      steps.push({
        name: "5.1 get_pantry_item reflects update",
        status: "fail",
        detail: `get_pantry_item missing updated quantity: ${text.slice(0, 200)}`,
      });
    }
  } catch (error) {
    steps.push({
      name: "5.1 get_pantry_item reflects update",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// Step 5.2: list_pantry includes the item
if (savedUid !== null) {
  try {
    const text = await callTool("list_pantry", {});
    if (text.includes(savedUid) && text.includes("2 cups")) {
      steps.push({
        name: "5.2 list_pantry includes updated item",
        status: "pass",
        detail: `Item appears in list with updated quantity`,
      });
    } else {
      steps.push({
        name: "5.2 list_pantry includes updated item",
        status: "fail",
        detail: `Item missing or stale in list_pantry response (length ${text.length.toString()})`,
      });
    }
  } catch (error) {
    steps.push({
      name: "5.2 list_pantry includes updated item",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// Step 4.6: delete_pantry_item
if (savedUid !== null) {
  try {
    const text = await callTool("delete_pantry_item", { uid: savedUid });
    if (text.includes("has been deleted")) {
      steps.push({ name: "4.6 delete_pantry_item", status: "pass", detail: text.slice(0, 120) });
    } else {
      steps.push({
        name: "4.6 delete_pantry_item",
        status: "fail",
        detail: `Unexpected response: ${text.slice(0, 200)}`,
      });
    }
  } catch (error) {
    steps.push({
      name: "4.6 delete_pantry_item",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// Step 4.6 follow-up: cache file removed
if (savedUid !== null) {
  const cacheFile = join(pantryCacheDir, `${savedUid}.json`);
  if (!existsSync(cacheFile)) {
    steps.push({
      name: "4.6 cache file removed",
      status: "pass",
      detail: `pantry/${savedUid}.json absent after delete`,
    });
  } else {
    steps.push({
      name: "4.6 cache file removed",
      status: "fail",
      detail: `pantry/${savedUid}.json still present after delete`,
    });
  }
}

// Step 4.7: idempotent retry (THE Codex-discussed path)
if (savedUid !== null) {
  try {
    const text = await callTool("delete_pantry_item", { uid: savedUid });
    // Could be "already deleted" (tombstone) OR "No pantry item found" (sync wiped tombstone).
    // Both signal "not present, no action taken"; "already deleted" is the desired path.
    if (text.includes("already deleted")) {
      steps.push({
        name: "4.7 idempotent retry returns 'already deleted'",
        status: "pass",
        detail: `Tombstone-aware path active: "${text.slice(0, 120)}"`,
      });
    } else if (text.includes("No pantry item found")) {
      steps.push({
        name: "4.7 idempotent retry",
        status: "pass",
        detail: `Returned 'No pantry item found' (tombstone may have been cleared by an interleaved sync; still safe)`,
      });
    } else {
      steps.push({
        name: "4.7 idempotent retry",
        status: "fail",
        detail: `Unexpected response: ${text.slice(0, 200)}`,
      });
    }
  } catch (error) {
    steps.push({
      name: "4.7 idempotent retry",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// Step 4.8: list_pantry no longer contains the item
if (savedUid !== null) {
  try {
    const text = await callTool("list_pantry", {});
    if (!text.includes(savedUid)) {
      steps.push({
        name: "4.8 list_pantry no longer contains item",
        status: "pass",
        detail: `Deleted UID absent from list (length ${text.length.toString()})`,
      });
    } else {
      steps.push({
        name: "4.8 list_pantry no longer contains item",
        status: "fail",
        detail: `Deleted UID still in list: ${savedUid}`,
      });
    }
  } catch (error) {
    steps.push({
      name: "4.8 list_pantry no longer contains item",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

// Cleanup: close client
progress("Closing MCP client...");
await client.close();
progress("Closed.");

emit(steps);
process.exit(steps.some((s) => s.status === "fail") ? 1 : 0);
