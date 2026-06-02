import { describe, it, expect } from "vitest";
import { z } from "zod";
import { AisleStoredSchema, AisleSchema, type Aisle } from "../aisle/types.js";
import { CategorySchema, type Category } from "../category/types.js";
import { GroceryIngredientSchema, GroceryIngredientStoredSchema } from "../grocery-ingredient/types.js";
import { GroceryItemSchema, GroceryItemStoredSchema } from "../grocery-item/types.js";
import { GroceryListSchema, GroceryListStoredSchema } from "../grocery-list/types.js";
import {
  RecipeUidSchema,
  CategoryUidSchema,
  PantryItemUidSchema,
  AisleUidSchema,
  type RecipeUid,
  type CategoryUid,
  type PantryItemUid,
  type AisleUid,
} from "../ids.js";
import { MealSchema, mealToApiPayload, type Meal } from "../meal/types.js";
import { MenuItemSchema, MenuItemStoredSchema, menuItemToApiPayload, type MenuItem } from "../menu-item/types.js";
import { MenuSchema, MenuStoredSchema, menuToApiPayload, type Menu } from "../menu/types.js";
import { PantryItemStoredSchema, PantryItemSchema, type PantryItem } from "../pantry/types.js";
import { AuthResponseSchema, type AuthResponse } from "./auth-response.js";
import type {
  RecipeSyncResult,
  PantrySyncResult,
  GroceryListSyncResult,
  GroceryItemSyncResult,
  MenuSyncResult,
  MenuItemSyncResult,
  AnySyncResult,
  DiffResult,
} from "./sync-types.js";
import { PhotoSchema, PhotoStoredSchema, photoToApiPayload, type Photo } from "../photo/types.js";
import {
  RecipeEntrySchema,
  RecipeSchema,
  RecipeStoredSchema,
  type RecipeEntry,
  type Recipe,
  type RecipeInput,
} from "../recipe/types.js";

