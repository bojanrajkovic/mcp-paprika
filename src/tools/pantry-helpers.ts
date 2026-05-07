import { err, ok, type Result } from "neverthrow";
import type { PantryItem } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { textResult } from "./helpers.js";

export function pantryStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.pantryStore.hasSynced) {
    return err(textResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

export function pantryItemToMarkdown(item: PantryItem): string {
  const lines: Array<string> = [];

  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);

  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  if (item.aisle !== "") {
    lines.push(`**Aisle:** ${item.aisle}`);
  }
  lines.push(`**In stock:** ${item.inStock ? "Yes" : "No"}`);
  if (item.expirationDate !== null) {
    lines.push(`**Expires:** ${item.expirationDate}`);
  }
  if (item.purchaseDate !== null) {
    lines.push(`**Purchased:** ${item.purchaseDate}`);
  }
  if (item.notes !== null) {
    lines.push("");
    lines.push(`**Notes:** ${item.notes}`);
  }

  return lines.join("\n");
}
