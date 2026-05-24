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

// StoredSchema — validates camelCase JSON read back from disk. No transform.
export const CategoryStoredSchema = z.object({
  uid: CategoryUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  parentUid: z.string().nullable(),
});

// Category type derived from CategoryStoredSchema.
export type Category = z.infer<typeof CategoryStoredSchema>;

// CategorySchema — accepts snake_case wire format, transforms to camelCase Category.
export const CategorySchema = z
  .object({
    uid: CategoryUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    parent_uid: z.string().nullable(),
  })
  .transform(
    ({ order_flag, parent_uid, ...rest }): Category => ({
      ...rest,
      orderFlag: order_flag,
      parentUid: parent_uid,
    }),
  );

// Branded UID schemas for aisles
export const AisleUidSchema = z.string().brand("AisleUid");

// Derived UID type via z.infer<>
export type AisleUid = z.infer<typeof AisleUidSchema>;

// AisleStoredSchema — validates camelCase JSON read back from disk. No transform.
export const AisleStoredSchema = z.object({
  uid: AisleUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  deleted: z.boolean().optional().default(false),
});

// Aisle type derived from AisleStoredSchema.
export type Aisle = z.infer<typeof AisleStoredSchema>;

// AisleSchema — accepts snake_case wire format, transforms to camelCase Aisle.
export const AisleSchema = z
  .object({
    uid: AisleUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ order_flag, ...rest }): Aisle => ({
      ...rest,
      orderFlag: order_flag,
    }),
  );

// Branded UID schemas for pantry items
export const PantryItemUidSchema = z.string().brand("PantryItemUid");

// Derived UID type via z.infer<>
export type PantryItemUid = z.infer<typeof PantryItemUidSchema>;

// PantryItemStoredSchema — validates camelCase JSON read back from disk. No transform.
export const PantryItemStoredSchema = z.object({
  uid: PantryItemUidSchema,
  ingredient: z.string(),
  quantity: z.string(),
  aisle: z.string(),
  aisleUid: z.string(),
  expirationDate: z.string().nullable(),
  hasExpiration: z.boolean(),
  inStock: z.boolean(),
  purchaseDate: z.string().nullable(),
  notes: z.string().nullable(),
  deleted: z.boolean().optional().default(false),
});

// PantryItem type derived from PantryItemStoredSchema.
export type PantryItem = z.infer<typeof PantryItemStoredSchema>;

// PantryItemSchema — accepts snake_case wire format, transforms to camelCase PantryItem.
// The `: PantryItem` annotation on the transform return ensures the compiler enforces
// that PantryItemSchema's output is always structurally identical to PantryItemStoredSchema.
export const PantryItemSchema = z
  .object({
    uid: PantryItemUidSchema,
    ingredient: z.string(),
    quantity: z.string(),
    aisle: z.string(),
    aisle_uid: z.string(),
    expiration_date: z.string().nullable(),
    has_expiration: z.boolean(),
    in_stock: z.boolean(),
    purchase_date: z.string().nullable(),
    notes: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ aisle_uid, expiration_date, has_expiration, in_stock, purchase_date, ...rest }): PantryItem => ({
      ...rest,
      aisleUid: aisle_uid,
      expirationDate: expiration_date,
      hasExpiration: has_expiration,
      inStock: in_stock,
      purchaseDate: purchase_date,
    }),
  );

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

export type EntityChanges<T> = {
  readonly added: ReadonlyArray<T>;
  readonly updated: ReadonlyArray<T>;
  readonly removedUids: ReadonlyArray<string>;
};

// Closed set of entity types sync can produce. Adding a new entity type here
// requires extending this union deliberately.
export type SyncEntityType = "recipes" | "pantry";

// K is locked to SyncEntityType; T is the entity item type.
export type SyncResult<K extends SyncEntityType, T extends object> = {
  readonly changeType: K;
  readonly changes: EntityChanges<T>;
};

export type RecipeSyncResult = SyncResult<"recipes", Recipe>;
export type PantrySyncResult = SyncResult<"pantry", PantryItem>;

// Union used as the sync:complete event payload.
export type AnySyncResult = RecipeSyncResult | PantrySyncResult;

export type DiffResult = {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};
