import type { SetRequired } from "type-fest";
import { z } from "zod";

import { CategoryUidSchema, RecipeUidSchema } from "../../ids.js";

// Entry schemas for sync list endpoints
export const RecipeEntrySchema = z.object({
  uid: RecipeUidSchema,
  hash: z.string(),
});

// Derived entry types via z.infer<>
export type RecipeEntry = z.infer<typeof RecipeEntrySchema>;

// StoredSchema — validates camelCase JSON read back from disk. No transform.
export const RecipeStoredSchema = z.object({
  uid: RecipeUidSchema,
  hash: z.string(),
  name: z.string(),
  categories: z.array(CategoryUidSchema),
  // Paprika's API returns `null` for `ingredients` and `directions` when a
  // recipe leaves them empty (e.g. stub recipes imported from a photo). Coerce
  // to "" so a single null-bearing recipe cannot abort initial sync — see #76.
  ingredients: z
    .string()
    .nullable()
    .transform((v) => v ?? ""),
  directions: z
    .string()
    .nullable()
    .transform((v) => v ?? ""),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  prepTime: z.string().nullable(),
  cookTime: z.string().nullable(),
  totalTime: z.string().nullable(),
  servings: z.string().nullable(),
  difficulty: z.string().nullable(),
  rating: z.number().int(),
  created: z.string(),
  imageUrl: z.string().nullable(),
  photo: z.string().nullable(),
  photoHash: z.string().nullable(),
  photoLarge: z.string().nullable(),
  photoUrl: z.string().nullable(),
  source: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  onFavorites: z.boolean(),
  inTrash: z.boolean(),
  isPinned: z.boolean(),
  onGroceryList: z.boolean(),
  scale: z.string().nullable(),
  nutritionalInfo: z.string().nullable(),
  // Hard-delete (empty-trash) tombstone. Live recipes omit it on the wire and on
  // disk, so it defaults to false — same optional().default(false) pattern as the
  // other entities. POSTing deleted:true alongside in_trash:true empties the recipe
  // from the trash server-side, echoing the recipe's existing hash verbatim (#125).
  deleted: z.boolean().optional().default(false),
});

// Recipe type derived from RecipeStoredSchema.
export type Recipe = z.infer<typeof RecipeStoredSchema>;

// RecipeSchema — accepts snake_case wire format, transforms to camelCase Recipe.
// The `: Recipe` annotation on the transform return ensures the compiler enforces
// that RecipeSchema's output is always structurally identical to RecipeStoredSchema.
export const RecipeSchema = z
  .object({
    uid: RecipeUidSchema,
    hash: z.string(),
    name: z.string(),
    categories: z.array(CategoryUidSchema),
    // Coerce null → "" to match the wire format (see RecipeStoredSchema and #76).
    ingredients: z
      .string()
      .nullable()
      .transform((v) => v ?? ""),
    directions: z
      .string()
      .nullable()
      .transform((v) => v ?? ""),
    description: z.string().nullable(),
    notes: z.string().nullable(),
    prep_time: z.string().nullable(),
    cook_time: z.string().nullable(),
    total_time: z.string().nullable(),
    servings: z.string().nullable(),
    difficulty: z.string().nullable(),
    rating: z.number().int(),
    created: z.string(),
    image_url: z.string().nullable(),
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
    // Wire name matches the stored name (`deleted`), so it passes through the
    // transform untouched via ...rest — no destructuring/rename needed (#125).
    deleted: z.boolean().optional().default(false),
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
    }): Recipe => ({
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

// Domain input type for recipe-create tools.
export type RecipeInput = SetRequired<
  Partial<Omit<Recipe, "uid" | "hash" | "created">>,
  "name" | "ingredients" | "directions"
>;
