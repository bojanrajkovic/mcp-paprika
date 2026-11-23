import { readFile, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, sep } from "node:path";

import { MAX_IMAGE_BYTES } from "./photo-fetch.js";

/**
 * Env var listing the directories `upload_recipe_photo` may read `{ path }` sources
 * from, separated by the platform path delimiter (`:` on POSIX). Unset or empty
 * disables the path source entirely — the default, because a remote (HTTP) caller
 * must never be able to make the server read its own disk.
 *
 * Meant for stdio deployments where the server shares a filesystem with the agent
 * (e.g. a sandboxed agent container): set it to the agent's workspace.
 */
export const PHOTO_FILE_ROOTS_ENV = "PAPRIKA_PHOTO_FILE_ROOTS";

/** Roots from {@link PHOTO_FILE_ROOTS_ENV}, read at call time. */
export function photoFileRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[PHOTO_FILE_ROOTS_ENV] ?? "")
    .split(delimiter)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function within(path: string, root: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep;
  return path === root || path.startsWith(base);
}

/**
 * Reads image bytes from a local file, allowed only when the file's real path (after
 * resolving symlinks) sits under one of the configured roots. Enforces the same size
 * cap as URL downloads. Returns an error message instead of throwing.
 */
export async function readLocalImage(
  path: string,
  roots: readonly string[] = photoFileRoots(),
): Promise<{ bytes: Buffer } | { error: string }> {
  if (roots.length === 0) {
    return {
      error: `Reading photos from a file path is disabled on this server (set ${PHOTO_FILE_ROOTS_ENV}). Use \`url\` instead.`,
    };
  }
  if (!isAbsolute(path)) return { error: `The path must be absolute: "${path}".` };

  let real: string;
  try {
    real = await realpath(path);
  } catch {
    return { error: `No readable file at "${path}".` };
  }

  const realRoots = await Promise.all(roots.map((r) => realpath(r).catch(() => null)));
  if (!realRoots.some((r) => r !== null && within(real, r))) {
    return { error: `"${path}" is outside the allowed photo directories (${roots.join(", ")}).` };
  }

  const info = await stat(real);
  if (!info.isFile()) return { error: `"${path}" is not a regular file.` };
  if (info.size === 0) return { error: `"${path}" is empty.` };
  if (info.size > MAX_IMAGE_BYTES) {
    return { error: `Image too large (${info.size.toString()} bytes; max ${MAX_IMAGE_BYTES.toString()}).` };
  }
  return { bytes: await readFile(real) };
}
