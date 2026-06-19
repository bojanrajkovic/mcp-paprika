import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * A connected in-memory MCP client/server pair. `client` drives the real
 * protocol (`listTools`, `callTool`, `listResources`, …) against `server` over
 * the SDK's {@link InMemoryTransport}; `close()` tears both ends down.
 *
 * This is the cheap way to assert the **advertised** surface. `makeTestServer`
 * (tool-test-utils) stubs `registerTool` and discards the config, so it can
 * exercise a handler but is blind to what `tools/list` advertises; the
 * child-process `stdio.e2e.test.ts` sees the advertised surface but spawns a
 * process and runs a kernel sync to get there. This harness links a real
 * `McpServer` to a real `Client` in-process — no spawn, no wire, no sync — so a
 * test can register tools on a {@link buildBrandedServer} and read back exactly
 * what the SDK advertises (a tool's `title`/`description`/`inputSchema`/
 * `annotations`, and later its `outputSchema`/`_meta`).
 */
export interface InMemoryMcp {
  readonly client: Client;
  close(): Promise<void>;
}

/**
 * Link `server` to a fresh in-memory {@link Client} and connect both ends.
 * Accepts any assembled {@link McpServer} — a `buildBrandedServer()` with a few
 * tools registered for a focused surface test, or a full-kernel `registerAll`
 * server for an end-to-end one — then drive `result.client.listTools()` etc.
 */
export async function connectInMemoryMcp(server: McpServer): Promise<InMemoryMcp> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "in-memory-test-client", version: "0.0.0" });
  // Connect both ends before returning. The linked pair buffers messages sent
  // before the peer's transport has started, so the `initialize` handshake races
  // safely regardless of which side connects first.
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async close() {
      // Closing the client closes its transport, which closes the linked server
      // transport; close the server too so its handlers are torn down.
      await client.close();
      await server.close();
    },
  };
}