describe("Branded UID Schemas and Entry Schemas", () => {
  describe("paprika-types.AC1.1: RecipeEntrySchema parses valid entry", () => {
    it("should parse {uid: 'abc', hash: 'def'} successfully", () => {
      const result = RecipeEntrySchema.safeParse({
        uid: "abc",
        hash: "def",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uid).toBe("abc");
        expect(result.data.hash).toBe("def");
        expect(result.data).toEqual({ uid: "abc", hash: "def" });
      }
    });
  });

  describe("paprika-types.AC1.8: RecipeEntrySchema rejects non-string uid", () => {
    it("should throw ZodError when uid is a number (123)", () => {
      const result = RecipeEntrySchema.safeParse({
        uid: 123,
        hash: "def",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(z.ZodError);
      }
    });
  });

  describe("paprika-types.AC2.1: RecipeUid assignable to RecipeUid variable", () => {
    it("should allow a parsed RecipeUid to be assigned to RecipeUid-typed variable", () => {
      const parsed = RecipeUidSchema.parse("test-uid");
      const variable: RecipeUid = parsed;
      expect(variable).toBe("test-uid");
    });
  });

  describe("paprika-types.AC2.2: RecipeUid not assignable to CategoryUid", () => {
    it("should not allow assigning RecipeUid to CategoryUid-typed variable", () => {
      const recipeUid: RecipeUid = RecipeUidSchema.parse("recipe-123");
      // @ts-expect-error RecipeUid should not be assignable to CategoryUid
      const categoryUid: CategoryUid = recipeUid;
      expect(categoryUid).toBeDefined(); // This line is unreachable at runtime
    });
  });

  describe("paprika-types.AC2.3: Plain string not assignable to RecipeUid", () => {
    it("should not allow assigning plain string to RecipeUid-typed variable", () => {
      const plainString = "just-a-string";
      // @ts-expect-error plain string should not be assignable to RecipeUid
      const recipeUid: RecipeUid = plainString;
      expect(recipeUid).toBeDefined(); // This line is unreachable at runtime
    });
  });

  describe("CategoryUidSchema", () => {
    it("should parse valid category UID string", () => {
      const parsed = CategoryUidSchema.parse("category-uid-123");
      const variable: CategoryUid = parsed;
      expect(variable).toBe("category-uid-123");
    });
  });
});

describe("Full Object Schemas", () => {
  describe("paprika-types.AC1.2: RecipeSchema parses full snake_case response", () => {
    it("should parse a complete recipe with all 28 fields and output camelCase", () => {
      const snakeCaseRecipe = {
        uid: "recipe-123",
        hash: "hash-abc",
        name: "Chocolate Cake",
        categories: ["cat-1", "cat-2"],
        ingredients: "2 cups flour, 1 cup sugar",
        directions: "Mix and bake at 350F",
        description: "A delicious chocolate cake",
        notes: "Keep refrigerated",
        prep_time: "15 mins",
        cook_time: "30 mins",
        total_time: "45 mins",
        servings: "8",
        difficulty: "Easy",
        rating: 5,
        created: "2024-01-01T00:00:00Z",
        image_url: "https://example.com/image.jpg",
        photo: "photo_data",
        photo_hash: "photo_hash_123",
        photo_large: "photo_large_data",
        photo_url: "https://example.com/photo.jpg",
        source: "Recipe Book",
        source_url: "https://example.com/source",
        on_favorites: true,
        in_trash: false,
        is_pinned: true,
        on_grocery_list: false,
        scale: "1x",
        nutritional_info: "Calories: 300",
      };

      const result = RecipeSchema.safeParse(snakeCaseRecipe);
      expect(result.success).toBe(true);

      if (result.success) {
        const recipe = result.data;

        // Assert camelCase field names are present
        expect(recipe.imageUrl).toBe("https://example.com/image.jpg");
        expect(recipe.prepTime).toBe("15 mins");
        expect(recipe.cookTime).toBe("30 mins");
        expect(recipe.totalTime).toBe("45 mins");
        expect(recipe.photoHash).toBe("photo_hash_123");
        expect(recipe.photoLarge).toBe("photo_large_data");
        expect(recipe.photoUrl).toBe("https://example.com/photo.jpg");
        expect(recipe.sourceUrl).toBe("https://example.com/source");
        expect(recipe.onFavorites).toBe(true);
        expect(recipe.inTrash).toBe(false);
        expect(recipe.isPinned).toBe(true);
        expect(recipe.onGroceryList).toBe(false);
        expect(recipe.nutritionalInfo).toBe("Calories: 300");

        // Assert fields that don't change names are still present
        expect(recipe.uid).toBe("recipe-123");
        expect(recipe.hash).toBe("hash-abc");
        expect(recipe.name).toBe("Chocolate Cake");
        expect(recipe.ingredients).toBe("2 cups flour, 1 cup sugar");
        expect(recipe.directions).toBe("Mix and bake at 350F");
        expect(recipe.description).toBe("A delicious chocolate cake");
        expect(recipe.rating).toBe(5);
        expect(recipe.created).toBe("2024-01-01T00:00:00Z");
        // #125: GET responses omit `deleted` for live recipes; it defaults to false.
        expect(recipe.deleted).toBe(false);
      }
    });

    it("parses an explicit deleted: true from the empty-trash wire shape (#125)", () => {
      const result = RecipeSchema.safeParse({
        uid: "recipe-123",
        hash: "hash-abc",
        name: "Trashed Cake",
        categories: [],
        ingredients: "flour",
        directions: "bake",
        description: null,
        notes: null,
        prep_time: null,
        cook_time: null,
        total_time: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01 00:00:00",
        image_url: null,
        photo: null,
        photo_hash: null,
        photo_large: null,
        photo_url: null,
        source: null,
        source_url: null,
        on_favorites: false,
        in_trash: true,
        is_pinned: false,
        on_grocery_list: false,
        scale: null,
        nutritional_info: null,
        deleted: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(true);
        expect(result.data.inTrash).toBe(true);
      }
    });
  });

  describe("paprika-types.AC1.3: Recipe.imageUrl is non-optional string", () => {
    it("should have imageUrl as string (not optional or nullable)", () => {
      const snakeCaseRecipe = {
        uid: "recipe-123",
        hash: "hash-abc",
        name: "Test Recipe",
        categories: [],
        ingredients: "flour",
        directions: "bake",
        description: null,
        notes: null,
        prep_time: null,
        cook_time: null,
        total_time: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01T00:00:00Z",
        image_url: "https://example.com/test.jpg",
        photo: null,
        photo_hash: null,
        photo_large: null,
        photo_url: null,
        source: null,
        source_url: null,
        on_favorites: false,
        in_trash: false,
        is_pinned: false,
        on_grocery_list: false,
        scale: null,
        nutritional_info: null,
      };

      const result = RecipeSchema.safeParse(snakeCaseRecipe);
      expect(result.success).toBe(true);

      if (result.success) {
        const recipe = result.data;
        expect(typeof recipe.imageUrl).toBe("string");
        expect(recipe.imageUrl).toBe("https://example.com/test.jpg");

        // Compile-time check: imageUrl cannot be null
        // @ts-expect-error imageUrl is string, not string | null
        const _testNull: null = recipe.imageUrl;
      }
    });
  });

  describe("paprika-types.AC1.4: Recipe.categories is branded CategoryUid[]", () => {
    it("should parse categories as CategoryUid array", () => {
      const snakeCaseRecipe = {
        uid: "recipe-123",
        hash: "hash-abc",
        name: "Test",
        categories: ["cat-1", "cat-2"],
        ingredients: "flour",
        directions: "bake",
        description: null,
        notes: null,
        prep_time: null,
        cook_time: null,
        total_time: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01T00:00:00Z",
        image_url: "https://example.com/test.jpg",
        photo: null,
        photo_hash: null,
        photo_large: null,
        photo_url: null,
        source: null,
        source_url: null,
        on_favorites: false,
        in_trash: false,
        is_pinned: false,
        on_grocery_list: false,
        scale: null,
        nutritional_info: null,
      };

      const result = RecipeSchema.safeParse(snakeCaseRecipe);
      expect(result.success).toBe(true);

      if (result.success) {
        const recipe = result.data;
        expect(Array.isArray(recipe.categories)).toBe(true);
        expect(recipe.categories.length).toBe(2);
        expect(recipe.categories[0]).toBe("cat-1");
        expect(recipe.categories[1]).toBe("cat-2");

        // Compile-time check: categories[0] is CategoryUid, not plain string
        const plainStr = "not-a-category-uid";
        // @ts-expect-error plain string is not assignable to CategoryUid
        const _testBrand: (typeof recipe.categories)[number] = plainStr;
      }
    });
  });

  describe("paprika-types.AC1.5: CategorySchema parses with camelCase output", () => {
    it("should parse snake_case category and output camelCase", () => {
      const snakeCaseCategory = {
        uid: "cat-1",
        name: "Desserts",
        order_flag: 0,
        parent_uid: null,
      };

      const result = CategorySchema.safeParse(snakeCaseCategory);
      expect(result.success).toBe(true);

      if (result.success) {
        const category = result.data;
        expect(category.orderFlag).toBe(0);
        expect(category.parentUid).toBe(null);
        expect(category.uid).toBe("cat-1");
        expect(category.name).toBe("Desserts");
      }
    });

    it("should preserve values through transformation", () => {
      const snakeCaseCategory = {
        uid: "cat-2",
        name: "Main Courses",
        order_flag: 5,
        parent_uid: "parent-cat",
      };

      const result = CategorySchema.safeParse(snakeCaseCategory);
      expect(result.success).toBe(true);

      if (result.success) {
        const category = result.data;
        expect(category.orderFlag).toBe(5);
        expect(category.parentUid).toBe("parent-cat");
      }
    });
  });

  describe("paprika-types.AC1.6: AuthResponseSchema parses nested token", () => {
    it("should parse {result: {token: '...'}} successfully", () => {
      const authResponse = {
        result: {
          token: "test-jwt-token",
        },
      };

      const result = AuthResponseSchema.safeParse(authResponse);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.result.token).toBe("test-jwt-token");
      }
    });
  });

  describe("paprika-types.AC1.9: RecipeSchema coerces null ingredients/directions to empty string", () => {
    // Paprika's API returns `null` for `ingredients` and `directions` when a
    // recipe has them empty (e.g. stub recipes imported from a photo). A
    // single null-bearing recipe would otherwise abort initial sync via Zod
    // validation — see issue #76.
    it("should accept wire JSON with ingredients: null and directions: null", () => {
      const snakeCaseRecipe = {
        uid: "recipe-123",
        hash: "hash-abc",
        name: "Stub Recipe",
        categories: [],
        ingredients: null,
        directions: null,
        description: null,
        notes: null,
        prep_time: null,
        cook_time: null,
        total_time: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01T00:00:00Z",
        image_url: null,
        photo: null,
        photo_hash: null,
        photo_large: null,
        photo_url: null,
        source: null,
        source_url: null,
        on_favorites: false,
        in_trash: false,
        is_pinned: false,
        on_grocery_list: false,
        scale: null,
        nutritional_info: null,
      };

      const result = RecipeSchema.safeParse(snakeCaseRecipe);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.ingredients).toBe("");
        expect(result.data.directions).toBe("");
        // Compile-time check: ingredients/directions remain string, not string | null
        const _checkIng: string = result.data.ingredients;
        const _checkDir: string = result.data.directions;
        expect(_checkIng).toBe("");
        expect(_checkDir).toBe("");
      }
    });
  });

  describe("paprika-types.AC1.10: RecipeStoredSchema coerces null ingredients/directions to empty string", () => {
    // Disk format mirrors the wire-format coercion so that a recipe with
    // null ingredients/directions written by an older client still parses
    // cleanly on read-back.
    it("should accept stored JSON with ingredients: null and directions: null", () => {
      const storedRecipe = {
        uid: "recipe-123",
        hash: "hash-abc",
        name: "Stub Recipe",
        categories: [],
        ingredients: null,
        directions: null,
        description: null,
        notes: null,
        prepTime: null,
        cookTime: null,
        totalTime: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01T00:00:00Z",
        imageUrl: null,
        photo: null,
        photoHash: null,
        photoLarge: null,
        photoUrl: null,
        source: null,
        sourceUrl: null,
        onFavorites: false,
        inTrash: false,
        isPinned: false,
        onGroceryList: false,
        scale: null,
        nutritionalInfo: null,
      };

      const result = RecipeStoredSchema.safeParse(storedRecipe);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.ingredients).toBe("");
        expect(result.data.directions).toBe("");
      }
    });
  });

  describe("paprika-types.AC1.7: RecipeSchema rejects missing required fields", () => {
    it("should reject recipe missing name and ingredients", () => {
      const incompleteRecipe = {
        uid: "recipe-123",
        hash: "hash-abc",
        // missing name
        categories: [],
        // missing ingredients
        directions: "bake",
        description: null,
        notes: null,
        prep_time: null,
        cook_time: null,
        total_time: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01T00:00:00Z",
        image_url: "https://example.com/test.jpg",
        photo: null,
        photo_hash: null,
        photo_large: null,
        photo_url: null,
        source: null,
        source_url: null,
        on_favorites: false,
        in_trash: false,
        is_pinned: false,
        on_grocery_list: false,
        scale: null,
        nutritional_info: null,
      };

      const result = RecipeSchema.safeParse(incompleteRecipe);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error).toBeInstanceOf(z.ZodError);
      }
    });

    it("should reject recipe missing all fields", () => {
      const result = RecipeSchema.safeParse({});
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error).toBeInstanceOf(z.ZodError);
      }
    });
  });
});

