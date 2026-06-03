import type { Logger } from "pino";

import type { OAuthClient } from "../auth/types.js";

import { OAuthClientSchema } from "../auth/types.js";
import { DiskCache } from "./disk-cache.js";

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
