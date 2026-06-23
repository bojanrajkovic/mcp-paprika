import { gzipSync } from "node:zlib";

import { ATTR_HTTP_REQUEST_METHOD } from "@opentelemetry/semantic-conventions";
import {
  BrokenCircuitError,
  bulkhead,
  circuitBreaker,
  type CircuitBreakerPolicy,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleType,
  type IPolicy,
  type IRetryContext,
  retry,
  type RetryPolicy,
  wrap,
} from "cockatiel";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";
import type { ZodType, ZodTypeDef } from "zod";

import type { Aisle } from "../domains/aisle/types.js";
import type { GroceryIngredient } from "../domains/grocery/grocery-ingredient/types.js";
import type { GroceryItem } from "../domains/grocery/grocery-item/types.js";
import type { GroceryList } from "../domains/grocery/grocery-list/types.js";
import type { MealType } from "../domains/meal-type/types.js";
import type { Meal } from "../domains/meal/types.js";
import type { MenuItem } from "../domains/menu/menu-item/types.js";
import type { Menu } from "../domains/menu/types.js";
import type { PantryItem } from "../domains/pantry/types.js";
import type { Category } from "../domains/recipe/category/types.js";
import type { RecipeUid } from "../domains/recipe/ids.js";
import type { Photo } from "../domains/recipe/photo/types.js";
import type { Recipe, RecipeEntry } from "../domains/recipe/types.js";
import type { PaprikaClientError } from "./errors.js";

import { AisleSchema } from "../domains/aisle/types.js";
import { GroceryIngredientSchema } from "../domains/grocery/grocery-ingredient/types.js";
import { GroceryItemSchema } from "../domains/grocery/grocery-item/types.js";
import { GroceryListSchema } from "../domains/grocery/grocery-list/types.js";
import { MealTypeSchema } from "../domains/meal-type/types.js";
import { MealSchema, mealToApiPayload } from "../domains/meal/types.js";
import { MenuItemSchema, menuItemToApiPayload } from "../domains/menu/menu-item/types.js";
import { MenuSchema, menuToApiPayload } from "../domains/menu/types.js";
import { PantryItemSchema } from "../domains/pantry/types.js";
import { CategorySchema } from "../domains/recipe/category/types.js";
import { PhotoSchema, photoToApiPayload } from "../domains/recipe/photo/types.js";
import { RecipeEntrySchema, RecipeSchema } from "../domains/recipe/types.js";
import { ATTR_CLIENT, observeBulkhead, wireResilienceTelemetry } from "../telemetry/resilience.js";
import { getTracer } from "../telemetry/scope.js";
import { traceResultAsync } from "../telemetry/trace-result.js";
import { CircuitOpenError } from "../utils/errors.js";
import { SILENT_LOG, toMessage } from "../utils/log.js";
import { AuthResponseSchema } from "./auth-response.js";
import { PaprikaAPIError, PaprikaAuthError, PaprikaError } from "./errors.js";
import { computeRecipeHash } from "./recipe-hash.js";

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
const API_BASE = "https://paprikaapp.com/api/v2/sync";

const PAPRIKA_CLIENT_ATTR = { [ATTR_CLIENT]: "paprika" } as const;

/**
 * Low-cardinality logical-operation name from a sync URL: the first path
 * segment after `/sync/` ("recipes", "recipe", "photo", …) — never the UID
 * that may follow it. Every `request()` URL is API_BASE-shaped; the fallback
 * is defensive only.
 */
function operationFromUrl(url: string): string {
  const segments = new URL(url).pathname.split("/").filter((s) => s.length > 0);
  const syncIdx = segments.indexOf("sync");
  return (syncIdx >= 0 ? segments[syncIdx + 1] : undefined) ?? "request";
}

// Concurrency for the N+1 recipe fetch during sync (see PaprikaClient constructor).
const DEFAULT_RECIPE_FETCH_CONCURRENCY = 5;
// Above this, raising concurrency trades reliability for speed against a single origin
// (429s, breaker trips); we allow it but warn (#174).
const RECOMMENDED_MAX_RECIPE_FETCH_CONCURRENCY = 20;

class TransientHTTPError extends Error {
  constructor(readonly status: number) {
    super(`Transient HTTP error (${status.toString()})`);
    this.name = "TransientHTTPError";
  }
}

// Private marker class used to route network-level fetch failures (DNS,
// TCP reset, TLS handshake, etc.) through cockatiel's handleType-based
// retry policy. undici throws a bare TypeError for these; the runtime
// has no dedicated subclass we can match on directly. The cause is the
// original TypeError so callers can unwrap and surface the real error
// once retries are exhausted.
class NetworkRetryableError extends Error {
  constructor(override readonly cause: TypeError) {
    super(`Network error: ${cause.message}`, { cause });
    this.name = "NetworkRetryableError";
  }
}

