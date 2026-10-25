import { join } from "node:path";

import { okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";

import type { CacheError } from "../cache/disk-cache.js";

import { subjectMatches } from "../auth/subject.js";
import { DiskCache } from "../cache/disk-cache.js";
import { isNodeError } from "../utils/errors.js";

/**
 * What it takes to rebuild an HTTP session after a restart: the negotiated protocol
 * version and the client's declared identity and capabilities (replayed through a
 * synthetic `initialize`, see `session-rehydration.ts`), the OAuth subject that owns
 * the session (absent under `MCP_DEV_AUTH_BYPASS`), and the two timestamps behind the
 * TTL. `clientInfo` needs both fields because the replayed initialize does.
 */
export const PersistedSessionSchema = z.object({
  sessionId: z.uuid(),
  protocolVersion: z.string(),
  clientInfo: z.object({ name: z.string(), version: z.string() }),
  capabilities: z.record(z.string(), z.unknown()),
  subject: z.string().optional(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

export type PersistedSession = z.infer<typeof PersistedSessionSchema>;

/** A session unused for longer than this (measured from `lastSeenAt`) is expired. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How often a session in use refreshes its record's `lastSeenAt`. Far below the TTL,
 * so a session used at least this often never expires, and far above request rates,
 * so use doesn't mean a disk write per request.
 */
export const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

/**
 * Caps the persisted population so a churning client can't grow the volume without
 * bound. Every reconnect mints a new id, so one client legitimately leaves many
 * records behind within a TTL.
 */
export const MAX_PERSISTED_SESSIONS = 500;

/**
 * Whether `id` could be a session id this store holds. Run it BEFORE handing an
 * incoming `mcp-session-id` to `get`/`remove`: the header is client input, and
 * `DiskCache` builds a file path from the key with no traversal guard of its own.
 */
export function isValidSessionId(id: string): boolean {
  return PersistedSessionSchema.shape.sessionId.safeParse(id).success;
}

/** Whether `record` has gone unused for longer than {@link SESSION_TTL_MS}. */
export function isExpiredSession(record: PersistedSession, now: number): boolean {
  return now - Date.parse(record.lastSeenAt) > SESSION_TTL_MS;
}

/** Whether a requested session id that isn't live may be rebuilt from its persisted record. */
export type AdoptDecision =
  | { readonly kind: "adopt"; readonly record: PersistedSession }
  | { readonly kind: "reject"; readonly reason: "not_found" | "expired" | "subject_mismatch" };

/**
 * Decide whether to rebuild a session from `record` for a request authenticated as
 * `subject`. An expired record is rejected whoever asks (the caller prunes it); a
 * subject mismatch is rejected without touching the record, so a stranger presenting
 * someone's id can't evict their session.
 */
export function decideAdopt(record: PersistedSession | null, subject: string | undefined, now: number): AdoptDecision {
  if (record === null) return { kind: "reject", reason: "not_found" };
  if (isExpiredSession(record, now)) return { kind: "reject", reason: "expired" };
  if (!subjectMatches(subject, record.subject)) return { kind: "reject", reason: "subject_mismatch" };
  return { kind: "adopt", record };
}

/**
 * Persisted session metadata, keyed by session id, under `<cacheDir>/sessions/`. Not
 * a Paprika entity and not an OAuth concern, so it lives with its only owner, the
 * HTTP transport.
 */
export class SessionDiskCache extends DiskCache<PersistedSession> {
  constructor(opts: { readonly subdir: string; readonly log?: Logger }) {
    super({
      subdir: opts.subdir,
      parse: (raw) => PersistedSessionSchema.parse(raw),
      getKey: (s) => s.sessionId,
      ...(opts.log !== undefined ? { log: opts.log } : {}),
    });
  }

  /**
   * Delete every expired or unparseable record and return how many went. A client
   * never comes back for an abandoned id, so without this sweep dead records would
   * fill the cap and stop new sessions from persisting. Records are read one at a
   * time, and a read that fails on I/O (EMFILE, EIO) keeps its record: only a file
   * that read fine but didn't parse is garbage.
   */
  pruneExpired(now: number): ResultAsync<number, CacheError> {
    const isStale = (key: string): ResultAsync<boolean, never> =>
      this.get(key)
        .map((record) => record !== null && isExpiredSession(record, now))
        .orElse((e) => okAsync(!isNodeError(e.cause)));
    return [...this._knownKeys].reduce<ResultAsync<number, CacheError>>(
      (count, key) =>
        count.andThen((n) => isStale(key).andThen((stale) => (stale ? this.remove(key).map(() => n + 1) : okAsync(n)))),
      okAsync(0),
    );
  }
}

/** Build and init the session store under `<cacheDir>/sessions`. */
export function buildSessionStore(cacheDir: string, log?: Logger): ResultAsync<SessionDiskCache, CacheError> {
  const store = new SessionDiskCache({ subdir: join(cacheDir, "sessions"), ...(log !== undefined ? { log } : {}) });
  return store.init().map(() => store);
}
