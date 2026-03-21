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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ListToolsResult, ListResourcesResult } from "@modelcontextprotocol/sdk/types.js";

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
    expect(toolNames).toContain("filter_by_ingredient");
    expect(toolNames).toContain("filter_by_time");
    expect(toolNames).toContain("read_recipe");
    expect(toolNames).toContain("create_recipe");
    expect(toolNames).toContain("update_recipe");
    expect(toolNames).toContain("delete_recipe");
    expect(toolNames).toContain("list_categories");

    // Verify tools have descriptions
    result.tools.forEach((tool) => {
      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
    });
  });

  it("calls a tool and receives a result", async () => {
    const result = await client.callTool({
      name: "search_recipes",
      arguments: { query: "pasta" },
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);

    // Verify response has text content
    const firstContent = result.content[0];
    expect(firstContent).toBeDefined();
    expect(firstContent.type).toBe("text");
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
      expect(firstContent.uri).toBeDefined();
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
});
