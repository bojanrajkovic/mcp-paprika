/**
 * Disk-cache test construction helpers.
 *
 * `useTempDir` is a temp-dir lifecycle composable mirroring `useXdgIsolation`:
 * the caller wires `setup`/`teardown` into whichever hooks suit. The `make*`
 * factories build a single entity subcache under a cache dir — the exact call
 * each domain `.self` factory (and `buildAuthCaches`) makes in production — and
 * return it UN-inited, so multi-instance restart suites and pre-init-throw tests
 * control init timing themselves.
 *
 * @example
 *   const tmp = useTempDir("mcp-paprika-my-test-");
 *   beforeEach(async () => { await tmp.setup(); });
 *   afterEach(async () => { await tmp.teardown(); });
 *   // ...
 *   const cache = makeRecipeCache(tmp.dir());
 *   await cache.init();
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Logger } from "pino";

import type { DiskCacheDescriptor } from "../../src/cache/disk-cache.js";

import { OAuthClientDiskCache } from "../../src/auth/disk.js";
import { DiskCache } from "../../src/cache/disk-cache.js";
import { RecipeDiskCache } from "../../src/domains/recipe/disk.js";

export type TempDir = {
  /** Creates a fresh temp dir and returns its path. */
  readonly setup: () => Promise<string>;
  /** Removes the temp dir. */
  readonly teardown: () => Promise<void>;
  /** The current temp dir path (empty string before setup). */
  readonly dir: () => string;
};

export function useTempDir(prefix = "mcp-paprika-disk-"): TempDir {
  let dir = "";
  return {
    async setup(): Promise<string> {
      dir = await mkdtemp(join(tmpdir(), prefix));
      return dir;
    },
    async teardown(): Promise<void> {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    },
    dir(): string {
      return dir;
    },
  };
}

const logOpt = (log?: Logger): { log?: Logger } => (log !== undefined ? { log } : {});

/** Build one plain entity subcache under `cacheDir` from its descriptor (un-inited). */
export const makeCache = <T>(cacheDir: string, descriptor: DiskCacheDescriptor<T>, log?: Logger): DiskCache<T> =>
  new DiskCache<T>({ ...descriptor, subdir: join(cacheDir, descriptor.subdir), ...logOpt(log) });

/** Build the recipe subcache under `<cacheDir>/recipes` (un-inited). */
export const makeRecipeCache = (cacheDir: string, log?: Logger): RecipeDiskCache =>
  new RecipeDiskCache({ subdir: join(cacheDir, "recipes"), ...logOpt(log) });

/** Build the OAuth-client subcache under `<cacheDir>/oauthClients` (un-inited). */
export const makeOAuthClientCache = (cacheDir: string, log?: Logger): OAuthClientDiskCache =>
  new OAuthClientDiskCache({ subdir: join(cacheDir, "oauthClients"), ...logOpt(log) });