describe("Domain Types", () => {
  describe("paprika-types.AC3.1: RecipeInput requires name, ingredients, directions", () => {
    it("should allow object with only required fields", () => {
      const minimalInput: RecipeInput = {
        name: "Simple Recipe",
        ingredients: "flour, water",
        directions: "mix and bake",
      };

      expect(minimalInput.name).toBe("Simple Recipe");
      expect(minimalInput.ingredients).toBe("flour, water");
      expect(minimalInput.directions).toBe("mix and bake");
    });

    it("should allow object with required and optional fields", () => {
      const fullInput: RecipeInput = {
        name: "Complex Recipe",
        ingredients: "flour, eggs, milk",
        directions: "mix and bake",
        description: "A delicious recipe",
        rating: 4,
        onFavorites: true,
      };

      expect(fullInput.name).toBe("Complex Recipe");
      expect(fullInput.description).toBe("A delicious recipe");
      expect(fullInput.rating).toBe(4);
    });

    it("should reject object missing required name field", () => {
      // @ts-expect-error missing required name field
      const invalidInput: RecipeInput = {
        ingredients: "flour",
        directions: "bake",
      };

      expect(invalidInput).toBeDefined();
    });
  });

  describe("paprika-types.AC3.2: RecipeInput excludes uid, hash, created", () => {
    it("should not have uid key", () => {
      type AssertNoUid = "uid" extends keyof RecipeInput ? never : true;
      const _checkNoUid: AssertNoUid = true;
      expect(_checkNoUid).toBe(true);
    });

    it("should not have hash key", () => {
      type AssertNoHash = "hash" extends keyof RecipeInput ? never : true;
      const _checkNoHash: AssertNoHash = true;
      expect(_checkNoHash).toBe(true);
    });

    it("should not have created key", () => {
      type AssertNoCreated = "created" extends keyof RecipeInput ? never : true;
      const _checkNoCreated: AssertNoCreated = true;
      expect(_checkNoCreated).toBe(true);
    });
  });

  describe("paprika-types.AC3.3: SyncResult structure", () => {
    it("should allow empty RecipeSyncResult", () => {
      const emptyRecipeResult: RecipeSyncResult = {
        changeType: "recipes",
        changes: { added: [], updated: [], removedUids: [] },
      };

      expect(emptyRecipeResult.changeType).toBe("recipes");
      expect(emptyRecipeResult.changes.added).toEqual([]);
      expect(emptyRecipeResult.changes.updated).toEqual([]);
      expect(emptyRecipeResult.changes.removedUids).toEqual([]);
    });

    it("should allow empty PantrySyncResult", () => {
      const emptyPantryResult: PantrySyncResult = {
        changeType: "pantry",
        changes: { added: [], updated: [], removedUids: [] },
      };

      expect(emptyPantryResult.changeType).toBe("pantry");
      expect(emptyPantryResult.changes.added).toEqual([]);
      expect(emptyPantryResult.changes.updated).toEqual([]);
      expect(emptyPantryResult.changes.removedUids).toEqual([]);
    });

    it("should have correct property names on SyncResult variants", () => {
      type AssertHasChangeType = "changeType" extends keyof RecipeSyncResult ? true : never;
      type AssertHasChanges = "changes" extends keyof RecipeSyncResult ? true : never;
      type AssertAnySyncResultIsUnion = AnySyncResult extends
        | RecipeSyncResult
        | PantrySyncResult
        | GroceryListSyncResult
        | GroceryItemSyncResult
        | MenuSyncResult
        | MenuItemSyncResult
        ? true
        : never;

      const _checkChangeType: AssertHasChangeType = true;
      const _checkChanges: AssertHasChanges = true;
      const _checkUnion: AssertAnySyncResultIsUnion = true;

      expect(_checkChangeType).toBe(true);
      expect(_checkChanges).toBe(true);
      expect(_checkUnion).toBe(true);
    });
  });

  describe("paprika-types.AC3.4: DiffResult structure", () => {
    it("should allow empty DiffResult", () => {
      const emptyDiffResult: DiffResult = {
        added: [],
        changed: [],
        removed: [],
      };

      expect(emptyDiffResult.added).toEqual([]);
      expect(emptyDiffResult.changed).toEqual([]);
      expect(emptyDiffResult.removed).toEqual([]);
    });

    it("should have correct property names", () => {
      type AssertHasAdded = "added" extends keyof DiffResult ? true : never;
      type AssertHasChanged = "changed" extends keyof DiffResult ? true : never;
      type AssertHasRemoved = "removed" extends keyof DiffResult ? true : never;

      const _checkAdded: AssertHasAdded = true;
      const _checkChanged: AssertHasChanged = true;
      const _checkRemoved: AssertHasRemoved = true;

      expect(_checkAdded).toBe(true);
      expect(_checkChanged).toBe(true);
      expect(_checkRemoved).toBe(true);
    });
  });
});

