import { err, ok, type Result } from "neverthrow";
import { Mutex } from "async-mutex";
import type { Aisle, AisleUid } from "../paprika/types.js";
import { AisleUidSchema } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

const ensureAisleMutex = new Mutex();

export function aisleStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.aisleStore.hasSynced) {
    return err(textResult("Aisle list is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

export async function commitAisle(ctx: ServerContext, aisle: Readonly<Aisle>): Promise<void> {
  const uid: AisleUid = aisle.uid;
  ctx.aisleStore.markPendingUpsert(uid);
  try {
    await ctx.cache.aisles.put(aisle);
    await ctx.cache.flush();
  } catch (e) {
    ctx.aisleStore.clearPending(uid);
    throw e;
  }
  ctx.aisleStore.set(aisle);
  await ctx.client.notifySync();
}

/**
 * Resolves an aisle display name to its { aisle, aisleUid } pair, auto-creating
 * the aisle in Paprika if no match exists. An empty name short-circuits to empty
 * strings without any I/O.
 *
 * Custom aisles created by this function use uppercase UUID v4, matching what
 * Paprika.app emits for user-created aisles (built-in defaults use 64-char
 * uppercase hex strings — both formats are accepted by the server).
 */
export async function ensureAisle(ctx: ServerContext, name: string): Promise<{ aisle: string; aisleUid: string }> {
  if (name === "") {
    return { aisle: "", aisleUid: "" };
  }

  const match = ctx.aisleStore.resolveByName(name);
  if (match !== undefined) {
    return { aisle: match.name, aisleUid: match.uid };
  }

  // Mutex serializes the create path so concurrent pantry writes for the same
  // new aisle name don't both miss resolveByName and create duplicate aisles.
  return ensureAisleMutex.runExclusive(async () => {
    // Re-check after acquiring — a concurrent caller may have created it.
    const recheck = ctx.aisleStore.resolveByName(name);
    if (recheck !== undefined) {
      return { aisle: recheck.name, aisleUid: recheck.uid };
    }

    const existing = ctx.aisleStore.getAll();
    const maxOrder = existing.length === 0 ? 0 : Math.max(...existing.map((a) => a.orderFlag)) + 1;
    const uid = AisleUidSchema.parse(crypto.randomUUID().toUpperCase());
    const newAisle: Aisle = {
      uid,
      name,
      orderFlag: maxOrder,
      deleted: false,
    };

    const saved = await ctx.client.saveAisle(newAisle);
    await commitAisle(ctx, saved);

    return { aisle: saved.name, aisleUid: saved.uid };
  });
}
