import { open, realpath } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";

import { MAX_IMAGE_BYTES } from "./photo-fetch.js";

function within(path: string, root: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep;
  return path === root || path.startsWith(base);
}

/** `stat()` of whatever is at `path` now, via an open descriptor, or null. */
async function statAt(path: string): Promise<{ dev: number; ino: number } | null> {
  try {
    const h = await open(path, "r");
    try {
      return await h.stat();
    } finally {
      await h.close();
    }
  } catch {
    return null;
  }
}

/**
 * Reads image bytes from a local file for `upload_recipe_photo`'s `{ path }` source,
 * allowed only when the file's real path (symlinks resolved) sits under one of `roots`
 * (`config.photos.fileRoots`; empty disables the source). Enforces the same size cap as
 * URL downloads. Returns an error message instead of throwing.
 *
 * Race-safe without platform-specific fd tricks: the file is opened first, then its real
 * path is resolved and checked, and the opened descriptor must be the same file (device
 * + inode) as the one now at that real path. Swapping the path for a symlink between the
 * steps makes the identities differ, so the read is refused. Bytes come from the
 * descriptor, never from a second open by name.
 */
export async function readLocalImage(
  path: string,
  roots: readonly string[],
): Promise<{ bytes: Buffer } | { error: string }> {
  if (roots.length === 0) {
    return {
      error:
        "Reading photos from a file path is disabled on this server (set PAPRIKA_PHOTO_FILE_ROOTS). Use `url` instead.",
    };
  }
  if (!isAbsolute(path)) return { error: `The path must be absolute: "${path}".` };

  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return { error: `No readable file at "${path}".` };
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) return { error: `"${path}" is not a regular file.` };

    const real = await realpath(path).catch(() => null);
    const realRoots = await Promise.all(roots.map((r) => realpath(r).catch(() => null)));
    if (real === null || !realRoots.some((r) => r !== null && within(real, r))) {
      return { error: `"${path}" is outside the allowed photo directories (${roots.join(", ")}).` };
    }
    const current = await statAt(real);
    if (current?.dev !== opened.dev || current.ino !== opened.ino) {
      return { error: `"${path}" changed while it was being read; try again.` };
    }

    if (opened.size === 0) return { error: `"${path}" is empty.` };
    if (opened.size > MAX_IMAGE_BYTES) {
      return { error: `Image too large (${opened.size.toString()} bytes; max ${MAX_IMAGE_BYTES.toString()}).` };
    }
    return { bytes: await handle.readFile() };
  } finally {
    await handle.close();
  }
}
