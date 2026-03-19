import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  RecipeUidSchema,
  CategoryUidSchema,
  RecipeEntrySchema,
  RecipeSchema,
  CategorySchema,
  AuthResponseSchema,
  type RecipeUid,
  type CategoryUid,
  type RecipeEntry,
  type Recipe,
  type Category,
  type AuthResponse,
  type RecipeInput,
  type SyncResult,
  type DiffResult,
} from "./types.js";

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
    it("should allow empty SyncResult", () => {
      const emptySyncResult: SyncResult = {
        added: [],
        updated: [],
        removedUids: [],
      };

      expect(emptySyncResult.added).toEqual([]);
      expect(emptySyncResult.updated).toEqual([]);
      expect(emptySyncResult.removedUids).toEqual([]);
    });

    it("should have correct property names", () => {
      type AssertHasAdded = "added" extends keyof SyncResult ? true : never;
      type AssertHasUpdated = "updated" extends keyof SyncResult ? true : never;
      type AssertHasRemovedUids = "removedUids" extends keyof SyncResult ? true : never;

      const _checkAdded: AssertHasAdded = true;
      const _checkUpdated: AssertHasUpdated = true;
      const _checkRemovedUids: AssertHasRemovedUids = true;

      expect(_checkAdded).toBe(true);
      expect(_checkUpdated).toBe(true);
      expect(_checkRemovedUids).toBe(true);
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
