import { gzipSync } from "node:zlib";
import {
  ExponentialBackoff,
  ConsecutiveBreaker,
  bulkhead,
  retry,
  circuitBreaker,
  handleType,
  wrap,
  BrokenCircuitError,
  type RetryPolicy,
  type CircuitBreakerPolicy,
  type IPolicy,
  type IRetryContext,
} from "cockatiel";
import type { Logger } from "pino";
import { z } from "zod";
import type { ZodType, ZodTypeDef } from "zod";
import type {
  Aisle,
  Category,
  GroceryIngredient,
  GroceryItem,
  GroceryList,
  Meal,
  MealType,
  Menu,
  MenuItem,
  PantryItem,
  Photo,
  Recipe,
  RecipeEntry,
  RecipeUid,
} from "./types.js";
import {
  AisleSchema,
  AuthResponseSchema,
  CategorySchema,
  GroceryIngredientSchema,
  GroceryItemSchema,
  GroceryListSchema,
  MealSchema,
  MealTypeSchema,
  mealToApiPayload,
  MenuItemSchema,
  menuItemToApiPayload,
  MenuSchema,
  menuToApiPayload,
  PantryItemSchema,
  PhotoSchema,
  photoToApiPayload,
  RecipeEntrySchema,
  RecipeSchema,
} from "./types.js";
import { PaprikaAuthError, PaprikaAPIError } from "./errors.js";
import { CircuitOpenError } from "../utils/errors.js";
import { SILENT_LOG } from "../utils/log.js";

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
const API_BASE = "https://paprikaapp.com/api/v2/sync";

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
  private readonly _recipesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);
  private readonly log: Logger;
  private readonly retryPolicy: RetryPolicy;
  private readonly breakerPolicy: CircuitBreakerPolicy;
  private readonly resilience: IPolicy<IRetryContext, never>;

  constructor(
    private readonly email: string,
    private readonly password: string,
    log?: Logger,
  ) {
    this.log = log ?? SILENT_LOG;
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
  }

  async authenticate(): Promise<void> {
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
    // throwing on the first blip. The circuit breaker is intentionally NOT
    // applied — startup auth is one-shot, not a hot path. Non-retryable errors
    // (PaprikaAuthError on bad creds, ZodError on a malformed body) are not
    // matched by the policy and propagate immediately.
    try {
      await this.retryPolicy.execute(attempt);
    } catch (error) {
      // Once the bounded retries are exhausted, surface a clean PaprikaAuthError
      // (preserving the underlying cause) rather than the internal retry marker.
      if (error instanceof NetworkRetryableError) {
        throw new PaprikaAuthError("Authentication failed (network error)", { cause: error.cause });
      }
      if (error instanceof TransientHTTPError) {
        throw new PaprikaAuthError(`Authentication failed (HTTP ${error.status.toString()})`, { cause: error });
      }
      throw error;
    }
  }

  async listRecipes(): Promise<Array<RecipeEntry>> {
    return this.request("GET", `${API_BASE}/recipes/`, z.array(RecipeEntrySchema));
  }

  async getRecipe(uid: string): Promise<Recipe> {
    return this.request("GET", `${API_BASE}/recipe/${uid}/`, RecipeSchema);
  }

  async getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>> {
    return Promise.all(uids.map((uid) => this._recipesBulkhead.execute(() => this.getRecipe(uid))));
  }

  async listCategories(): Promise<Array<Category>> {
    return this.request("GET", `${API_BASE}/categories/`, z.array(CategorySchema));
  }

  async listAisles(): Promise<Array<Aisle>> {
    return this.request("GET", `${API_BASE}/groceryaisles/`, z.array(AisleSchema));
  }

  async listGroceryLists(): Promise<Array<GroceryList>> {
    return this.request("GET", `${API_BASE}/grocerylists/`, z.array(GroceryListSchema));
  }

  async listGroceryItems(): Promise<Array<GroceryItem>> {
    return this.request("GET", `${API_BASE}/groceries/`, z.array(GroceryItemSchema));
  }

  async listGroceryIngredients(): Promise<Array<GroceryIngredient>> {
    return this.request("GET", `${API_BASE}/groceryingredients/`, z.array(GroceryIngredientSchema));
  }

  async listMeals(): Promise<Array<Meal>> {
    return this.request("GET", `${API_BASE}/meals/`, z.array(MealSchema));
  }

  async listMealTypes(): Promise<Array<MealType>> {
    return this.request("GET", `${API_BASE}/mealtypes/`, z.array(MealTypeSchema));
  }

  async listMenus(): Promise<Array<Menu>> {
    return this.request("GET", `${API_BASE}/menus/`, z.array(MenuSchema));
  }

  async listMenuItems(): Promise<Array<MenuItem>> {
    return this.request("GET", `${API_BASE}/menuitems/`, z.array(MenuItemSchema));
  }

  async listPhotos(): Promise<Array<Photo>> {
    return this.request("GET", `${API_BASE}/photos/`, z.array(PhotoSchema));
  }

  async listPantry(): Promise<Array<PantryItem>> {
    return this.request("GET", `${API_BASE}/pantry/`, z.array(PantryItemSchema));
  }

  async saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe> {
    const formData = this.buildEntityFormData(recipeToApiPayload(recipe), "data.gz");
    await this.request("POST", `${API_BASE}/recipe/${recipe.uid}/`, z.boolean(), formData);
    return recipe as Recipe;
  }

  async saveAisle(aisle: Readonly<Aisle>): Promise<Aisle> {
    await this.postEntities(`${API_BASE}/groceryaisles/`, [aisle], aisleToApiPayload);
    return aisle as Aisle;
  }

  // Create or rename/re-parent a category. POSTs a single-element gzip array to
  // the collection URL with `deleted: false`; Paprika upserts by `uid`. Returns
  // the input category on `{result: true}` (caller commits locally).
  async saveCategory(category: Readonly<Category>): Promise<Category> {
    await this.postEntities(`${API_BASE}/categories/`, [category], (c) => categoryToApiPayload(c, false));
    return category as Category;
  }

  // Soft-delete a category via a tombstone POST (`deleted: true`, all fields
  // echoed). Same collection URL as create/rename — the `deleted` flag is the
  // only differentiator, mirroring the pantry/grocery delete pattern.
  async deleteCategory(category: Readonly<Category>): Promise<void> {
    await this.postEntities(`${API_BASE}/categories/`, [category], (c) => categoryToApiPayload(c, true));
  }

  async savePantryItems(items: ReadonlyArray<Readonly<PantryItem>>): Promise<ReadonlyArray<PantryItem>> {
    // Pantry writes POST to the collection URL; the UID lives in the body, not the URL.
    // Diverges from `saveRecipe` (which uses /sync/recipe/{uid}/). Verified 2026-05-08.
    await this.postEntities(`${API_BASE}/pantry/`, items, pantryItemToApiPayload);
    return items;
  }

  async saveGroceryList(list: Readonly<GroceryList>): Promise<GroceryList> {
    await this.postEntities(`${API_BASE}/grocerylists/`, [list], groceryListToApiPayload);
    return list as GroceryList;
  }

  async saveGroceryItems(items: ReadonlyArray<Readonly<GroceryItem>>): Promise<ReadonlyArray<GroceryItem>> {
    await this.postEntities(`${API_BASE}/groceries/`, items, groceryItemToApiPayload);
    return items;
  }

  async saveGroceryIngredient(ingredient: Readonly<GroceryIngredient>): Promise<GroceryIngredient> {
    await this.postEntities(`${API_BASE}/groceryingredients/`, [ingredient], groceryIngredientToApiPayload);
    return ingredient as GroceryIngredient;
  }

  async saveMeals(items: ReadonlyArray<Readonly<Meal>>): Promise<ReadonlyArray<Meal>> {
    await this.postEntities(`${API_BASE}/meals/`, items, mealToApiPayload);
    return items;
  }

  async saveMenus(items: ReadonlyArray<Readonly<Menu>>): Promise<ReadonlyArray<Menu>> {
    await this.postEntities(`${API_BASE}/menus/`, items, menuToApiPayload);
    return items;
  }

  async saveMenuItems(items: ReadonlyArray<Readonly<MenuItem>>): Promise<ReadonlyArray<MenuItem>> {
    await this.postEntities(`${API_BASE}/menuitems/`, items, menuItemToApiPayload);
    return items;
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
  async uploadPhoto(
    recipeWithPhoto: Readonly<Recipe>,
    photo: Readonly<Photo>,
    thumbnail: Buffer,
    full: Buffer,
  ): Promise<void> {
    const thumbnailFilename = recipeWithPhoto.photo ?? `${photo.uid}.jpg`;
    const recipePayload = recipeToApiPayload(recipeWithPhoto);

    // 1. Recipe POST carrying the thumbnail.
    const recipeForm = this.buildPhotoFormData(recipePayload, thumbnail, thumbnailFilename, "data.gz");
    await this.request("POST", `${API_BASE}/recipe/${recipeWithPhoto.uid}/`, z.boolean(), recipeForm);

    // 2. Photo POST carrying the full image.
    const photoForm = this.buildPhotoFormData(photoToApiPayload(photo), full, photo.filename, "file");
    await this.request("POST", `${API_BASE}/photo/${photo.uid}/`, z.boolean(), photoForm);

    // 3. Recipe re-POST (confirm), matching the app's captured sequence.
    const confirmForm = this.buildEntityFormData(recipePayload, "data.gz");
    await this.request("POST", `${API_BASE}/recipe/${recipeWithPhoto.uid}/`, z.boolean(), confirmForm);
  }

  /**
   * Soft-deletes a photo. POSTs a data-only tombstone (no `photo_upload` part) to
   * `/photo/{uid}/` with all 7 fields echoed and `deleted: true` — including the
   * original create-time `hash`, which Paprika stored verbatim
   * (`docs/wire-captures/writes.har.json`).
   */
  async deletePhoto(photo: Readonly<Photo>): Promise<void> {
    const form = this.buildEntityFormData(photoToApiPayload({ ...photo, deleted: true }), "file");
    await this.request("POST", `${API_BASE}/photo/${photo.uid}/`, z.boolean(), form);
  }

  async notifySync(): Promise<void> {
    await this.request("POST", `${API_BASE}/notify/`, z.unknown());
  }

  async deleteRecipe(uid: RecipeUid): Promise<void> {
    const recipe = await this.getRecipe(uid);
    await this.saveRecipe({ ...recipe, inTrash: true });
    await this.notifySync();
  }

  // Hard-delete (empty trash): permanently removes the recipe server-side. POSTs
  // the full recipe with both in_trash and deleted set, echoing the recipe's
  // existing hash and created verbatim — the exact shape Paprika.app emits when
  // emptying the trash (docs/wire-captures/writes.har.json). Unlike deleteRecipe
  // (soft, reversible), this is irreversible (#125).
  async hardDeleteRecipe(uid: RecipeUid): Promise<void> {
    const recipe = await this.getRecipe(uid);
    await this.saveRecipe({ ...recipe, inTrash: true, deleted: true });
    await this.notifySync();
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

  private async postEntities<T>(
    url: string,
    items: ReadonlyArray<Readonly<T>>,
    toPayload: (item: Readonly<T>) => Record<string, unknown>,
  ): Promise<void> {
    const formData = this.buildEntityFormData(items.map((item) => toPayload(item)));
    await this.request("POST", url, z.boolean(), formData);
  }

  private async request<T>(
    method: "GET" | "POST",
    url: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    body?: FormData | URLSearchParams,
  ): Promise<T> {
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
      // callers keying on status (empty_trash's idempotency branch) behave as they
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

    try {
      return await this.resilience.execute(execute);
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new CircuitOpenError("paprika", url, { cause: error });
      }

      // Unwrap the retry marker so callers see the original undici TypeError —
      // tools that surface .message stay consistent with the pre-retry shape.
      if (error instanceof NetworkRetryableError) {
        throw error.cause;
      }

      if (error instanceof TokenExpiredError) {
        if (!this.token) {
          throw new PaprikaAuthError("Authentication required (HTTP 401)");
        }

        await this.authenticate();

        try {
          return await this.resilience.execute(execute);
        } catch (retryError) {
          if (retryError instanceof TokenExpiredError) {
            throw new PaprikaAuthError("Authentication failed after re-auth (HTTP 401)");
          }
          if (retryError instanceof BrokenCircuitError) {
            throw new CircuitOpenError("paprika", url, { cause: retryError });
          }
          if (retryError instanceof NetworkRetryableError) {
            throw retryError.cause;
          }
          throw retryError;
        }
      }

      throw error;
    }
  }
}
