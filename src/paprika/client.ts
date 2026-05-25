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
  PantryItem,
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
  PantryItemSchema,
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
    photo_url: recipe.photoUrl,
    source: recipe.source,
    source_url: recipe.sourceUrl,
    on_favorites: recipe.onFavorites,
    in_trash: recipe.inTrash,
    is_pinned: recipe.isPinned,
    on_grocery_list: recipe.onGroceryList,
    scale: recipe.scale,
    nutritional_info: recipe.nutritionalInfo,
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
    notes: item.notes,
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
    const response = await fetch(AUTH_URL, {
      method: "POST",
      body: new URLSearchParams({ email: this.email, password: this.password }),
    });

    if (!response.ok) {
      throw new PaprikaAuthError(`Authentication failed (HTTP ${response.status.toString()})`);
    }

    const json: unknown = await response.json();
    const data = AuthResponseSchema.parse(json);
    this.token = data.result.token;
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

  async notifySync(): Promise<void> {
    await this.request("POST", `${API_BASE}/notify/`, z.unknown());
  }

  async deleteRecipe(uid: RecipeUid): Promise<void> {
    const recipe = await this.getRecipe(uid);
    await this.saveRecipe({ ...recipe, inTrash: true });
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
