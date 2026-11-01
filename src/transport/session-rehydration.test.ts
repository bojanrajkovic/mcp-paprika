import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { buildRehydration, type RequestOrigin, type Session } from "./session-rehydration.js";
import {
  buildSessionStore,
  LAST_SEEN_REFRESH_MS,
  MAX_PERSISTED_SESSIONS,
  type PersistedSession,
  SESSION_TTL_MS,
  type SessionDiskCache,
} from "./session-store.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

const NO_ORIGIN: RequestOrigin = { host: undefined, origin: undefined };

function record(overrides: Partial<PersistedSession> = {}): PersistedSession {
  const now = new Date().toISOString();
  return {
    sessionId: randomUUID(),
    protocolVersion: "2025-06-18",
    clientInfo: { name: "vitest-client", version: "1.2.3" },
    capabilities: { elicitation: { form: {} } },
    subject: "alice",
    createdAt: now,
    lastSeenAt: now,
    ...overrides,
  };
}

describe("buildRehydration", () => {
  let dir: string;
  let store: SessionDiskCache;
  let sessions: Map<string, Session>;
  let registerCalls: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-paprika-rehydration-"));
    store = (await buildSessionStore(dir))._unsafeUnwrap();
    sessions = new Map();
    registerCalls = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all([...sessions.values()].map((s) => s.server.close()));
    await rm(dir, { recursive: true, force: true });
  });

  function setup(opts: { readonly allowedHosts?: ReadonlyArray<string> } = {}) {
    return buildRehydration({
      kernel: {
        registerAll: () => {
          registerCalls++;
        },
      },
      store,
      sessions,
      endSession: (id) => {
        sessions.delete(id);
      },
      log: pino({ level: "silent" }),
      allowedHosts: opts.allowedHosts ?? [],
      allowedOrigins: [],
    });
  }

  async function seed(r: PersistedSession): Promise<void> {
    (await store.tryPut(r, MAX_PERSISTED_SESSIONS))._unsafeUnwrap();
    (await store.flush())._unsafeUnwrap();
  }

  it("rebuilds a persisted session under its own id with the client's capabilities and identity", async () => {
    const r = record();
    await seed(r);

    const session = await setup().adoptOrNull(r.sessionId, "alice", NO_ORIGIN);

    expect(session).not.toBeNull();
    expect(sessions.get(r.sessionId)).toBe(session);
    expect(session?.subject).toBe("alice");
    expect(session?.server.server.getClientCapabilities()).toMatchObject({ elicitation: { form: {} } });
    expect(session?.server.server.getClientVersion()).toMatchObject({ name: "vitest-client", version: "1.2.3" });
  });

  it("records operations for client traffic but not for its synthetic replay", async () => {
    const r = record();
    await seed(r);
    const count = async (method: string): Promise<number> => {
      const points = await telemetry.histogramPoints("mcp.server.operation.duration", { "mcp.method.name": method });
      return points.reduce((sum, point) => sum + point.value.count, 0);
    };

    const session = await setup().adoptOrNull(r.sessionId, "alice", NO_ORIGIN);

    expect(await count("initialize")).toBe(0);
    expect(await count("notifications/initialized")).toBe(0);

    const app = new Hono();
    app.all("/mcp", async (c) => (await session!.transport.handleRequest(c)) ?? c.body(null, 204));
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": r.sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    await response.text();

    expect(await count("ping")).toBe(1);
  });

  it("serves an already-live session without rebuilding it", async () => {
    const r = record();
    await seed(r);
    const rehydration = setup();
    const first = await rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN);

    expect(await rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN)).toBe(first);
    expect(registerCalls).toBe(1);
  });

  it("shares one rebuild between concurrent requests for the same id and subject", async () => {
    const r = record();
    await seed(r);
    const rehydration = setup();

    const [a, b] = await Promise.all([
      rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN),
      rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN),
    ]);

    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(registerCalls).toBe(1);
  });

  it("rejects another subject on both the rebuild and the live path, and keeps the owner's record", async () => {
    const r = record();
    await seed(r);
    const rehydration = setup();

    expect(await rehydration.adoptOrNull(r.sessionId, "mallory", NO_ORIGIN)).toBeNull();
    expect((await store.get(r.sessionId))._unsafeUnwrap()).not.toBeNull();

    expect(await rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN)).not.toBeNull();
    expect(await rehydration.adoptOrNull(r.sessionId, "mallory", NO_ORIGIN)).toBeNull();
  });

  it("rejects and prunes an expired record", async () => {
    const r = record({ lastSeenAt: new Date(Date.now() - SESSION_TTL_MS - 60_000).toISOString() });
    await seed(r);

    expect(await setup().adoptOrNull(r.sessionId, "alice", NO_ORIGIN)).toBeNull();
    expect((await store.get(r.sessionId))._unsafeUnwrap()).toBeNull();
  });

  it("treats a corrupt record as an unknown session", async () => {
    const id = randomUUID();
    await writeFile(join(dir, "sessions", `${id}.json`), "{ not json");

    expect(await setup().adoptOrNull(id, "alice", NO_ORIGIN)).toBeNull();
    expect(sessions.size).toBe(0);
  });

  it("rejects a non-UUID id without reading the disk", async () => {
    expect(await setup().adoptOrNull("../../etc/passwd", "alice", NO_ORIGIN)).toBeNull();
  });

  it("passes DNS rebinding protection by replaying the request's Host header", async () => {
    const r = record();
    await seed(r);
    const rehydration = setup({ allowedHosts: ["mcp.example.test"] });

    expect(await rehydration.adoptOrNull(r.sessionId, "alice", { host: "evil.test", origin: undefined })).toBeNull();
    expect(
      await rehydration.adoptOrNull(r.sessionId, "alice", { host: "mcp.example.test", origin: undefined }),
    ).not.toBeNull();
  });

  it("refreshes a live session's lastSeenAt at most once per refresh interval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-10-25T12:00:00.000Z");
    vi.setSystemTime(start);
    const r = record({ createdAt: new Date(start).toISOString(), lastSeenAt: new Date(start).toISOString() });
    await seed(r);
    const rehydration = setup();
    await rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN);
    const lastSeenAt = async () => (await store.get(r.sessionId))._unsafeUnwrap()?.lastSeenAt;

    // Within the interval: the refresh doesn't even read the record.
    const reads = vi.spyOn(store, "get");
    vi.setSystemTime(start + LAST_SEEN_REFRESH_MS - 1);
    await rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();

    // Past it: the record's clock moves to now.
    const later = start + 2 * LAST_SEEN_REFRESH_MS;
    vi.setSystemTime(later);
    await rehydration.adoptOrNull(r.sessionId, "alice", NO_ORIGIN);
    await vi.waitFor(async () => {
      expect(await lastSeenAt()).toBe(new Date(later).toISOString());
    });
  });

  it("at a cap full of live records, sweeps at most once per interval", async () => {
    for (let i = 0; i < MAX_PERSISTED_SESSIONS; i++) {
      (await store.tryPut(record(), MAX_PERSISTED_SESSIONS))._unsafeUnwrap();
    }
    (await store.flush())._unsafeUnwrap();
    const rehydration = setup();
    await rehydration.prune(); // as at boot
    const sweep = vi.spyOn(store, "pruneExpired");

    await rehydration.persist(record());
    await rehydration.persist(record());

    expect(sweep).not.toHaveBeenCalled();
  });

  it("persist sweeps expired records when the cap is reached, then writes", async () => {
    const stale = new Date(Date.now() - SESSION_TTL_MS - 60_000).toISOString();
    for (let i = 0; i < MAX_PERSISTED_SESSIONS; i++) {
      (await store.tryPut(record({ lastSeenAt: stale }), MAX_PERSISTED_SESSIONS))._unsafeUnwrap();
    }
    (await store.flush())._unsafeUnwrap();
    const fresh = record();

    await setup().persist(fresh);

    expect((await store.get(fresh.sessionId))._unsafeUnwrap()).toEqual(fresh);
  });
});