describe("Type Exports Verification", () => {
  describe("paprika-types.AC5.3: Type-only exports accessible", () => {
    it("should have exported RecipeEntry type", () => {
      // Compile-time verification that RecipeEntry type is accessible
      type CheckRecipeEntry = RecipeEntry;
      const _test: CheckRecipeEntry = { uid: RecipeUidSchema.parse("test"), hash: "test" };
      expect(_test).toBeDefined();
    });

    it("should have exported Recipe type", () => {
      // Compile-time verification that Recipe type is accessible
      type CheckRecipe = Recipe;
      const _testCheck: CheckRecipe = {
        uid: RecipeUidSchema.parse("test"),
        hash: "test",
        name: "Test",
        categories: [],
        ingredients: "test",
        directions: "test",
        description: null,
        notes: null,
        prepTime: null,
        cookTime: null,
        totalTime: null,
        servings: null,
        difficulty: null,
        rating: 0,
        created: "2024-01-01T00:00:00Z",
        imageUrl: "test",
        photo: null,
        photoHash: null,
        photoLarge: null,
        photoUrl: null,
        source: null,
        sourceUrl: null,
        onFavorites: false,
        inTrash: false,
        isPinned: false,
        onGroceryList: false,
        scale: null,
        nutritionalInfo: null,
        deleted: false,
      };
      expect(_testCheck).toBeDefined();
    });

    it("should have exported Category type", () => {
      // Compile-time verification that Category type is accessible
      type CheckCategory = Category;
      const _test: CheckCategory = {
        uid: CategoryUidSchema.parse("test"),
        name: "Test",
        orderFlag: 0,
        parentUid: null,
      };
      expect(_test).toBeDefined();
    });

    it("should have exported AuthResponse type", () => {
      // Compile-time verification that AuthResponse type is accessible
      type CheckAuthResponse = AuthResponse;
      const _test: CheckAuthResponse = {
        result: {
          token: "test-token",
        },
      };
      expect(_test).toBeDefined();
    });
  });
});

describe("pantry-read.AC1: PantryItem types", () => {
  describe("pantry-read.AC1.1: PantryItemSchema transforms snake_case to camelCase", () => {
    it("should parse snake_case wire JSON and transform to camelCase", () => {
      const snakeCasePantryItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: "2026-12-31",
        has_expiration: true,
        in_stock: true,
        purchase_date: "2026-01-01 00:00:00",
        notes: "Store in cool place",
      };

      const result = PantryItemSchema.safeParse(snakeCasePantryItem);
      expect(result.success).toBe(true);

      if (result.success) {
        const item = result.data;
        expect(item.aisleUid).toBe("aisle-1");
        expect(item.expirationDate).toBe("2026-12-31");
        expect(item.hasExpiration).toBe(true);
        expect(item.inStock).toBe(true);
        expect(item.purchaseDate).toBe("2026-01-01 00:00:00");
        expect(item.uid).toBe("pantry-123");
        expect(item.ingredient).toBe("Flour");
        expect(item.quantity).toBe("2 cups");
        expect(item.aisle).toBe("Produce");
        expect(item.notes).toBe("Store in cool place");
      }
    });
  });

  describe("pantry-read.AC1.2: PantryItemStoredSchema validates camelCase with no transform", () => {
    it("should parse camelCase stored JSON without transformation", () => {
      const camelCasePantryItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisleUid: "aisle-1",
        expirationDate: "2026-12-31",
        hasExpiration: true,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: "Store in cool place",
      };

      const result = PantryItemStoredSchema.safeParse(camelCasePantryItem);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data).toEqual({ ...camelCasePantryItem, deleted: false });
      }
    });
  });

  describe("pantry-read.AC1.3: PantryItemUidSchema produces branded type", () => {
    it("should parse UID string and produce branded PantryItemUid", () => {
      const parsed = PantryItemUidSchema.parse("pantry-uid-123");
      const variable: PantryItemUid = parsed;
      expect(variable).toBe("pantry-uid-123");
    });

    it("should not allow plain string to be assigned to branded UID", () => {
      const plainString = "just-a-string";
      // @ts-expect-error plain string should not be assignable to branded PantryItemUid
      const _uid: PantryItemUid = plainString;
      expect(_uid).toBeDefined();
    });
  });

  describe("pantry-read.AC1.4: null expirationDate/purchaseDate/notes accepted", () => {
    it("should accept wire JSON with expiration_date: null", () => {
      const wireItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: null,
        has_expiration: false,
        in_stock: true,
        purchase_date: null,
        notes: null,
      };

      const result = PantryItemSchema.safeParse(wireItem);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.expirationDate).toBe(null);
        expect(result.data.purchaseDate).toBe(null);
        expect(result.data.notes).toBe(null);
      }
    });

    it("should accept stored JSON with expirationDate: null", () => {
      const storedItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisleUid: "aisle-1",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: null,
        notes: null,
      };

      const result = PantryItemStoredSchema.safeParse(storedItem);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.expirationDate).toBe(null);
        expect(result.data.purchaseDate).toBe(null);
        expect(result.data.notes).toBe(null);
      }
    });
  });

  describe("pantry-read.AC1.7: Malformed wire JSON rejected (missing required fields)", () => {
    it("should reject wire JSON missing required ingredient field", () => {
      const malformedItem = {
        uid: "pantry-123",
        // missing ingredient
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: null,
        has_expiration: false,
        in_stock: true,
        purchase_date: null,
        notes: null,
      };

      const result = PantryItemSchema.safeParse(malformedItem);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues[0]!.path.includes("ingredient")).toBe(true);
      }
    });
  });

  describe("Type Exports Verification for PantryItem", () => {
    it("should have exported PantryItem type", () => {
      // Compile-time verification that PantryItem type is accessible
      type CheckPantryItem = PantryItem;
      const _test: CheckPantryItem = {
        uid: PantryItemUidSchema.parse("pantry-123"),
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisleUid: "aisle-1",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: null,
        notes: null,
        deleted: false,
      };
      expect(_test).toBeDefined();
    });
  });
});

