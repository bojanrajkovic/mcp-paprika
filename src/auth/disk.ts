import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError, DiskCacheDescriptor } from "../cache/disk-cache.js";
import type { OAuthClient, OAuthToken } from "./types.js";

import { DiskCache } from "../cache/disk-cache.js";
import { OAuthClientSchema, OAuthTokenSchema } from "./types.js";

/**
 * The OAuth client cache. Registration is capped through the generic
 * `DiskCache.tryPut`. OAuth clients aren't a Paprika entity, so this subclass lives with the
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
  flush(): ResultAsync<void, CacheError>;
}

/**
 * Build and init just the OAuth client/token subcaches under `cacheDir` for the HTTP
 * transport's auth runtime. It creates no Paprika-entity subcaches — so the recipe
 * index (and every other entity's cache) is owned solely by the kernel modules, with
 * no second writer over `<cacheDir>/<entity>`.
 */
export function buildAuthCaches(cacheDir: string, log?: Logger): ResultAsync<AuthCache, CacheError> {
  const logOpts = log !== undefined ? { log } : {};
  const oauthClients = new OAuthClientDiskCache({ subdir: join(cacheDir, "oauthClients"), ...logOpts });
  const oauthTokens = new DiskCache<OAuthToken>({
    subdir: join(cacheDir, oauthTokensDiskDescriptor.subdir),
    parse: oauthTokensDiskDescriptor.parse,
    getKey: oauthTokensDiskDescriptor.getKey,
    ...logOpts,
  });
  return ResultAsync.combine([oauthClients.init(), oauthTokens.init()]).map(() => ({
    oauthClients,
    oauthTokens,
    flush: (): ResultAsync<void, CacheError> =>
      ResultAsync.combine([oauthClients.flush(), oauthTokens.flush()]).map(() => undefined),
  }));
}
