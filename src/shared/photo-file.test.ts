import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES } from "./photo-fetch.js";
import { photoFileRoots, readLocalImage } from "./photo-file.js";

let dir: string;
let root: string;
let outside: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "photo-file-"));
  root = join(dir, "workspace");
  outside = join(dir, "secret");
  mkdirSync(join(root, "inbox"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, "inbox", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  writeFileSync(join(outside, "b.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  symlinkSync(join(outside, "b.jpg"), join(root, "link.jpg"));
  writeFileSync(join(root, "empty.jpg"), "");
  writeFileSync(join(root, "big.jpg"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("photoFileRoots", () => {
  it("splits the env var and drops blanks; unset means none", () => {
    expect(photoFileRoots({ PAPRIKA_PHOTO_FILE_ROOTS: "/a: /b ::" })).toEqual(["/a", "/b"]);
    expect(photoFileRoots({})).toEqual([]);
  });
});

describe("readLocalImage", () => {
  it("reads a file under an allowed root", async () => {
    const r = await readLocalImage(join(root, "inbox", "a.jpg"), [root]);
    expect("bytes" in r && r.bytes.length).toBe(7);
  });

  it("is disabled when no roots are configured", async () => {
    const r = await readLocalImage(join(root, "inbox", "a.jpg"), []);
    expect("error" in r && r.error).toContain("disabled");
  });

  it("rejects relative paths, missing files, and paths outside the roots", async () => {
    expect(await readLocalImage("inbox/a.jpg", [root])).toHaveProperty("error");
    expect(await readLocalImage(join(root, "nope.jpg"), [root])).toHaveProperty("error");
    const r = await readLocalImage(join(outside, "b.jpg"), [root]);
    expect("error" in r && r.error).toContain("outside");
  });

  it("rejects ../ escapes and symlinks that resolve outside the roots", async () => {
    expect(await readLocalImage(join(root, "..", "secret", "b.jpg"), [root])).toHaveProperty("error");
    const r = await readLocalImage(join(root, "link.jpg"), [root]);
    expect("error" in r && r.error).toContain("outside");
  });

  it("does not treat a sibling with a shared prefix as inside the root", async () => {
    mkdirSync(`${root}-evil`, { recursive: true });
    writeFileSync(`${root}-evil/c.jpg`, Buffer.from([0xff, 0xd8, 0xff]));
    expect(await readLocalImage(`${root}-evil/c.jpg`, [root])).toHaveProperty("error");
  });

  it("rejects directories, empty files, and files over the size cap", async () => {
    expect(await readLocalImage(join(root, "inbox"), [root])).toHaveProperty("error");
    expect(await readLocalImage(join(root, "empty.jpg"), [root])).toHaveProperty("error");
    const r = await readLocalImage(join(root, "big.jpg"), [root]);
    expect("error" in r && r.error).toContain("too large");
  });
});