describe("aisle-types: Aisle schemas and branded UID", () => {
  describe("aisle-types.AC1: AisleUidSchema accepts both UID formats", () => {
    it("accepts 64-char uppercase hex (default/built-in aisle format)", () => {
      const hexUid = "A".repeat(64);
      const parsed = AisleUidSchema.parse(hexUid);
      const variable: AisleUid = parsed;
      expect(variable).toBe(hexUid);
    });

    it("accepts uppercase UUID v4 (custom/auto-created aisle format)", () => {
      const uuidUid = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890";
      const parsed = AisleUidSchema.parse(uuidUid);
      const variable: AisleUid = parsed;
      expect(variable).toBe(uuidUid);
    });

    it("does not allow a plain string to be assigned to AisleUid", () => {
      const plain = "just-a-string";
      // @ts-expect-error plain string is not assignable to AisleUid
      const _uid: AisleUid = plain;
      expect(_uid).toBeDefined();
    });
  });

  describe("aisle-types.AC2: AisleSchema transforms wire snake_case to camelCase", () => {
    it("transforms order_flag to orderFlag", () => {
      const wire = { uid: "AABBCC", name: "Produce", order_flag: 3 };
      const result = AisleSchema.safeParse(wire);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.orderFlag).toBe(3);
        expect(result.data.name).toBe("Produce");
        expect(result.data.uid).toBe("AABBCC");
      }
    });

    it("defaults deleted to false when absent from wire payload", () => {
      const wire = { uid: "AABBCC", name: "Dairy", order_flag: 1 };
      const result = AisleSchema.safeParse(wire);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });

    it("parses deleted: true from wire payload", () => {
      const wire = { uid: "AABBCC", name: "Old", order_flag: 0, deleted: true };
      const result = AisleSchema.safeParse(wire);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(true);
      }
    });
  });

  describe("aisle-types.AC3: AisleStoredSchema validates camelCase with no transform", () => {
    it("parses camelCase stored JSON without transformation", () => {
      const stored = { uid: "AABBCC", name: "Produce", orderFlag: 3, deleted: false };
      const result = AisleStoredSchema.safeParse(stored);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(stored);
      }
    });

    it("defaults deleted to false when absent from stored JSON", () => {
      const stored = { uid: "AABBCC", name: "Dairy", orderFlag: 1 };
      const result = AisleStoredSchema.safeParse(stored);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });
  });

  describe("aisle-types.AC4: Aisle type export", () => {
    it("exported Aisle type is accessible and structurally correct", () => {
      type CheckAisle = Aisle;
      const _test: CheckAisle = {
        uid: AisleUidSchema.parse("AABB"),
        name: "Produce",
        orderFlag: 2,
        deleted: false,
      };
      expect(_test).toBeDefined();
    });
  });
});

describe("pantry-mutations.AC1: Schema and payload converter", () => {
  describe("pantry-mutations.AC1.1: deleted field round-trips through PantryItemSchema", () => {
    it("should parse wire JSON with deleted: false and round-trip through stored schema", () => {
      const wireItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: "2026-12-31",
        has_expiration: true,
        in_stock: true,
        purchase_date: "2026-01-01 00:00:00",
        notes: "Store in cool place",
        deleted: false,
      };

      const parseResult = PantryItemSchema.safeParse(wireItem);
      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const camelCaseItem = parseResult.data;
        expect(camelCaseItem.deleted).toBe(false);

        // Round-trip through stored schema
        const storedResult = PantryItemStoredSchema.safeParse(camelCaseItem);
        expect(storedResult.success).toBe(true);

        if (storedResult.success) {
          expect(storedResult.data).toEqual(camelCaseItem);
        }
      }
    });
  });

  describe("pantry-mutations.AC1.2: Wire JSON without deleted key yields deleted: false default", () => {
    it("should parse wire JSON omitting deleted key and apply default false", () => {
      const wireItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: "2026-12-31",
        has_expiration: true,
        in_stock: true,
        purchase_date: "2026-01-01 00:00:00",
        notes: "Store in cool place",
      };

      const result = PantryItemSchema.safeParse(wireItem);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });
  });

  describe("pantry-mutations.AC1.3: Stored JSON without deleted key yields deleted: false default", () => {
    it("should parse stored JSON omitting deleted key and apply default false", () => {
      const storedItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisleUid: "aisle-1",
        expirationDate: "2026-12-31",
        hasExpiration: true,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: "Store in cool place",
      };

      const result = PantryItemStoredSchema.safeParse(storedItem);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });
  });

  describe("pantry-mutations.AC1.6: null values for optional fields survive round-trip", () => {
    it("should preserve null values through wire→stored round-trip", () => {
      const wireItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: null,
        has_expiration: false,
        in_stock: true,
        purchase_date: null,
        notes: null,
        deleted: false,
      };

      const parseResult = PantryItemSchema.safeParse(wireItem);
      expect(parseResult.success).toBe(true);

      if (parseResult.success) {
        const camelCaseItem = parseResult.data;
        expect(camelCaseItem.expirationDate).toBe(null);
        expect(camelCaseItem.purchaseDate).toBe(null);
        expect(camelCaseItem.notes).toBe(null);

        // Verify round-trip through stored schema preserves nulls
        const storedResult = PantryItemStoredSchema.safeParse(camelCaseItem);
        expect(storedResult.success).toBe(true);

        if (storedResult.success) {
          expect(storedResult.data.expirationDate).toBe(null);
          expect(storedResult.data.purchaseDate).toBe(null);
          expect(storedResult.data.notes).toBe(null);
        }
      }
    });
  });

  describe("pantry-mutations.AC1.7: Wire JSON with non-boolean deleted is rejected", () => {
    it("should reject wire JSON with deleted as string instead of boolean", () => {
      const wireItem = {
        uid: "pantry-123",
        ingredient: "Flour",
        quantity: "2 cups",
        aisle: "Produce",
        aisle_uid: "aisle-1",
        expiration_date: "2026-12-31",
        has_expiration: true,
        in_stock: true,
        purchase_date: "2026-01-01 00:00:00",
        notes: "Store in cool place",
        deleted: "true", // string instead of boolean
      };

      const result = PantryItemSchema.safeParse(wireItem);
      expect(result.success).toBe(false);

      if (!result.success) {
        const deletedError = result.error.issues.find((issue) => issue.path.includes("deleted"));
        expect(deletedError).toBeDefined();
      }
    });
  });
});

