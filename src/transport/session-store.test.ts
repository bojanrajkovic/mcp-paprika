import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSessionStore,
  decideAdopt,
  isValidSessionId,
  type PersistedSession,
  PersistedSessionSchema,
  SESSION_TTL_MS,
  type SessionDiskCache,
} from "./session-store.js";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");

function record(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    sessionId: randomUUID(),
    protocolVersion: "2025-06-18",
    clientInfo: { name: "vitest", version: "0" },
    capabilities: {},
    subject: "alice",
    createdAt: new Date(NOW).toISOString(),
    lastSeenAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("isValidSessionId", () => {
  it("accepts a UUID", () => {
    expect(isValidSessionId(randomUUID())).toBe(true);
  });

  it.each(["", "../../etc/passwd", "not-a-uuid", `${randomUUID()}/../x`])("rejects %j", (id) => {
    expect(isValidSessionId(id)).toBe(false);
  });
});

describe("PersistedSessionSchema", () => {
  it("requires both clientInfo fields, since the replayed initialize does", () => {
    expect(PersistedSessionSchema.safeParse({ ...record(), clientInfo: { name: "x" } }).success).toBe(false);
  });
});

describe("decideAdopt", () => {
  it("adopts a fresh record owned by the requesting subject", () => {
    const r = record();
    expect(decideAdopt(r, "alice", NOW)).toEqual({ kind: "adopt", record: r });
  });

  it("rejects a missing record as not_found", () => {
    expect(decideAdopt(null, "alice", NOW)).toEqual({ kind: "reject", reason: "not_found" });
  });

  it("adopts a record exactly at the TTL and rejects one past it as expired", () => {
    const lastSeenAt = new Date(NOW - SESSION_TTL_MS).toISOString();
    expect(decideAdopt(record({ lastSeenAt }), "alice", NOW).kind).toBe("adopt");
    expect(decideAdopt(record({ lastSeenAt }), "alice", NOW + 1)).toEqual({ kind: "reject", reason: "expired" });
  });

  it("rejects an expired record before checking the subject", () => {
    const lastSeenAt = new Date(NOW - SESSION_TTL_MS - 1).toISOString();
    expect(decideAdopt(record({ lastSeenAt }), "mallory", NOW)).toEqual({ kind: "reject", reason: "expired" });
  });

  it("rejects a different or missing subject as subject_mismatch", () => {
    expect(decideAdopt(record(), "mallory", NOW)).toEqual({ kind: "reject", reason: "subject_mismatch" });
    expect(decideAdopt(record(), undefined, NOW)).toEqual({ kind: "reject", reason: "subject_mismatch" });
  });

  it("adopts a subjectless (dev-auth bypass) record only for a subjectless request", () => {
    const { subject: _, ...bypass } = record();
    expect(decideAdopt(bypass, undefined, NOW).kind).toBe("adopt");
    expect(decideAdopt(bypass, "alice", NOW)).toEqual({ kind: "reject", reason: "subject_mismatch" });
  });
});

describe("SessionDiskCache", () => {
  let dir: string;
  let store: SessionDiskCache;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mcp-paprika-sessions-"));
    store = (await buildSessionStore(dir))._unsafeUnwrap();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("tryPut rejects a new id at the cap but replaces a known one", async () => {
    const first = record();
    expect((await store.tryPut(first, 1))._unsafeUnwrap()).toEqual({ ok: true });
    expect((await store.tryPut(record(), 1))._unsafeUnwrap()).toEqual({ ok: false, currentCount: 1 });
    expect((await store.tryPut({ ...first, lastSeenAt: new Date(NOW + 1).toISOString() }, 1))._unsafeUnwrap()).toEqual({
      ok: true,
    });
  });

  it("pruneExpired removes expired and unreadable records and keeps fresh ones", async () => {
    const fresh = record();
    const stale = record({ lastSeenAt: new Date(NOW - SESSION_TTL_MS - 1).toISOString() });
    (await store.tryPut(fresh, 10))._unsafeUnwrap();
    (await store.tryPut(stale, 10))._unsafeUnwrap();
    (await store.flush())._unsafeUnwrap();
    const corruptId = randomUUID();
    await writeFile(join(dir, "sessions", `${corruptId}.json`), "{ not json");

    // A second instance sees the corrupt file at init, as a restarted process would.
    const reopened = (await buildSessionStore(dir))._unsafeUnwrap();
    expect((await reopened.pruneExpired(NOW))._unsafeUnwrap()).toBe(2);

    expect((await reopened.get(fresh.sessionId))._unsafeUnwrap()).toEqual(fresh);
    expect((await reopened.get(stale.sessionId))._unsafeUnwrap()).toBeNull();
    expect((await reopened.get(corruptId))._unsafeUnwrap()).toBeNull();
  });
});
