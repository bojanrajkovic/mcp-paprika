import { join } from "node:path";

import type { Logger } from "pino";

import type { DiskCacheDescriptor } from "../cache/disk-cache.js";
import type { OAuthClient, OAuthToken } from "./types.js";

import { DiskCache } from "../cache/disk-cache.js";
import { OAuthClientSchema, OAuthTokenSchema } from "./types.js";

/**
 * The OAuth client cache, with an atomic registration cap on top of the generic
 * `DiskCache`. OAuth clients aren't a Paprika entity, so this subclass lives with the
 * auth module (its sole owner) rather than in `cache/` — the same co-location rule
 * that puts `RecipeDiskCache` in `domains/recipe/disk.ts`.
 */
export class OAuthClientDiskCache extends DiskCache<OAuthClient> {
  constructor(opts: { readonly subdir: string; readonly log?: Logger }) {
    super({
      subdir: opts.subdir,
      parse: (raw) => OAuthClientSchema.parse(raw),
      getKey: (c) => c.clientId,
      ...(opts.log !== undefined ? { log: opts.log } : {}),
    });
  }

  /**
   * Atomically counts the current OAuth-client population and puts `client`
   * only if it fits under `maxClients`. Both the count and the put happen
   * inside the same mutex acquisition, so concurrent callers can't both
   * observe count=49, both pass the check, and both write — the race window
   * that a separate count-then-put would leave open.
   *
   * Returns:
   * - `{ ok: true }` if the client was buffered (caller still owes a `flush()`).
   * - `{ ok: false, currentCount }` if the cap is already reached; nothing
   *   was written.
   *
   * Re-puts of an existing `clientId` skip the count check — they replace
   * an entry rather than adding one.
   */
  async tryPut(
    client: OAuthClient,
    maxClients: number,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly currentCount: number }> {
    return this._mutex.runExclusive(() => {
      this._assertInitialized("tryPut");
      const alreadyKnown = this._knownKeys.has(client.clientId);
      const currentCount = this._knownKeys.size;
      if (!alreadyKnown && currentCount >= maxClients) {
        return { ok: false, currentCount } as const;
      }
      this._putInner(client);
      return { ok: true } as const;
    });
  }
}

/**
 * `oauthTokens` has no Paprika-entity home — it's an auth-layer concern — so its
 * descriptor lives here in `auth/disk.ts` alongside the auth cache factory, rather
 * than in a domain's `<entity>/disk.ts`.
 */
export const oauthTokensDiskDescriptor: DiskCacheDescriptor<OAuthToken> = {
  subdir: "oauthTokens",
  parse: (raw) => OAuthTokenSchema.parse(raw),
  getKey: (t) => t.tokenHash,
};

/**
 * The narrow cache surface the OAuth layer needs — its two own subcaches plus a flush
 * over them; {@link buildAuthCaches} produces it. Auth touches nothing else on the
 * cache (every `_cache.*` access in `src/auth/` is `oauthClients` / `oauthTokens` /
 * `flush`), so the HTTP transport stands up ONLY these two — the Paprika entity caches
 * are owned solely by their kernel modules, with no second writer over `<cacheDir>/<entity>`.
 */
export interface AuthCache {
  readonly oauthClients: OAuthClientDiskCache;
  readonly oauthTokens: DiskCache<OAuthToken>;
  flush(): Promise<void>;
}

/**
 * Build and init just the OAuth client/token subcaches under `cacheDir` for the HTTP
 * transport's auth runtime. It creates no Paprika-entity subcaches — so the recipe
 * index (and every other entity's cache) is owned solely by the kernel modules, with
 * no second writer over `<cacheDir>/<entity>`.
 */
export async function buildAuthCaches(cacheDir: string, log?: Logger): Promise<AuthCache> {
  const logOpts = log !== undefined ? { log } : {};
  const oauthClients = new OAuthClientDiskCache({ subdir: join(cacheDir, "oauthClients"), ...logOpts });
  const oauthTokens = new DiskCache<OAuthToken>({
    subdir: join(cacheDir, oauthTokensDiskDescriptor.subdir),
    parse: oauthTokensDiskDescriptor.parse,
    getKey: oauthTokensDiskDescriptor.getKey,
    ...logOpts,
  });
  await Promise.all([oauthClients.init(), oauthTokens.init()]);
  return {
    oauthClients,
    oauthTokens,
    async flush(): Promise<void> {
      await Promise.all([oauthClients.flush(), oauthTokens.flush()]);
    },
  };
}