describe("Grocery Schema Round-Trips", () => {
  describe("grocery-infra.AC1.1: GroceryList wire and stored round-trip", () => {
    const wireList = {
      uid: "034E15F1-B26F-4665-B19D-C89F0F046AFB",
      name: "My List Name",
      order_flag: 1,
      is_default: false,
      reminders_list: "Paprika",
      deleted: false,
    };

    it("should parse GroceryList wire JSON and transform to camelCase", () => {
      const result = GroceryListSchema.safeParse(wireList);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uid).toBe("034E15F1-B26F-4665-B19D-C89F0F046AFB");
        expect(result.data.name).toBe("My List Name");
        expect(result.data.orderFlag).toBe(1);
        expect(result.data.isDefault).toBe(false);
        expect(result.data.remindersList).toBe("Paprika");
        expect(result.data.deleted).toBe(false);
      }
    });

    it("should round-trip through GroceryListStoredSchema without loss", () => {
      const wireResult = GroceryListSchema.safeParse(wireList);
      expect(wireResult.success).toBe(true);
      if (!wireResult.success) return;

      const storedResult = GroceryListStoredSchema.safeParse(wireResult.data);
      expect(storedResult.success).toBe(true);
      if (storedResult.success) {
        expect(storedResult.data).toEqual(wireResult.data);
      }
    });
  });

  describe("grocery-infra.AC1.2: GroceryItem wire and stored round-trip", () => {
    const wireItem = {
      uid: "12D1EE66-2DC3-4B65-BF4E-71CB050ECD95",
      name: "2 lbs Butter",
      ingredient: "Butter",
      aisle: "Dairy",
      aisle_uid: "F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E",
      list_uid: "034E15F1-B26F-4665-B19D-C89F0F046AFB",
      purchased: false,
      deleted: false,
      order_flag: 0,
      quantity: "2 lbs",
      instruction: "",
      recipe: null,
      separate: false,
    };

    it("should parse GroceryItem wire JSON and transform to camelCase preserving name display format", () => {
      const result = GroceryItemSchema.safeParse(wireItem);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uid).toBe("12D1EE66-2DC3-4B65-BF4E-71CB050ECD95");
        expect(result.data.name).toBe("2 lbs Butter");
        expect(result.data.ingredient).toBe("Butter");
        expect(result.data.aisle).toBe("Dairy");
        expect(result.data.aisleUid).toBe("F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E");
        expect(result.data.listUid).toBe("034E15F1-B26F-4665-B19D-C89F0F046AFB");
        expect(result.data.purchased).toBe(false);
        expect(result.data.deleted).toBe(false);
        expect(result.data.orderFlag).toBe(0);
        expect(result.data.quantity).toBe("2 lbs");
        expect(result.data.instruction).toBe("");
        expect(result.data.recipe).toBeNull();
        expect(result.data.separate).toBe(false);
      }
    });

    it("should round-trip through GroceryItemStoredSchema without loss", () => {
      const wireResult = GroceryItemSchema.safeParse(wireItem);
      expect(wireResult.success).toBe(true);
      if (!wireResult.success) return;

      const storedResult = GroceryItemStoredSchema.safeParse(wireResult.data);
      expect(storedResult.success).toBe(true);
      if (storedResult.success) {
        expect(storedResult.data).toEqual(wireResult.data);
      }
    });
  });

  describe("grocery-infra.AC1.3: GroceryIngredient wire and stored round-trip", () => {
    const wireIngredient = {
      uid: "E72FC5C6-61B3-40D9-B3B8-84437FB6F73B",
      name: "mcp-cap item-1",
      aisle_uid: "F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E",
      deleted: false,
    };

    it("should parse GroceryIngredient wire JSON and transform aisle_uid to aisleUid", () => {
      const result = GroceryIngredientSchema.safeParse(wireIngredient);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.uid).toBe("E72FC5C6-61B3-40D9-B3B8-84437FB6F73B");
        expect(result.data.name).toBe("mcp-cap item-1");
        expect(result.data.aisleUid).toBe("F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E");
        expect(result.data.deleted).toBe(false);
      }
    });

    it("should round-trip through GroceryIngredientStoredSchema without loss", () => {
      const wireResult = GroceryIngredientSchema.safeParse(wireIngredient);
      expect(wireResult.success).toBe(true);
      if (!wireResult.success) return;

      const storedResult = GroceryIngredientStoredSchema.safeParse(wireResult.data);
      expect(storedResult.success).toBe(true);
      if (storedResult.success) {
        expect(storedResult.data).toEqual(wireResult.data);
      }
    });
  });

  describe("grocery-infra.AC1.4: Wire JSON with deleted omitted defaults to false", () => {
    it("should default deleted to false when omitted from GroceryList wire JSON", () => {
      const wireList = {
        uid: "034E15F1-B26F-4665-B19D-C89F0F046AFB",
        name: "My List",
        order_flag: 1,
        is_default: false,
        reminders_list: "Paprika",
        // deleted intentionally omitted
      };

      const result = GroceryListSchema.safeParse(wireList);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });

    it("should default deleted to false when omitted from GroceryItem wire JSON", () => {
      const wireItem = {
        uid: "12D1EE66-2DC3-4B65-BF4E-71CB050ECD95",
        name: "Butter",
        ingredient: "Butter",
        aisle: "Dairy",
        aisle_uid: "F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E",
        list_uid: "034E15F1-B26F-4665-B19D-C89F0F046AFB",
        purchased: false,
        // deleted intentionally omitted
        order_flag: 0,
        quantity: "",
        instruction: "",
        recipe: null,
        separate: false,
      };

      const result = GroceryItemSchema.safeParse(wireItem);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });

    it("should default deleted to false when omitted from GroceryIngredient wire JSON", () => {
      const wireIngredient = {
        uid: "E72FC5C6-61B3-40D9-B3B8-84437FB6F73B",
        name: "mcp-cap item-1",
        aisle_uid: "F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E",
        // deleted intentionally omitted
      };

      const result = GroceryIngredientSchema.safeParse(wireIngredient);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleted).toBe(false);
      }
    });
  });
});

