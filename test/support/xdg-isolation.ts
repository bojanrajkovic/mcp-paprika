/**
 * F9: XDG base-directory isolation composable for tests.
 *
 * Many tests rely on `DiskCache` which reads `XDG_CACHE_HOME` / `XDG_CONFIG_HOME`
 * at runtime to locate the on-disk store. Without isolation, parallel or
 * sequential test runs can collide on the real user cache directory.
 *
 * `useXdgIsolation` creates a fresh `mkdtemp` directory per invocation, redirects
 * both XDG env vars into it, and restores them on teardown. The caller wires
 * `setup` / `teardown` into whichever lifecycle hooks suit their test structure
 * (`beforeEach`/`afterEach`, `beforeAll`/`afterAll`, or custom).
 *
 * @example
 *   const xdg = useXdgIsolation("mcp-paprika-my-test");
 *   beforeEach(async () => { await xdg.setup(); });
 *   afterEach(async () => { await xdg.teardown(); });
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type XdgIsolation = {
  /** Creates a temp dir and points XDG_CACHE_HOME + XDG_CONFIG_HOME at it. Returns the temp dir path. */
  readonly setup: () => Promise<string>;
  /** Restores the original XDG vars and removes the temp dir. */
  readonly teardown: () => Promise<void>;
  /** Returns the current temp dir path (empty string if setup hasn't been called). */
  readonly dir: () => string;
};

/**
 * Creates a paired `setup` / `teardown` that isolates `XDG_CACHE_HOME` and
 * `XDG_CONFIG_HOME` inside a fresh temporary directory.
 *
 * @param prefix - Directory name prefix passed to `mkdtemp`; defaults to "mcp-paprika-test"
 */
export function useXdgIsolation(prefix = "mcp-paprika-test"): XdgIsolation {
  let tempDir = "";
  let savedCache: string | undefined;
  let savedConfig: string | undefined;

  return {
    async setup(): Promise<string> {
      tempDir = await mkdtemp(join(tmpdir(), `${prefix}-`));
      savedCache = process.env["XDG_CACHE_HOME"];
      savedConfig = process.env["XDG_CONFIG_HOME"];
      process.env["XDG_CACHE_HOME"] = tempDir;
      process.env["XDG_CONFIG_HOME"] = tempDir;
      return tempDir;
    },

    async teardown(): Promise<void> {
      if (savedCache === undefined) delete process.env["XDG_CACHE_HOME"];
      else process.env["XDG_CACHE_HOME"] = savedCache;
      if (savedConfig === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = savedConfig;
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    },

    dir(): string {
      return tempDir;
    },
  };
}
