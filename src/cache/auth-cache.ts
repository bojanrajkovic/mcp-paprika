import { join } from "node:path";

import type { Logger } from "pino";

import type { OAuthToken } from "../auth/types.js";
import type { DiskCacheDescriptor } from "./disk-cache.js";

import { OAuthTokenSchema } from "../auth/types.js";
import { DiskCache } from "./disk-cache.js";
import { OAuthClientDiskCache } from "./oauth-client-disk-cache.js";

/**
 * `oauthTokens` has no Paprika-entity home — it's an auth-layer concern — so its
 * descriptor lives here, alongside the auth-cache factory, rather than in a
 * `<entity>/disk.ts`. {@link DiskCacheRoot} imports it from here for its own
 * `oauthTokens` subcache so the two constructions stay identical.
 */
export const oauthTokensDiskDescriptor: DiskCacheDescriptor<OAuthToken> = {
  subdir: "oauthTokens",
  parse: (raw) => OAuthTokenSchema.parse(raw),
  getKey: (t) => t.tokenHash,
};

/**
 * The narrow cache surface the OAuth layer needs — its two own subcaches plus a
 * flush over them. Both the full {@link DiskCacheRoot} (the legacy composition root,
 * still used by the test harness) and {@link buildAuthCaches} (the kernel's HTTP
 * bootstrap) satisfy it. Auth touches nothing else on the cache — every `_cache.*`
 * access in `src/auth/` is `oauthClients` / `oauthTokens` / `flush` — so the HTTP
 * transport builds ONLY these two, not a 14-subcache root whose duplicate
 * `RecipeDiskCache` the `AuthCleanup` flush loop would clobber.
 */
export interface AuthCache {
  readonly oauthClients: OAuthClientDiskCache;
  readonly oauthTokens: DiskCache<OAuthToken>;
  flush(): Promise<void>;
}

/**
 * Build and init just the OAuth client/token subcaches under `cacheDir` for the HTTP
 * transport's auth runtime. Unlike a full `DiskCacheRoot`, it creates no entity
 * subcaches — so the recipe index (and every other entity's cache) is owned solely by
 * the kernel modules, with no second writer over `<cacheDir>/<entity>`.
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