describe("grocery-infra: null aisle_uid coerces to empty-string sentinel", () => {
  // Paprika returns aisle_uid: null for entities with no assigned aisle (e.g. an
  // ingredient added to a list without an aisle). The wire schemas accept null and
  // collapse it to the established "" = no-aisle sentinel so the stored schema's
  // aisleUid: z.string() still holds. Regression guard: a single such row used to
  // throw mid-sync and abort the whole cycle before meals/menus synced.
  it('GroceryIngredientSchema maps aisle_uid: null to aisleUid: ""', () => {
    const result = GroceryIngredientSchema.safeParse({
      uid: "E72FC5C6-61B3-40D9-B3B8-84437FB6F73B",
      name: "baby formula",
      aisle_uid: null,
      deleted: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aisleUid).toBe("");
      expect(GroceryIngredientStoredSchema.safeParse(result.data).success).toBe(true);
    }
  });

  it('GroceryItemSchema maps aisle_uid: null to aisleUid: ""', () => {
    const result = GroceryItemSchema.safeParse({
      uid: "12D1EE66-2DC3-4B65-BF4E-71CB050ECD95",
      name: "Butter",
      ingredient: "Butter",
      aisle: "",
      aisle_uid: null,
      list_uid: "034E15F1-B26F-4665-B19D-C89F0F046AFB",
      purchased: false,
      deleted: false,
      order_flag: 0,
      quantity: "",
      instruction: "",
      recipe: null,
      separate: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aisleUid).toBe("");
      expect(GroceryItemStoredSchema.safeParse(result.data).success).toBe(true);
    }
  });

  it('PantryItemSchema maps aisle_uid: null to aisleUid: ""', () => {
    const result = PantryItemSchema.safeParse({
      uid: "pantry-123",
      ingredient: "Flour",
      quantity: "2 cups",
      aisle: "",
      aisle_uid: null,
      expiration_date: null,
      has_expiration: false,
      in_stock: true,
      purchase_date: null,
      notes: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aisleUid).toBe("");
      expect(PantryItemStoredSchema.safeParse(result.data).success).toBe(true);
    }
  });
});

describe("meal-payload: mealToApiPayload round-trip via MealSchema", () => {
  const wireMeal = {
    uid: "MEAL-UID-123",
    recipe_uid: "RECIPE-UID-456",
    name: "Chicken Stir Fry",
    date: "2026-06-15 00:00:00",
    type: 2,
    type_uid: "TYPE-UID-789",
    order_flag: 0,
    is_ingredient: false,
    scale: "2x",
    deleted: false,
  };

  it("round-trips through MealSchema.parse and back to the same camelCase shape", () => {
    const parsed: Meal = MealSchema.parse(wireMeal);
    const payload = mealToApiPayload(parsed);
    const roundTripped: Meal = MealSchema.parse(payload);
    expect(roundTripped).toEqual(parsed);
  });

  it("produces all 10 expected snake_case keys in the payload", () => {
    const parsed: Meal = MealSchema.parse(wireMeal);
    const payload = mealToApiPayload(parsed);
    const keys = Object.keys(payload);
    expect(keys).toEqual(
      expect.arrayContaining([
        "uid",
        "recipe_uid",
        "name",
        "date",
        "type",
        "type_uid",
        "order_flag",
        "is_ingredient",
        "scale",
        "deleted",
      ]),
    );
    expect(keys).toHaveLength(10);
  });

  it("passes null fields through unchanged", () => {
    const nullWireMeal = {
      uid: "MEAL-UID-NULL",
      recipe_uid: null,
      name: "Null Meal",
      date: "2026-06-15 00:00:00",
      type: 0,
      type_uid: null,
      order_flag: 1,
      is_ingredient: false,
      scale: null,
      deleted: false,
    };
    const parsed: Meal = MealSchema.parse(nullWireMeal);
    const payload = mealToApiPayload(parsed);
    expect(payload["recipe_uid"]).toBeNull();
    expect(payload["type_uid"]).toBeNull();
    expect(payload["scale"]).toBeNull();
  });

  it("propagates deleted: true back to the payload", () => {
    const deletedWireMeal = { ...wireMeal, deleted: true };
    const parsed: Meal = MealSchema.parse(deletedWireMeal);
    const payload = mealToApiPayload(parsed);
    expect(payload["deleted"]).toBe(true);
  });
});

describe("menu-infra: Menu schema round-trips", () => {
  const wireMenu = {
    uid: "13A42BA9-4C06-4FDC-A5DB-AE9191DF5251",
    name: "[mcp-cap] Test Menu 1",
    days: 3,
    order_flag: 2,
    notes: "Weeknight plan",
    deleted: false,
  };

  it("parses Menu wire JSON and transforms order_flag to orderFlag", () => {
    const result = MenuSchema.safeParse(wireMenu);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uid).toBe("13A42BA9-4C06-4FDC-A5DB-AE9191DF5251");
      expect(result.data.name).toBe("[mcp-cap] Test Menu 1");
      expect(result.data.days).toBe(3);
      expect(result.data.orderFlag).toBe(2);
      expect(result.data.notes).toBe("Weeknight plan");
      expect(result.data.deleted).toBe(false);
    }
  });

  it("round-trips through MenuStoredSchema without loss", () => {
    const wireResult = MenuSchema.safeParse(wireMenu);
    expect(wireResult.success).toBe(true);
    if (!wireResult.success) return;

    const storedResult = MenuStoredSchema.safeParse(wireResult.data);
    expect(storedResult.success).toBe(true);
    if (storedResult.success) {
      expect(storedResult.data).toEqual(wireResult.data);
    }
  });

  it("defaults deleted to false when omitted from wire JSON", () => {
    const { deleted: _deleted, ...withoutDeleted } = wireMenu;
    const result = MenuSchema.safeParse(withoutDeleted);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(false);
    }
  });

  it("menuToApiPayload round-trips through MenuSchema and produces 6 snake_case keys", () => {
    const parsed: Menu = MenuSchema.parse(wireMenu);
    const payload = menuToApiPayload(parsed);
    const roundTripped: Menu = MenuSchema.parse(payload);
    expect(roundTripped).toEqual(parsed);

    const keys = Object.keys(payload);
    expect(keys).toEqual(expect.arrayContaining(["uid", "name", "days", "order_flag", "notes", "deleted"]));
    expect(keys).toHaveLength(6);
    expect(payload).not.toHaveProperty("orderFlag");
  });

  it("propagates deleted: true back to the payload", () => {
    const parsed: Menu = MenuSchema.parse({ ...wireMenu, deleted: true });
    const payload = menuToApiPayload(parsed);
    expect(payload["deleted"]).toBe(true);
  });
});

