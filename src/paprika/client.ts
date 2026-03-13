/**
 * Typed HTTP client for the Paprika Cloud Sync API.
 *
 * Encapsulates authentication against the v1 login endpoint
 * and resilient request execution against the v2 data endpoint.
 *
 * Provides recipe and category read methods, plus write methods
 * added in P1-U07 (saveRecipe, deleteRecipe, notifySync).
 */

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
} from "cockatiel";
import { z } from "zod";
import type { ZodType, ZodTypeDef } from "zod";
import type { Category, Recipe, RecipeEntry, RecipeUid } from "./types.js";
import { AuthResponseSchema, CategoryEntrySchema, CategorySchema, RecipeEntrySchema, RecipeSchema } from "./types.js";
import { PaprikaAuthError, PaprikaAPIError } from "./errors.js";

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
const API_BASE = "https://paprikaapp.com/api/v2/sync";

class TransientHTTPError extends Error {
  constructor(readonly status: number) {
    super(`Transient HTTP error (${status.toString()})`);
    this.name = "TransientHTTPError";
  }
}

class TokenExpiredError extends Error {
  constructor() {
    super("Token expired");
    this.name = "TokenExpiredError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

const retryPolicy = retry(handleType(TransientHTTPError), {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({
    initialDelay: 500,
    maxDelay: 10_000,
  }),
});

const breakerPolicy = circuitBreaker(handleType(TransientHTTPError), {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});

const resilience = wrap(retryPolicy, breakerPolicy);

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

export class PaprikaClient {
  private token: string | null = null;
  private readonly _recipesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);
  private readonly _categoriesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);

  constructor(
    private readonly email: string,
    private readonly password: string,
  ) {}

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
    const entries = await this.request("GET", `${API_BASE}/categories/`, z.array(CategoryEntrySchema));
    return Promise.all(
      entries.map((entry) =>
        this._categoriesBulkhead.execute(() =>
          this.request("GET", `${API_BASE}/category/${entry.uid}/`, CategorySchema),
        ),
      ),
    );
  }

  async saveRecipe(recipe: Readonly<Recipe>): Promise<Recipe> {
    const formData = this.buildRecipeFormData(recipe);
    return this.request("POST", `${API_BASE}/recipe/${recipe.uid}/`, RecipeSchema, formData);
  }

  async notifySync(): Promise<void> {
    await this.request("POST", `${API_BASE}/notify/`, z.unknown());
  }

  async deleteRecipe(uid: RecipeUid): Promise<void> {
    const recipe = await this.getRecipe(uid);
    await this.saveRecipe({ ...recipe, inTrash: true });
    await this.notifySync();
  }

  private buildRecipeFormData(recipe: Readonly<Recipe>): FormData {
    const payload = recipeToApiPayload(recipe);
    const json = JSON.stringify(payload);
    const compressed = gzipSync(json);
    const blob = new Blob([compressed]);
    const formData = new FormData();
    formData.append("data", blob, "data.gz");
    return formData;
  }

  private async request<T>(
    method: "GET" | "POST",
    url: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    body?: FormData | URLSearchParams,
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      const headers: Record<string, string> = {};
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const fetchInit: RequestInit = { method, headers };
      if (body !== undefined) {
        fetchInit.body = body;
      }

      const response = await fetch(url, fetchInit);

      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new TransientHTTPError(response.status);
        }

        if (response.status === 401) {
          throw new TokenExpiredError();
        }

        throw new PaprikaAPIError("Request failed", response.status, url);
      }

      const json: unknown = await response.json();
      const envelope = z.object({ result: schema }).parse(json);
      return envelope.result as T;
    };

    try {
      return await resilience.execute(execute);
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new PaprikaAPIError("Service unavailable (circuit open)", 503, url);
      }

      if (error instanceof TokenExpiredError) {
        if (!this.token) {
          throw new PaprikaAuthError("Authentication required (HTTP 401)");
        }

        await this.authenticate();

        try {
          return await resilience.execute(execute);
        } catch (retryError) {
          if (retryError instanceof TokenExpiredError) {
            throw new PaprikaAuthError("Authentication failed after re-auth (HTTP 401)");
          }
          if (retryError instanceof BrokenCircuitError) {
            throw new PaprikaAPIError("Service unavailable (circuit open)", 503, url);
          }
          throw retryError;
        }
      }

      throw error;
    }
  }
}
