import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";

import type { PaprikaConfig } from "../utils/config.js";
import type { Notifier } from "./notifier.js";

import { PaprikaClient } from "../paprika/client.js";
import { BRANDING, iconSvgDataUri } from "../utils/branding.js";
import { createLogger } from "../utils/log.js";
import { getCacheDir } from "../utils/xdg.js";

const SERVER_NAME = "mcp-paprika";
const _require = createRequire(import.meta.url);
const _pkg = _require("../../package.json") as { version: string };
const SERVER_VERSION = _pkg.version;

// Cross-tool orientation sent to clients at connect time (the MCP `instructions`
// field). This is the one channel that reaches the model with guidance the
// per-tool Zod descriptions cannot carry; keep it short and behavioral.
const SERVER_INSTRUCTIONS = `mcp-paprika bridges your Paprika recipe library: recipes, the pantry, grocery lists, meal planning, and menus. Tools read as plain commands in verb_entity order (read_recipe, list_pantry_items, update_grocery_item), so most acts are guessable from the name.

Orientation:
- Recipes, grocery lists, and menus are exposed both as tools (which you call) and as paprika://… resources the user can attach. The read_* tools fetch one by UID on your own, without waiting for an attach.
- Finding recipes: search_recipes matches by name / ingredient / description and also filters by an ingredient list and by max prep / cook / total time — pass any one of those. discover_recipes (present only when semantic search is configured) handles natural-language queries.
- Open-ended edits vs. named acts: the update_* tools change free-form content fields only. The acts a user names have their own verbs — rate_recipe, favorite_recipe / unfavorite_recipe, categorize_recipe, mark_grocery_item_purchased, mark_pantry_item_out_of_stock / restock_pantry_item, reschedule_meal, move_menu_item. Trying to set one of those through update_* is rejected; reach for the verb.
- Recipe trash is the one reversible delete, spoken in steps: trash_recipe moves a recipe to the trash, restore_recipe brings it back, and purge_recipe permanently removes one already trashed. Deleting anything else (grocery items, pantry items, menu items, lists) is immediate and permanent.
- Meals: read_meal_plan shows what is coming up (today forward); search_meal_history recalls what you have already cooked (by recipe or by category); plan_meals schedules meals and log_cooked_meal records one you just made. When scheduling a meal or adding a menu item, link an existing recipe by its UID OR give a freeform name, never both. Grocery items take no recipe link; add_grocery_items wants an ingredient, quantity, and aisle.
- generate_recipe_photo (present only when image generation is configured) attaches the image and returns its photo UID by default. With attach:false it returns a preview plus a single-use token instead; pass that token to upload_recipe_photo to attach it later.
- Data is served from a local cache kept fresh by background sync, so it can briefly lag changes made directly in the Paprika apps.`;

/**
 * The pre-kernel bootstrap shared by both transports: build the logger, emit the
 * startup record, authenticate the Paprika client, and resolve the cache dir. This
 * is the real fast-fail for bad credentials (`client.authenticate()` throws here,
 * whereas `syncOnce()` swallows everything), so it stays OUTSIDE the kernel (#158).
 * The transports assemble the full kernel `Infra` from this base plus `notifier`,
 * `config`, `indexEvents`, and `generatedImageStore`.
 */
export async function buildInfraBase(
  config: PaprikaConfig,
  notifier: Notifier,
): Promise<{ log: Logger; client: PaprikaClient; cacheDir: string }> {
  const log = createLogger({
    transport: config.transport,
    notifier,
    level: config.logging.level,
    notifyLevel: config.logging.notifyLevel,
    pretty: config.logging.pretty,
    ...(config.logging.file !== undefined ? { file: config.logging.file } : {}),
  });
  log.info({ transport: config.transport }, "mcp-paprika starting");

  log.info("authenticating with paprika");
  const client = new PaprikaClient(
    config.paprika.email,
    config.paprika.password,
    log.child({ component: "paprika-client" }),
    { recipeFetchConcurrency: config.sync.recipeFetchConcurrency },
  );
  await client.authenticate();
  log.info("authenticated with paprika");

  return { log, client, cacheDir: getCacheDir() };
}

/**
 * Construct a branded, unregistered {@link McpServer} — the `name`/`title`/`version`/
 * `websiteUrl`/`icons` identity plus the `instructions`, with no tools or resources on
 * it yet. The kernel's `registerAll` registers onto this, once for stdio and once per
 * HTTP session. Branding (`SERVER_NAME`/`SERVER_VERSION`/`SERVER_INSTRUCTIONS`/
 * `BRANDING`/`iconSvgDataUri`) lives here as its single home.
 */
export function buildBrandedServer(): McpServer {
  return new McpServer(
    {
      name: SERVER_NAME,
      title: BRANDING.title,
      version: SERVER_VERSION,
      websiteUrl: BRANDING.websiteUrl,
      // SVG data URI: spec-native (SEP-973) but not rendered by every host yet
      // (see src/utils/branding.ts). The HTTP transport's pre-auth surfaces
      // (/favicon.png + the AS metadata logo_uri) are what a connector card reads today.
      icons: [{ src: iconSvgDataUri(), mimeType: "image/svg+xml", sizes: ["any"] }],
    },
    { instructions: SERVER_INSTRUCTIONS },
  );
}
