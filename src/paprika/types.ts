import { z } from "zod";
import type { SetRequired } from "type-fest";

// Branded UID schemas using z.string().brand()
export const RecipeUidSchema = z.string().brand("RecipeUid");
export const CategoryUidSchema = z.string().brand("CategoryUid");

// Derived UID types via z.infer<>
export type RecipeUid = z.infer<typeof RecipeUidSchema>;
export type CategoryUid = z.infer<typeof CategoryUidSchema>;

// Entry schemas for sync list endpoints
export const RecipeEntrySchema = z.object({
  uid: RecipeUidSchema,
  hash: z.string(),
});

export const CategoryEntrySchema = z.object({
  uid: CategoryUidSchema,
  hash: z.string(),
});

// Derived entry types via z.infer<>
export type RecipeEntry = z.infer<typeof RecipeEntrySchema>;
export type CategoryEntry = z.infer<typeof CategoryEntrySchema>;

// RecipeSchema - accepts snake_case wire format, outputs camelCase
export const RecipeSchema = z
  .object({
    uid: RecipeUidSchema,
    hash: z.string(),
    name: z.string(),
    categories: z.array(CategoryUidSchema),
    ingredients: z.string(),
    directions: z.string(),
    description: z.string().nullable(),
    notes: z.string().nullable(),
    prep_time: z.string().nullable(),
    cook_time: z.string().nullable(),
    total_time: z.string().nullable(),
    servings: z.string().nullable(),
    difficulty: z.string().nullable(),
    rating: z.number().int(),
    created: z.string(),
    image_url: z.string(),
    photo: z.string().nullable(),
    photo_hash: z.string().nullable(),
    photo_large: z.string().nullable(),
    photo_url: z.string().nullable(),
    source: z.string().nullable(),
    source_url: z.string().nullable(),
    on_favorites: z.boolean(),
    in_trash: z.boolean(),
    is_pinned: z.boolean(),
    on_grocery_list: z.boolean(),
    scale: z.string().nullable(),
    nutritional_info: z.string().nullable(),
  })
  .transform(
    ({
      image_url,
      prep_time,
      cook_time,
      total_time,
      photo_hash,
      photo_large,
      photo_url,
      source_url,
      on_favorites,
      in_trash,
      is_pinned,
      on_grocery_list,
      nutritional_info,
      ...rest
    }) => ({
      ...rest,
      imageUrl: image_url,
      prepTime: prep_time,
      cookTime: cook_time,
      totalTime: total_time,
      photoHash: photo_hash,
      photoLarge: photo_large,
      photoUrl: photo_url,
      sourceUrl: source_url,
      onFavorites: on_favorites,
      inTrash: in_trash,
      isPinned: is_pinned,
      onGroceryList: on_grocery_list,
      nutritionalInfo: nutritional_info,
    }),
  );

export type Recipe = z.output<typeof RecipeSchema>;

// CategorySchema - accepts snake_case wire format, outputs camelCase
export const CategorySchema = z
  .object({
    uid: CategoryUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    parent_uid: z.string().nullable(),
  })
  .transform(({ order_flag, parent_uid, ...rest }) => ({
    ...rest,
    orderFlag: order_flag,
    parentUid: parent_uid,
  }));

export type Category = z.output<typeof CategorySchema>;

// AuthResponseSchema - nested object, no transform needed
export const AuthResponseSchema = z.object({
  result: z.object({
    token: z.string(),
  }),
});

export type AuthResponse = z.output<typeof AuthResponseSchema>;

// Domain types for application use
export type RecipeInput = SetRequired<
  Partial<Omit<Recipe, "uid" | "hash" | "created">>,
  "name" | "ingredients" | "directions"
>;

export type SyncResult = {
  readonly added: ReadonlyArray<Recipe>;
  readonly updated: ReadonlyArray<Recipe>;
  readonly removedUids: ReadonlyArray<string>;
};

export type DiffResult = {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};