class TokenExpiredError extends Error {
  constructor() {
    super("Token expired");
    this.name = "TokenExpiredError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

/**
 * Normalize whatever escapes the resilience stack into the public error union
 * (the foreign producers' throws stop at this owned edge). Paprika's
 * own classes pass through untouched (callers key on `PaprikaAPIError.status`);
 * cockatiel's `BrokenCircuitError` becomes the shared `CircuitOpenError`; the
 * network-retry marker unwraps to a `PaprikaError` carrying the original undici
 * `TypeError`'s message and cause (so tools surface the same message the
 * pre-Result client did); anything else (a `ZodError` on a malformed body, an
 * unexpected runtime error) wraps as a base `PaprikaError`.
 */
function toClientError(error: unknown, url: string): PaprikaClientError {
  if (error instanceof PaprikaError || error instanceof CircuitOpenError) return error;
  if (error instanceof BrokenCircuitError) return new CircuitOpenError("paprika", url, { cause: error });
  if (error instanceof NetworkRetryableError) return new PaprikaError(error.cause.message, { cause: error.cause });
  return new PaprikaError(toMessage(error), { cause: error });
}

/**
 * Paprika's v2 sync API sometimes signals an application error with HTTP 200 and
 * an `{ error: { code, message } }` body instead of a proper status code — e.g. a
 * GET for a hard-deleted (or never-existed) recipe returns
 * `200 {"error":{"code":0,"message":"Recipe not found."}}`. This schema detects
 * that envelope so `request()` can treat it as a failure rather than mis-parsing
 * it as a `{ result }` body (which would throw an opaque ZodError). `code` is
 * advisory (Paprika sends `0` for not-found), so callers key on the message.
 */
const ERROR_ENVELOPE_SCHEMA = z.object({
  error: z.object({ code: z.number().optional(), message: z.string() }),
});

/** Matches Paprika's not-found error messages ("Recipe not found.", etc.). */
const NOT_FOUND_MESSAGE = /not found/i;

/**
 * The per-photo read response carries a presigned `photo_url` (short-lived S3 URL)
 * for the full-resolution bytes — distinct from the catalog GET (`/photos/`), whose
 * 6-field rows carry no URL. Only `photo_url` is consumed; `.passthrough()` ignores
 * the rest of the echoed metadata.
 */
const PHOTO_DOWNLOAD_SCHEMA = z.object({ photo_url: z.string().min(1) }).passthrough();

function recipeToApiPayload(recipe: Readonly<Recipe>): Record<string, unknown> {
  return {
    uid: recipe.uid,
    hash: recipe.hash,
    name: recipe.name,
    categories: recipe.categories,
    ingredients: recipe.ingredients,
    directions: recipe.directions,
    description: recipe.description,
    notes: recipe.notes,
    prep_time: recipe.prepTime,
    cook_time: recipe.cookTime,
    total_time: recipe.totalTime,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    rating: recipe.rating,
    created: recipe.created,
    image_url: recipe.imageUrl,
    photo: recipe.photo,
    photo_hash: recipe.photoHash,
    photo_large: recipe.photoLarge,
    source: recipe.source,
    source_url: recipe.sourceUrl,
    on_favorites: recipe.onFavorites,
    in_trash: recipe.inTrash,
    is_pinned: recipe.isPinned,
    scale: recipe.scale,
    nutritional_info: recipe.nutritionalInfo,
    deleted: recipe.deleted,
  };
}

function aisleToApiPayload(aisle: Readonly<Aisle>): Record<string, unknown> {
  return {
    uid: aisle.uid,
    name: aisle.name,
    order_flag: aisle.orderFlag,
    deleted: aisle.deleted,
  };
}

// Meal-type create/upsert payload — the camelCase→snake_case wire transform, the
// inverse of MealTypeSchema. POSTs all eight fields (verified in
// docs/wire-captures/mealtypes.har.json "create mealtype"); Paprika upserts by `uid`.
function mealTypeToApiPayload(mealType: Readonly<MealType>): Record<string, unknown> {
  return {
    uid: mealType.uid,
    name: mealType.name,
    color: mealType.color,
    order_flag: mealType.orderFlag,
    original_type: mealType.originalType,
    export_all_day: mealType.exportAllDay,
    export_time: mealType.exportTime,
    deleted: mealType.deleted,
  };
}

// The Category type carries no `deleted` field (the read schema omits it), but
// the write wire format requires it: a create/rename POSTs `deleted: false`, a
// soft-delete POSTs `deleted: true` (data-only tombstone), verified in
// docs/wire-captures/writes.har.json. `deleted` is therefore an explicit
// parameter rather than a field read off the entity.
function categoryToApiPayload(category: Readonly<Category>, deleted: boolean): Record<string, unknown> {
  return {
    uid: category.uid,
    name: category.name,
    order_flag: category.orderFlag,
    parent_uid: category.parentUid,
    deleted,
  };
}

function pantryItemToApiPayload(item: Readonly<PantryItem>): Record<string, unknown> {
  return {
    uid: item.uid,
    ingredient: item.ingredient,
    quantity: item.quantity,
    aisle: item.aisle,
    aisle_uid: item.aisleUid,
    expiration_date: item.expirationDate,
    has_expiration: item.hasExpiration,
    in_stock: item.inStock,
    purchase_date: item.purchaseDate,
    deleted: item.deleted,
  };
}

function groceryListToApiPayload(list: Readonly<GroceryList>): Record<string, unknown> {
  return {
    uid: list.uid,
    name: list.name,
    order_flag: list.orderFlag,
    is_default: list.isDefault,
    reminders_list: list.remindersList,
    deleted: list.deleted,
  };
}

function groceryItemToApiPayload(item: Readonly<GroceryItem>): Record<string, unknown> {
  return {
    uid: item.uid,
    name: item.name,
    ingredient: item.ingredient,
    aisle: item.aisle,
    aisle_uid: item.aisleUid,
    list_uid: item.listUid,
    purchased: item.purchased,
    deleted: item.deleted,
    order_flag: item.orderFlag,
    quantity: item.quantity,
    instruction: item.instruction,
    recipe: item.recipe,
    separate: item.separate,
  };
}

function groceryIngredientToApiPayload(ingredient: Readonly<GroceryIngredient>): Record<string, unknown> {
  return {
    uid: ingredient.uid,
    name: ingredient.name,
    aisle_uid: ingredient.aisleUid,
    deleted: ingredient.deleted,
  };
}

export class PaprikaClient {
  private token: string | null = null;
  private readonly _recipesBulkhead: ReturnType<typeof bulkhead>;
  private readonly log: Logger;
  private readonly retryPolicy: RetryPolicy;
  private readonly breakerPolicy: CircuitBreakerPolicy;
  private readonly resilience: IPolicy<IRetryContext, never>;

  constructor(
    private readonly email: string,
    private readonly password: string,
    log?: Logger,
    opts?: { readonly recipeFetchConcurrency?: number },
  ) {
    this.log = log ?? SILENT_LOG;

    // Cold-start sync fetches recipes N+1 (listRecipes then getRecipe per recipe),
    // throttled by this bulkhead. Configurable so a large library can go faster (#174);
    // reliability is the primary constraint, so values above the recommended max get a
    // warning — high concurrency against a single origin risks 429s and tripping the
    // breaker (which the retry/circuit-breaker stack then has to absorb).
    const recipeFetchConcurrency = opts?.recipeFetchConcurrency ?? DEFAULT_RECIPE_FETCH_CONCURRENCY;
    if (recipeFetchConcurrency > RECOMMENDED_MAX_RECIPE_FETCH_CONCURRENCY) {
      this.log.warn(
        { recipeFetchConcurrency, recommendedMax: RECOMMENDED_MAX_RECIPE_FETCH_CONCURRENCY },
        "recipe fetch concurrency exceeds the recommended max; high concurrency against a single origin risks rate-limiting (429) and tripping the circuit breaker",
      );
    }
    this._recipesBulkhead = bulkhead(recipeFetchConcurrency, Number.MAX_SAFE_INTEGER);
    this.retryPolicy = retry(handleType(TransientHTTPError).orType(NetworkRetryableError), {
      maxAttempts: 3,
      backoff: new ExponentialBackoff({
        initialDelay: 500,
        maxDelay: 10_000,
      }),
    });
    this.breakerPolicy = circuitBreaker(handleType(TransientHTTPError).orType(NetworkRetryableError), {
      halfOpenAfter: 30_000,
      breaker: new ConsecutiveBreaker(5),
    });
    // Breaker is OUTSIDE retry: each distinct tool-call counts as one failure
    // toward the breaker threshold (not each retry attempt within that call).
    this.resilience = wrap(this.breakerPolicy, this.retryPolicy);

    // Retry telemetry — fires BEFORE each backoff delay.
    // event.attempt is the upcoming retry number (1 = first retry).
    // Normalize: attempt N → Nth network touch (1-indexed).
    // The upcoming 2nd network touch = first retry = event.attempt 1 → log attempt 2.
    this.retryPolicy.onRetry((event) => {
      if ("error" in event) {
        this.log.warn(
          { attempt: event.attempt + 1, nextBackoffMs: event.delay, err: event.error },
          "paprika request failed, retrying",
        );
      }
    });

    this.retryPolicy.onGiveUp((event) => {
      if ("error" in event) {
        this.log.error({ err: event.error }, "paprika retries exhausted");
      }
    });

    // Breaker state-change hooks.
    this.breakerPolicy.onBreak(() => {
      this.log.warn({}, "paprika circuit breaker opened");
    });

    this.breakerPolicy.onReset(() => {
      this.log.info({}, "paprika circuit breaker reset");
    });

    this.breakerPolicy.onHalfOpen(() => {
      this.log.info({}, "paprika circuit breaker half-open (probe pending)");
    });

    // Metrics ride the same hook surface as the log lines above: retry/giveup
    // counters, breaker-state gauge, and the recipe-fetch bulkhead saturation.
    wireResilienceTelemetry("paprika", this.retryPolicy, this.breakerPolicy);
    observeBulkhead("paprika", this._recipesBulkhead);
  }

  authenticate(): ResultAsync<void, PaprikaClientError> {
    // One authentication attempt. Classifies failures the same way request()
    // does so the shared retry policy can tell transient blips (retry) from a
    // real auth rejection (fail fast).
    const attempt = async (): Promise<void> => {
      let response: Response;
      try {
        response = await fetch(AUTH_URL, {
          method: "POST",
          body: new URLSearchParams({ email: this.email, password: this.password }),
        });
      } catch (error) {
        // undici throws a bare TypeError for network-level failures (DNS, TCP
        // reset, TLS handshake). Mark it retryable so a transient blip at
        // startup backs off and retries instead of crashlooping the process (#158).
        if (error instanceof TypeError) {
          throw new NetworkRetryableError(error);
        }
        throw error;
      }

      if (!response.ok) {
        // Transient upstream failures (5xx / 429) are worth retrying; a real
        // auth rejection (401/403, bad credentials) is not — fail fast.
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new TransientHTTPError(response.status);
        }
        throw new PaprikaAuthError(`Authentication failed (HTTP ${response.status.toString()})`);
      }

      const json: unknown = await response.json();
      const data = AuthResponseSchema.parse(json);
      this.token = data.result.token;
    };

    // Reuse the same bounded retry policy as request() (maxAttempts: 3, exp
    // backoff) so a transient network/5xx failure at startup retries instead of
    // failing on the first blip. The circuit breaker is intentionally NOT
    // applied — startup auth is one-shot, not a hot path. Non-retryable errors
    // (PaprikaAuthError on bad creds, ZodError on a malformed body) are not
    // matched by the policy and escape immediately. Once the bounded retries
    // are exhausted, the mapper surfaces a clean PaprikaAuthError (preserving
    // the underlying cause) rather than the internal retry marker.
    return traceResultAsync(getTracer(), "paprika.login", { attributes: PAPRIKA_CLIENT_ATTR }, () =>
      ResultAsync.fromPromise(this.retryPolicy.execute(attempt), (error) => {
        if (error instanceof NetworkRetryableError) {
          return new PaprikaAuthError("Authentication failed (network error)", { cause: error.cause });
        }
        if (error instanceof TransientHTTPError) {
          return new PaprikaAuthError(`Authentication failed (HTTP ${error.status.toString()})`, { cause: error });
        }
        if (error instanceof PaprikaError) return error;
        return new PaprikaError(toMessage(error), { cause: error });
      }),
    );
  }

  listRecipes(): ResultAsync<Array<RecipeEntry>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/recipes/`, z.array(RecipeEntrySchema));
  }

  getRecipe(uid: string): ResultAsync<Recipe, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/recipe/${uid}/`, RecipeSchema);
  }

  getRecipes(uids: ReadonlyArray<string>): ResultAsync<Array<Recipe>, PaprikaClientError> {
    // Each fetch is throttled by the bulkhead. Its execute() can only reject
    // with something foreign (the queue is effectively unbounded), so the
    // fromPromise + flatten keeps even that on the Result rail — the same
    // double-Result shape as DiskCache._locked.
    return ResultAsync.combine(
      uids.map((uid) =>
        ResultAsync.fromPromise(
          this._recipesBulkhead.execute(() => this.getRecipe(uid)),
          (e) => toClientError(e, `${API_BASE}/recipe/${uid}/`),
        ).andThen((r) => r),
      ),
    );
  }

  listCategories(): ResultAsync<Array<Category>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/categories/`, z.array(CategorySchema));
  }

  listAisles(): ResultAsync<Array<Aisle>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/groceryaisles/`, z.array(AisleSchema));
  }

  listGroceryLists(): ResultAsync<Array<GroceryList>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/grocerylists/`, z.array(GroceryListSchema));
  }

  listGroceryItems(): ResultAsync<Array<GroceryItem>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/groceries/`, z.array(GroceryItemSchema));
  }

  listGroceryIngredients(): ResultAsync<Array<GroceryIngredient>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/groceryingredients/`, z.array(GroceryIngredientSchema));
  }

  listMeals(): ResultAsync<Array<Meal>, PaprikaClientError> {
    // Fetched as raw rows and validated one at a time: z.array(MealSchema)'s
    // all-or-nothing parse let a single malformed row abort the whole list and
    // permanently wedge the meal store (#290). MealSchema's null coercions
    // handle the absences we know about; this is the floor for the shapes we
    // don't — a row that still fails is logged (uid + zod issues, so the poison
    // row is identifiable from the MCP log) and skipped, and every other meal
    // syncs normally.
    return this.request("GET", `${API_BASE}/meals/`, z.array(z.unknown())).map((rows) => {
      const meals: Array<Meal> = [];
      for (const [index, row] of rows.entries()) {
        const parsed = MealSchema.safeParse(row);
        if (parsed.success) {
          meals.push(parsed.data);
        } else {
          const peek = z.object({ uid: z.string() }).safeParse(row);
          const uid = peek.success ? peek.data.uid : undefined;
          this.log.warn({ entity: "meal", index, uid, issues: parsed.error.issues }, "skipping unparseable meal row");
        }
      }
      return meals;
    });
  }

  listMealTypes(): ResultAsync<Array<MealType>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/mealtypes/`, z.array(MealTypeSchema));
  }

  listMenus(): ResultAsync<Array<Menu>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/menus/`, z.array(MenuSchema));
  }

  listMenuItems(): ResultAsync<Array<MenuItem>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/menuitems/`, z.array(MenuItemSchema));
  }

  listPhotos(): ResultAsync<Array<Photo>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/photos/`, z.array(PhotoSchema));
  }

  listPantry(): ResultAsync<Array<PantryItem>, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/pantry/`, z.array(PantryItemSchema));
  }

  /**
   * Resolves the presigned download URL for a photo's full-resolution bytes. A GET to
   * the singular `/sync/photo/{uid}/` endpoint (the same path the upload POSTs to —
   * recipes and photos use path-UID URLs, see the CLAUDE.md "two URL conventions"
   * edge) returns the photo's metadata including a short-lived presigned `photo_url`
   * pointing at cloud storage; the bytes themselves are NOT in this response. The
   * caller fetches that URL through the SSRF-guarded `fetchImageBytes`. The catalog
   * read (`listPhotos`) does not carry `photo_url`; only this per-photo read does.
   */
  getPhotoDownloadUrl(photoUid: string): ResultAsync<string, PaprikaClientError> {
    return this.request("GET", `${API_BASE}/photo/${photoUid}/`, PHOTO_DOWNLOAD_SCHEMA).map((p) => p.photo_url);
  }

  /**
   * Stamps the client-owned content hash so writes are hash-consistent with the
   * server and changes are detectable by every Paprika client (#167). This is the
   * single chokepoint every recipe write crosses — `saveRecipe` and `uploadPhoto`
   * both call it and return the result, so the wire payload and the locally-committed
   * recipe inherently carry the same hash.
   *
   * Only the hard-delete tombstone (`deleted: true`) echoes the existing hash
   * verbatim: Paprika validates `deleted` against the stored hash server-side (#125),
   * and there is no content to re-hash. Everything else recomputes — including a
   * soft-delete or `inTrash` toggle. `computeRecipeHash` is trash-independent (it
   * pins `in_trash`/`deleted` false), so a pure trash flip recomputes to the same
   * content hash (a no-op for an already-current recipe), while a content edit that
   * *also* sets `inTrash: true` (e.g. `update_recipe` renaming + trashing in one call)
   * still gets a fresh, detectable hash. Soft-deletes are not hash-validated, so
   * recomputing them is safe.
   */
  private stampContentHash(recipe: Readonly<Recipe>): Recipe {
    return recipe.deleted ? (recipe as Recipe) : { ...recipe, hash: computeRecipeHash(recipe) };
  }

  saveRecipe(recipe: Readonly<Recipe>): ResultAsync<Recipe, PaprikaClientError> {
    const hashed = this.stampContentHash(recipe);
    const formData = this.buildEntityFormData(recipeToApiPayload(hashed), "data.gz");
    return this.request("POST", `${API_BASE}/recipe/${hashed.uid}/`, z.boolean(), formData).map(() => hashed);
  }

  saveAisle(aisle: Readonly<Aisle>): ResultAsync<Aisle, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/groceryaisles/`, [aisle], aisleToApiPayload).map(() => aisle as Aisle);
  }

  // Batch aisle upsert — one gzip array POST to the collection URL; Paprika
  // upserts by `uid`. `update_aisle`'s reorder path renumbers several aisles in
  // one write. A tombstone (`deleted: true` on the entity) deletes (`delete_aisle`).
  saveAisles(aisles: ReadonlyArray<Readonly<Aisle>>): ResultAsync<void, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/groceryaisles/`, aisles, aisleToApiPayload);
  }

  // Create or rename a meal type. POSTs a single-element gzip array to the
  // collection URL with `deleted: false`; Paprika upserts by `uid` and returns
  // `{result: true}`. Mirrors saveAisle — the caller (ensureMealType) commits locally.
  saveMealType(mealType: Readonly<MealType>): ResultAsync<MealType, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/mealtypes/`, [mealType], mealTypeToApiPayload).map(
      () => mealType as MealType,
    );
  }

  // Batch meal-type upsert — one gzip array POST to the collection URL; Paprika
  // upserts by `uid`. `update_meal_type`'s reorder path renumbers several types in
  // one write. A tombstone (`deleted: true` on the entity) deletes
  // (`delete_meal_type`); shape verified in docs/wire-captures/mealtypes.har.json.
  saveMealTypes(mealTypes: ReadonlyArray<Readonly<MealType>>): ResultAsync<void, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/mealtypes/`, mealTypes, mealTypeToApiPayload);
  }

  // Create or rename/re-parent a category. POSTs a single-element gzip array to
  // the collection URL with `deleted: false`; Paprika upserts by `uid`. Returns
  // the input category on `{result: true}` (caller commits locally).
  saveCategory(category: Readonly<Category>): ResultAsync<Category, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/categories/`, [category], (c) => categoryToApiPayload(c, false)).map(
      () => category as Category,
    );
  }

  // Soft-delete a category via a tombstone POST (`deleted: true`, all fields
  // echoed). Same collection URL as create/rename — the `deleted` flag is the
  // only differentiator, mirroring the pantry/grocery delete pattern.
  deleteCategory(category: Readonly<Category>): ResultAsync<void, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/categories/`, [category], (c) => categoryToApiPayload(c, true));
  }

  savePantryItems(
    items: ReadonlyArray<Readonly<PantryItem>>,
  ): ResultAsync<ReadonlyArray<PantryItem>, PaprikaClientError> {
    // Pantry writes POST to the collection URL; the UID lives in the body, not the URL.
    // Diverges from `saveRecipe` (which uses /sync/recipe/{uid}/). Verified 2026-05-08.
    return this.postEntities(`${API_BASE}/pantry/`, items, pantryItemToApiPayload).map(() => items);
  }

  saveGroceryList(list: Readonly<GroceryList>): ResultAsync<GroceryList, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/grocerylists/`, [list], groceryListToApiPayload).map(
      () => list as GroceryList,
    );
  }

  saveGroceryItems(
    items: ReadonlyArray<Readonly<GroceryItem>>,
  ): ResultAsync<ReadonlyArray<GroceryItem>, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/groceries/`, items, groceryItemToApiPayload).map(() => items);
  }

  saveGroceryIngredient(ingredient: Readonly<GroceryIngredient>): ResultAsync<GroceryIngredient, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/groceryingredients/`, [ingredient], groceryIngredientToApiPayload).map(
      () => ingredient as GroceryIngredient,
    );
  }

  saveMeals(items: ReadonlyArray<Readonly<Meal>>): ResultAsync<ReadonlyArray<Meal>, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/meals/`, items, mealToApiPayload).map(() => items);
  }

  saveMenus(items: ReadonlyArray<Readonly<Menu>>): ResultAsync<ReadonlyArray<Menu>, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/menus/`, items, menuToApiPayload).map(() => items);
  }

  saveMenuItems(items: ReadonlyArray<Readonly<MenuItem>>): ResultAsync<ReadonlyArray<MenuItem>, PaprikaClientError> {
    return this.postEntities(`${API_BASE}/menuitems/`, items, menuItemToApiPayload).map(() => items);
  }

  /**
   * Attaches a photo to a recipe, replicating the macOS app's captured 3-request
   * sequence (`docs/wire-captures/writes.har.json`):
   *
   * 1. `POST /recipe/{uid}/` — the recipe with `photo` (thumbnail filename),
   *    `photo_large` (full-image filename = the Photo entity), and `photo_hash`
   *    (sha256 of the thumbnail) set, carrying the **thumbnail** bytes as a
   *    `photo_upload` part.
   * 2. `POST /photo/{photoUid}/` — the 7-field Photo entity metadata carrying the
   *    **full** image bytes as a `photo_upload` part.
   * 3. `POST /recipe/{uid}/` — the recipe re-posted (the app's confirm step).
   *
   * `recipeWithPhoto` must already carry the photo fields; `photo` is the full
   * Photo entity (its `hash` is sha256 of the bytes WE upload — Paprika stores
   * client hashes verbatim, so this stays self-consistent; exact-interop hashing
   * is #167). The caller normalizes both images to JPEG and computes the hashes.
   */
  uploadPhoto(
    recipeWithPhoto: Readonly<Recipe>,
    photo: Readonly<Photo>,
    thumbnail: Buffer,
    full: Buffer,
  ): ResultAsync<Recipe, PaprikaClientError> {
    // A photo attach changes photo/photo_large/photo_hash — all hashed fields — so
    // the recipe always gets a freshly stamped content hash (#167). Returned to the
    // caller so the locally-committed recipe matches what we POST.
    const hashed = this.stampContentHash(recipeWithPhoto);
    const thumbnailFilename = hashed.photo ?? `${photo.uid}.jpg`;
    const recipePayload = recipeToApiPayload(hashed);

    // 1. Recipe POST carrying the thumbnail.
    const recipeForm = this.buildPhotoFormData(recipePayload, thumbnail, thumbnailFilename, "data.gz");
    return this.request("POST", `${API_BASE}/recipe/${hashed.uid}/`, z.boolean(), recipeForm)
      .andThen(() => {
        // 2. Photo POST carrying the full image.
        const photoForm = this.buildPhotoFormData(photoToApiPayload(photo), full, photo.filename, "file");
        return this.request("POST", `${API_BASE}/photo/${photo.uid}/`, z.boolean(), photoForm);
      })
      .andThen(() => {
        // 3. Recipe re-POST (confirm), matching the app's captured sequence.
        const confirmForm = this.buildEntityFormData(recipePayload, "data.gz");
        return this.request("POST", `${API_BASE}/recipe/${hashed.uid}/`, z.boolean(), confirmForm);
      })
      .map(() => hashed);
  }

  /**
   * Soft-deletes a photo. POSTs a data-only tombstone (no `photo_upload` part) to
   * `/photo/{uid}/` with all 7 fields echoed and `deleted: true` — including the
   * original create-time `hash`, which Paprika stored verbatim
   * (`docs/wire-captures/writes.har.json`).
   */
  deletePhoto(photo: Readonly<Photo>): ResultAsync<void, PaprikaClientError> {
    const form = this.buildEntityFormData(photoToApiPayload({ ...photo, deleted: true }), "file");
    return this.request("POST", `${API_BASE}/photo/${photo.uid}/`, z.boolean(), form).map(() => undefined);
  }

  notifySync(): ResultAsync<void, PaprikaClientError> {
    return this.request("POST", `${API_BASE}/notify/`, z.unknown()).map(() => undefined);
  }

  deleteRecipe(uid: RecipeUid): ResultAsync<void, PaprikaClientError> {
    return this.getRecipe(uid)
      .andThen((recipe) => this.saveRecipe({ ...recipe, inTrash: true }))
      .andThen(() => this.notifySync());
  }

  // Hard-delete (empty trash): permanently removes the recipe server-side. POSTs
  // the full recipe with both in_trash and deleted set, echoing the recipe's
  // existing hash and created verbatim — the exact shape Paprika.app emits when
  // emptying the trash (docs/wire-captures/writes.har.json). Unlike deleteRecipe
  // (soft, reversible), this is irreversible (#125).
  hardDeleteRecipe(uid: RecipeUid): ResultAsync<void, PaprikaClientError> {
    return this.getRecipe(uid)
      .andThen((recipe) => this.saveRecipe({ ...recipe, inTrash: true, deleted: true }))
      .andThen(() => this.notifySync());
  }

  private buildEntityFormData(payload: unknown, filename = "file"): FormData {
    const json = JSON.stringify(payload);
    const compressed = gzipSync(json);
    const blob = new Blob([compressed]);
    const formData = new FormData();
    formData.append("data", blob, filename);
    return formData;
  }

  /**
   * Like {@link buildEntityFormData} but appends a second `photo_upload` part
   * carrying RAW `image/jpeg` bytes (NOT gzipped, NOT base64) alongside the
   * gzipped `data` part — the two-part multipart shape Paprika uses for photo
   * uploads (`docs/wire-captures/`).
   */
  private buildPhotoFormData(
    payload: unknown,
    imageBytes: Buffer,
    imageFilename: string,
    dataFilename = "file",
  ): FormData {
    const compressed = gzipSync(JSON.stringify(payload));
    const formData = new FormData();
    formData.append("data", new Blob([compressed]), dataFilename);
    formData.append("photo_upload", new Blob([imageBytes], { type: "image/jpeg" }), imageFilename);
    return formData;
  }

  private postEntities<T>(
    url: string,
    items: ReadonlyArray<Readonly<T>>,
    toPayload: (item: Readonly<T>) => Record<string, unknown>,
  ): ResultAsync<void, PaprikaClientError> {
    const formData = this.buildEntityFormData(items.map((item) => toPayload(item)));
    return this.request("POST", url, z.boolean(), formData).map(() => undefined);
  }

  private request<T>(
    method: "GET" | "POST",
    url: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    body?: FormData | URLSearchParams,
  ): ResultAsync<T, PaprikaClientError> {
    const execute = async (ctx: IRetryContext): Promise<T> => {
      const attempt = ctx.attempt + 1;
      const t0 = performance.now();

      this.log.debug({ method, url, attempt }, "paprika request start");

      const headers: Record<string, string> = {};
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const fetchInit: RequestInit = { method, headers };
      if (body !== undefined) {
        fetchInit.body = body;
      }

      let response: Response;
      try {
        response = await fetch(url, fetchInit);
      } catch (error) {
        // undici throws a bare TypeError for network-level failures (DNS,
        // TCP reset, TLS handshake, abort). Re-throw as a retryable marker
        // so cockatiel's handleType policy applies the same backoff +
        // circuit-breaker treatment as 5xx HTTP responses.
        if (error instanceof TypeError) {
          throw new NetworkRetryableError(error);
        }
        throw error;
      }

      const attemptDurationMs = Math.round(performance.now() - t0);
      const status = response.status;

      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(status)) {
          // Don't log here — onRetry hook will emit the warn when cockatiel retries.
          throw new TransientHTTPError(status);
        }

        if (status === 401) {
          this.log.info({ method, url, attempt, status }, "paprika 401, re-authenticating");
          throw new TokenExpiredError();
        }

        const err = new PaprikaAPIError("Request failed", status, url);
        this.log.error(
          { method, url, attempt, status, attemptDurationMs, err },
          "paprika request failed (non-retryable)",
        );
        throw err;
      }

      const json: unknown = await response.json();

      // Paprika can return HTTP 200 with an `{ error: { code, message } }` body
      // instead of `{ result }` (e.g. a GET for a hard-deleted recipe yields
      // `200 {"error":{"code":0,"message":"Recipe not found."}}`). Surface it as a
      // PaprikaAPIError rather than letting the result-envelope parse below throw
      // an opaque ZodError. A "not found" message is normalized to a real 404 so
      // callers keying on status (purge_recipe's idempotency branch) behave as they
      // would for a genuine 404; other error envelopes keep the wire status.
      const errorEnvelope = ERROR_ENVELOPE_SCHEMA.safeParse(json);
      if (errorEnvelope.success) {
        const { message } = errorEnvelope.data.error;
        const normalizedStatus = NOT_FOUND_MESSAGE.test(message) ? 404 : status;
        this.log.info(
          { method, url, attempt, status, normalizedStatus, message },
          "paprika returned an error envelope over HTTP 200",
        );
        throw new PaprikaAPIError(message, normalizedStatus, url);
      }

      const envelope = z.object({ result: schema }).parse(json);
      this.log.debug({ method, url, attempt, status, attemptDurationMs }, "paprika request ok");
      return envelope.result as T;
    };

    // The throw-based cockatiel protocol ends here: one resilience-governed run,
    // converted onto the Result rail, with the 401 token-refresh retry expressed
    // as an orElse re-run instead of a catch + rethrow ladder.
    const run = (): ResultAsync<T, unknown> => ResultAsync.fromPromise(this.resilience.execute(execute), (e) => e);

    // The LOGICAL operation span: one per request() call, covering every retry
    // attempt, the backoff waits between them, and the 401 re-auth re-run — the
    // latency the caller actually experiences. The per-attempt HTTP spans come
    // from the undici instrumentation and parent under this one via the active
    // context; without this span, a 3-attempt request reads as three short
    // fetches and an inexplicable gap.
    return traceResultAsync(
      getTracer(),
      `paprika.${operationFromUrl(url)}`,
      { attributes: { ...PAPRIKA_CLIENT_ATTR, [ATTR_HTTP_REQUEST_METHOD]: method } },
      () =>
        run().orElse((error) => {
          if (error instanceof TokenExpiredError) {
            if (!this.token) {
              return errAsync(new PaprikaAuthError("Authentication required (HTTP 401)"));
            }
            return this.authenticate().andThen(() =>
              run().mapErr((retryError) =>
                retryError instanceof TokenExpiredError
                  ? new PaprikaAuthError("Authentication failed after re-auth (HTTP 401)")
                  : toClientError(retryError, url),
              ),
            );
          }
          return errAsync(toClientError(error, url));
        }),
    );
  }
}

/**
 * Nudge Paprika's cross-client sync after a successful local commit, best-effort.
 * By the time a chokepoint calls this, the write already landed server-side AND
 * committed locally — a failed nudge costs only propagation latency to other
 * clients (the periodic sync re-nudges), so it must not fail the commit or
 * masquerade as a cache failure.
 */
export function notifySyncBestEffort(client: Pick<PaprikaClient, "notifySync">, log: Logger): ResultAsync<void, never> {
  return client.notifySync().orElse((e) => {
    log.warn({ err: e }, "notifySync failed after a successful local commit; the periodic sync will propagate");
    return okAsync<void, never>(undefined);
  });
}
