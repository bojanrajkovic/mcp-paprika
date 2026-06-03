/**
 * End-to-end MCP round-trip integration test.
 *
 * This test:
 * 1. Spawns the server as a child process via StdioClientTransport
 * 2. Connects as an MCP client
 * 3. Exercises the MCP protocol: lists tools, calls a tool, lists resources
 * 4. Gracefully shuts down
 *
 * To run: pnpm test src/e2e.test.integration.ts
 *
 * Note: The test uses environment variables to configure credentials and disables
 * the embedding feature to avoid external dependencies.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ListResourcesResult, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("MCP Server end-to-end round-trip", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let tempDir: string;

  beforeAll(async () => {
    // Create temp directory for cache
    tempDir = await mkdtemp(join(tmpdir(), "paprika-e2e-"));

    // Spawn server as child process using test entry point
    transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/e2e-server.ts"],
      env: {
        ...process.env,
        PAPRIKA_EMAIL: "test@example.com",
        PAPRIKA_PASSWORD: "testpass",
        // Disable embedding feature to avoid Ollama dependency
        PAPRIKA_EMBEDDINGS_API_KEY: "",
      },
    });

    // Create client and connect
    client = new Client({
      name: "test-client",
      version: "1.0.0",
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    // Disconnect client
    await client.close();

    // Clean up temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lists all registered tools", async () => {
    const result = (await client.listTools()) as ListToolsResult;

    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);

    // Verify all expected tools are registered
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("search_recipes");
    expect(toolNames).toContain("read_recipe");
    expect(toolNames).toContain("create_recipe");
    expect(toolNames).toContain("update_recipe");
    expect(toolNames).toContain("trash_recipe");
    expect(toolNames).toContain("list_categories");
    expect(toolNames).toContain("list_pantry_items");
    expect(toolNames).toContain("read_pantry_item");
    // Intent verbs promoted off the generic update_* tools (command-language refactor).
    expect(toolNames).toContain("restore_recipe");
    expect(toolNames).toContain("rate_recipe");
    expect(toolNames).toContain("favorite_recipe");
    expect(toolNames).toContain("unfavorite_recipe");
    expect(toolNames).toContain("categorize_recipe");
    expect(toolNames).toContain("mark_grocery_item_purchased");
    expect(toolNames).toContain("mark_pantry_item_out_of_stock");
    expect(toolNames).toContain("restock_pantry_item");
    expect(toolNames).toContain("move_menu_item");
    expect(toolNames).toContain("reschedule_meal");
    // New behavioral reads + log; list_meal_history split into the forward plan + recall views.
    expect(toolNames).toContain("read_meal_plan");
    expect(toolNames).toContain("search_meal_history");
    expect(toolNames).toContain("log_cooked_meal");
    expect(toolNames).not.toContain("list_meal_history");
    expect(toolNames).not.toContain("filter_by_ingredient");

    // Verify tools have descriptions
    result.tools.forEach((tool) => {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
    });

    // Every tool must publish a non-empty parameter schema. Regression guard for the
    // ZodEffects bug: a `.refine()`/`.superRefine()` inputSchema serializes to zero
    // properties, so the model would see the tool as taking no arguments. search_recipes
    // (which takes query/ingredients/match/maxPrep/maxCook/maxTotal/limit) is the canary.
    const search = result.tools.find((t) => t.name === "search_recipes");
    expect(search).toBeDefined();
    const searchSchema = search!.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(searchSchema.properties ?? {})).toContain("query");
  });

  it("rejects a promoted field on update_recipe with a loud SDK input-validation error", async () => {
    // ADR-0008 D1: rating left update_recipe for rate_recipe, and the update_recipe
    // schema is .strict(), so a stray `rating` key is a hard SDK rejection (isError)
    // rather than a silently dropped key — the model can't set the field this way.
    const result = await client.callTool({
      name: "update_recipe",
      arguments: { uid: "any-uid", rating: 5 },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join(" ");
    expect(text).toContain("rating");
  });

  it("calls a tool and receives a result", async () => {
    const result = await client.callTool({
      name: "search_recipes",
      arguments: { query: "pasta" },
    });

    expect(result).toBeDefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);

    // Verify response has text content
    const firstContent = content[0];
    expect(firstContent).toBeDefined();
    expect(firstContent?.type).toBe("text");
    expect(typeof (firstContent as { type: string; text: string }).text).toBe("string");
  });

  it("lists all registered resources", async () => {
    const result = (await client.listResources()) as ListResourcesResult;

    expect(result.resources).toBeDefined();
    expect(Array.isArray(result.resources)).toBe(true);

    // Verify recipe resource is registered
    const recipeResource = result.resources.find((r) => r.uri.startsWith("paprika://recipe/"));
    expect(recipeResource).toBeDefined();
    expect(recipeResource?.name).toBeDefined();

    // Verify pantry resource is NOT registered — pantry items are Data-class, tools-only
    const pantryResource = result.resources.find((r) => r.uri.startsWith("paprika://pantry/"));
    expect(pantryResource).toBeUndefined();
  });

  it("lists resources and reads a valid recipe", async () => {
    // First list resources to get a valid recipe UID
    const listResult = (await client.listResources()) as ListResourcesResult;
    expect(listResult.resources).toBeDefined();
    expect(listResult.resources.length).toBeGreaterThan(0);

    // Extract a recipe UID from the resources
    const recipeResource = listResult.resources.find((r) => r.uri.includes("paprika://recipe/"));
    expect(recipeResource).toBeDefined();
    expect(recipeResource?.uri).toBeDefined();

    // Now read that specific resource
    if (recipeResource?.uri) {
      const result = await client.readResource({
        uri: recipeResource.uri,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.contents.length).toBeGreaterThan(0);

      // Verify content is a resource type
      const firstContent = result.contents[0];
      expect(firstContent).toBeDefined();
      expect(firstContent?.uri).toBeDefined();
    }
  });

  it("handles tool errors gracefully", async () => {
    const result = await client.callTool({
      name: "search_recipes",
      arguments: { query: "" },
    });

    // Tool should return an error response (either marked with isError or containing error text)
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("calls pantry tools and receives results", async () => {
    // Test list_pantry_items tool
    const listResult = await client.callTool({
      name: "list_pantry_items",
      arguments: {},
    });

    expect(listResult).toBeDefined();
    const listContent = listResult.content as Array<{ type: string; text: string }>;
    expect(Array.isArray(listContent)).toBe(true);
    expect(listContent.length).toBeGreaterThan(0);

    // Verify response has text content with pantry info
    const firstContent = listContent[0];
    expect(firstContent).toBeDefined();
    expect(firstContent?.type).toBe("text");
    const listText = firstContent?.text ?? "";
    expect(typeof listText).toBe("string");
    expect(listText.toLowerCase()).toContain("pantry"); // Should mention pantry

    // Test read_pantry_item by ingredient
    const getResult = await client.callTool({
      name: "read_pantry_item",
      arguments: { ingredient: "Flour" },
    });

    expect(getResult).toBeDefined();
    const getContent = getResult.content as Array<{ type: string; text: string }>;
    expect(Array.isArray(getContent)).toBe(true);
    expect(getContent.length).toBeGreaterThan(0);

    const getFirstContent = getContent[0];
    expect(getFirstContent).toBeDefined();
    expect(getFirstContent?.type).toBe("text");
  });
});