describe("menu-infra: MenuItem schema round-trips", () => {
  const wireItem = {
    uid: "D7911C7C-0F3C-4A47-ACA3-2964D831EA69",
    menu_uid: "13A42BA9-4C06-4FDC-A5DB-AE9191DF5251",
    recipe_uid: "3AF6BDB7-4EA5-444C-A00A-1C5C989DE1E1-6735-000003A768881804",
    name: "Bacon Broccoli Cheddar Crustless Quiche",
    day: 1,
    type_uid: "913D33C7FD39DB8C8C4514669B011F617D911345592CC77B309B812667959720",
    order_flag: 0,
    deleted: false,
  };

  it("parses MenuItem wire JSON and transforms snake_case keys to camelCase", () => {
    const result = MenuItemSchema.safeParse(wireItem);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uid).toBe("D7911C7C-0F3C-4A47-ACA3-2964D831EA69");
      expect(result.data.menuUid).toBe("13A42BA9-4C06-4FDC-A5DB-AE9191DF5251");
      expect(result.data.recipeUid).toBe("3AF6BDB7-4EA5-444C-A00A-1C5C989DE1E1-6735-000003A768881804");
      expect(result.data.name).toBe("Bacon Broccoli Cheddar Crustless Quiche");
      expect(result.data.day).toBe(1);
      expect(result.data.typeUid).toBe("913D33C7FD39DB8C8C4514669B011F617D911345592CC77B309B812667959720");
      expect(result.data.orderFlag).toBe(0);
      expect(result.data.deleted).toBe(false);
    }
  });

  it("round-trips through MenuItemStoredSchema without loss", () => {
    const wireResult = MenuItemSchema.safeParse(wireItem);
    expect(wireResult.success).toBe(true);
    if (!wireResult.success) return;

    const storedResult = MenuItemStoredSchema.safeParse(wireResult.data);
    expect(storedResult.success).toBe(true);
    if (storedResult.success) {
      expect(storedResult.data).toEqual(wireResult.data);
    }
  });

  it("accepts null menu_uid (cascade-delete tombstone) and null recipe_uid", () => {
    const result = MenuItemSchema.safeParse({ ...wireItem, menu_uid: null, recipe_uid: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.menuUid).toBeNull();
      expect(result.data.recipeUid).toBeNull();
    }
  });

  it("defaults deleted to false when omitted from wire JSON", () => {
    const { deleted: _deleted, ...withoutDeleted } = wireItem;
    const result = MenuItemSchema.safeParse(withoutDeleted);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(false);
    }
  });

  it("menuItemToApiPayload round-trips through MenuItemSchema and produces 8 snake_case keys", () => {
    const parsed: MenuItem = MenuItemSchema.parse(wireItem);
    const payload = menuItemToApiPayload(parsed);
    const roundTripped: MenuItem = MenuItemSchema.parse(payload);
    expect(roundTripped).toEqual(parsed);

    const keys = Object.keys(payload);
    expect(keys).toEqual(
      expect.arrayContaining(["uid", "menu_uid", "recipe_uid", "name", "day", "type_uid", "order_flag", "deleted"]),
    );
    expect(keys).toHaveLength(8);
    expect(payload).not.toHaveProperty("menuUid");
    expect(payload).not.toHaveProperty("recipeUid");
    expect(payload).not.toHaveProperty("typeUid");
    expect(payload).not.toHaveProperty("orderFlag");
  });

  it("passes null menu_uid / recipe_uid through the payload unchanged", () => {
    const parsed: MenuItem = MenuItemSchema.parse({ ...wireItem, menu_uid: null, recipe_uid: null });
    const payload = menuItemToApiPayload(parsed);
    expect(payload["menu_uid"]).toBeNull();
    expect(payload["recipe_uid"]).toBeNull();
  });

  it("MenuSyncResult and MenuItemSyncResult are members of AnySyncResult", () => {
    const menuResult: MenuSyncResult = {
      changeType: "menus",
      changes: { added: [], updated: [], removedUids: [] },
    };
    const menuItemResult: MenuItemSyncResult = {
      changeType: "menu-items",
      changes: { added: [], updated: [], removedUids: [] },
    };
    const asAny: ReadonlyArray<AnySyncResult> = [menuResult, menuItemResult];

    expect(asAny[0]!.changeType).toBe("menus");
    expect(asAny[1]!.changeType).toBe("menu-items");
  });
});

describe("photo-infra: Photo schema round-trips", () => {
  // The GET /sync/photos/ catalog row carries six fields — `deleted` is a
  // write-only soft-delete flag and is absent on read.
  const wirePhoto = {
    uid: "2D6BAA0F-9C3E-4A1B-8E2D-1F0A9B8C7D6E",
    recipe_uid: "3AF6BDB7-4EA5-444C-A00A-1C5C989DE1E1",
    filename: "2D6BAA0F-9C3E-4A1B-8E2D-1F0A9B8C7D6E.jpg",
    name: "1",
    order_flag: 0,
    hash: "0F1E2D3C4B5A69788796A5B4C3D2E1F00F1E2D3C4B5A69788796A5B4C3D2E1F0",
  };

  it("parses Photo wire JSON, maps snake_case keys, and defaults deleted to false", () => {
    const result = PhotoSchema.safeParse(wirePhoto);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uid).toBe(wirePhoto.uid);
      expect(result.data.recipeUid).toBe(wirePhoto.recipe_uid);
      expect(result.data.filename).toBe(wirePhoto.filename);
      expect(result.data.name).toBe("1");
      expect(result.data.orderFlag).toBe(0);
      expect(result.data.hash).toBe(wirePhoto.hash);
      expect(result.data.deleted).toBe(false);
    }
  });

  it("round-trips through PhotoStoredSchema without loss", () => {
    const wireResult = PhotoSchema.safeParse(wirePhoto);
    expect(wireResult.success).toBe(true);
    if (!wireResult.success) return;

    const storedResult = PhotoStoredSchema.safeParse(wireResult.data);
    expect(storedResult.success).toBe(true);
    if (storedResult.success) {
      expect(storedResult.data).toEqual(wireResult.data);
    }
  });

  it("photoToApiPayload round-trips through PhotoSchema and produces 7 snake_case keys", () => {
    const parsed: Photo = PhotoSchema.parse({ ...wirePhoto, deleted: true });
    const payload = photoToApiPayload(parsed);
    const roundTripped: Photo = PhotoSchema.parse(payload);
    expect(roundTripped).toEqual(parsed);

    const keys = Object.keys(payload);
    expect(keys).toEqual(
      expect.arrayContaining(["uid", "recipe_uid", "filename", "name", "order_flag", "hash", "deleted"]),
    );
    expect(keys).toHaveLength(7);
    expect(payload).not.toHaveProperty("recipeUid");
    expect(payload).not.toHaveProperty("orderFlag");
    expect(payload["deleted"]).toBe(true);
  });

  it("upholds the name == String(order_flag + 1) gallery invariant for the second photo", () => {
    const second = PhotoSchema.parse({ ...wirePhoto, order_flag: 1, name: "2" });
    expect(second.name).toBe(String(second.orderFlag + 1));
  });
});
