import { open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTempDir } from "../../test/support/disk-caches.js";
import { writeFileAtomic } from "./disk-cache.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open), rename: vi.fn(actual.rename) };
});

const tmp = useTempDir("mcp-paprika-atomic-write-");
const previous = '{"value":"previous"}';
const replacement = '{"value":"replacement"}';

beforeEach(async () => {
  vi.mocked(open).mockClear();
  vi.mocked(rename).mockClear();
  await tmp.setup();
});
afterEach(async () => {
  await tmp.teardown();
});

describe("writeFileAtomic", () => {
  it("replaces a record using a private sibling without exposing incomplete contents", async () => {
    const path = join(tmp.dir(), "record.json");
    await writeFile(path, previous);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(rename).mockImplementationOnce(async (source, destination) => {
      expect(await readFile(path, "utf8")).toBe(previous);
      expect(await readFile(source, "utf8")).toBe(replacement);
      expect((await stat(source)).mode & 0o777).toBe(0o600);
      await actual.rename(source, destination);
    });

    (await writeFileAtomic(path, replacement))._unsafeUnwrap();

    expect(open).toHaveBeenCalledWith(expect.stringMatching(/record\.json\..+\.tmp$/), "wx", 0o600);
    expect(await readFile(path, "utf8")).toBe(replacement);
    expect(await readdir(tmp.dir())).toEqual(["record.json"]);
  });

  it.each(["writeFile", "sync", "close"] as const)("preserves the previous record when %s fails", async (method) => {
    const path = join(tmp.dir(), "record.json");
    await writeFile(path, previous);
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const failure = new Error(`injected ${method} failure`);
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      const originalClose = handle.close.bind(handle);
      vi.spyOn(handle, method).mockImplementationOnce(async () => {
        if (method === "writeFile") await actual.writeFile(handle, '{"value":');
        if (method === "close") await originalClose();
        throw failure;
      });
      return handle;
    });

    expect((await writeFileAtomic(path, replacement))._unsafeUnwrapErr().cause).toBe(failure);
    expect(await readFile(path, "utf8")).toBe(previous);
    expect(await readdir(tmp.dir())).toEqual(["record.json"]);
  });

  it("preserves the previous record and removes the temporary file when rename fails", async () => {
    const path = join(tmp.dir(), "record.json");
    await writeFile(path, previous);
    const failure = new Error("injected rename failure");
    vi.mocked(rename).mockRejectedValueOnce(failure);

    expect((await writeFileAtomic(path, replacement))._unsafeUnwrapErr().cause).toBe(failure);
    expect(await readFile(path, "utf8")).toBe(previous);
    expect(await readdir(tmp.dir())).toEqual(["record.json"]);
  });

  it("supports concurrent writers without sharing a temporary file", async () => {
    const path = join(tmp.dir(), "record.json");
    const values = Array.from({ length: 12 }, (_, value) => JSON.stringify({ value }));
    const results = await Promise.all(values.map((value) => writeFileAtomic(path, value)));
    for (const result of results) result._unsafeUnwrap();
    expect(values).toContain(await readFile(path, "utf8"));
    expect(await readdir(tmp.dir())).toEqual(["record.json"]);
  });
});
