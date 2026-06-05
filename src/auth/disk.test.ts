import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeOAuthClient, makeOAuthToken } from "../../test/cache/__fixtures__/oauth.js";
import { makeCache, makeOAuthClientCache, useTempDir } from "../../test/support/disk-caches.js";
import { buildAuthCaches, oauthTokensDiskDescriptor } from "./disk.js";

const tmp = useTempDir("mcp-paprika-auth-disk-");
beforeEach(async () => {
  await tmp.setup();
});
afterEach(async () => {
  await tmp.teardown();
});

describe("OAuthClientDiskCache", () => {
  it("put + flush round-trips across instances", async () => {
    const cache = makeOAuthClientCache(tmp.dir());
    await cache.init();
    const clientId = randomUUID();
    const client = makeOAuthClient({ clientId });
    await cache.put(client);
    expect(await cache.get(clientId)).toEqual(client);
    await cache.flush();

    const cache2 = makeOAuthClientCache(tmp.dir());
    await cache2.init();
    expect(await cache2.get(clientId)).toEqual(client);
  });

  it("on-disk JSON contains the registrationAccessTokenHash and no plaintext fields", async () => {
    const cache = makeOAuthClientCache(tmp.dir());
    await cache.init();
    const clientId = randomUUID();
    await cache.put(makeOAuthClient({ clientId, registrationAccessTokenHash: "a".repeat(64) }));
    await cache.flush();

    const raw = await readFile(join(tmp.dir(), "oauthClients", `${clientId}.json`), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["registrationAccessTokenHash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed).not.toHaveProperty("client_secret");
    expect(parsed).not.toHaveProperty("clientSecret");
    expect(parsed).not.toHaveProperty("registrationAccessToken");
  });

  describe("tryPut cap", () => {
    it("accepts the put while under the cap", async () => {
      const cache = makeOAuthClientCache(tmp.dir());
      await cache.init();
      const result = await cache.tryPut(makeOAuthClient(), 5);
      expect(result.ok).toBe(true);
    });

    it("rejects new clients once the cap is reached but allows re-puts", async () => {
      const cache = makeOAuthClientCache(tmp.dir());
      await cache.init();

      const first = makeOAuthClient();
      const second = makeOAuthClient();
      await cache.tryPut(first, 1);
      const rejected = await cache.tryPut(second, 1);
      expect(rejected).toEqual({ ok: false, currentCount: 1 });

      // Re-puts of an existing clientId skip the count check.
      const updated = await cache.tryPut({ ...first, clientName: "Updated" }, 1);
      expect(updated.ok).toBe(true);
    });
  });
});

describe("oauthTokens cache (descriptor through the generic DiskCache)", () => {
  it("put + flush + get round-trips; filename equals tokenHash", async () => {
    const cache = makeCache(tmp.dir(), oauthTokensDiskDescriptor);
    await cache.init();
    const token = makeOAuthToken();
    await cache.put(token);
    await cache.flush();

    expect(await cache.get(token.tokenHash)).toEqual(token);
    const entries = await readdir(join(tmp.dir(), "oauthTokens"));
    expect(entries).toContain(`${token.tokenHash}.json`);
  });

  it("remove deletes the file and is idempotent", async () => {
    const cache = makeCache(tmp.dir(), oauthTokensDiskDescriptor);
    await cache.init();
    const token = makeOAuthToken();
    await cache.put(token);
    await cache.flush();

    await cache.remove(token.tokenHash);
    expect(await cache.getAll()).toHaveLength(0);
    await expect(cache.remove("never-existed")).resolves.toBeUndefined();
  });
});

describe("buildAuthCaches", () => {
  it("creates the oauthClients + oauthTokens subdirs and flushes both", async () => {
    const cache = await buildAuthCaches(tmp.dir());
    expect((await stat(join(tmp.dir(), "oauthClients"))).isDirectory()).toBe(true);
    expect((await stat(join(tmp.dir(), "oauthTokens"))).isDirectory()).toBe(true);

    await cache.oauthClients.put(makeOAuthClient());
    await cache.oauthTokens.put(makeOAuthToken());
    await expect(cache.flush()).resolves.toBeUndefined();
  });
});
