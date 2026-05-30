import { z } from "zod";
import type { SetRequired } from "type-fest";

// Branded UID schemas using z.string().brand()
export const RecipeUidSchema = z.string().min(1).brand("RecipeUid");
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
export const PantryItemUidSchema = z.string().min(1).brand("PantryItemUid");

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
    aisle_uid: z.string().nullable(),
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
      aisleUid: aisle_uid ?? "",
      expirationDate: expiration_date,
      hasExpiration: has_expiration,
      inStock: in_stock,
      purchaseDate: purchase_date,
    }),
  );

// Branded UID schemas for grocery entities
export const GroceryListUidSchema = z.string().min(1).brand("GroceryListUid");
export type GroceryListUid = z.infer<typeof GroceryListUidSchema>;

export const GroceryItemUidSchema = z.string().min(1).brand("GroceryItemUid");
export type GroceryItemUid = z.infer<typeof GroceryItemUidSchema>;

export const GroceryIngredientUidSchema = z.string().brand("GroceryIngredientUid");
export type GroceryIngredientUid = z.infer<typeof GroceryIngredientUidSchema>;

// GroceryListStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryListStoredSchema = z.object({
  uid: GroceryListUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  isDefault: z.boolean(),
  remindersList: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type GroceryList = z.infer<typeof GroceryListStoredSchema>;

// GroceryListSchema — accepts snake_case wire format, transforms to camelCase GroceryList.
export const GroceryListSchema = z
  .object({
    uid: GroceryListUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    is_default: z.boolean(),
    reminders_list: z.string(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ order_flag, is_default, reminders_list, ...rest }): GroceryList => ({
      ...rest,
      orderFlag: order_flag,
      isDefault: is_default,
      remindersList: reminders_list,
    }),
  );

// GroceryItemStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryItemStoredSchema = z.object({
  uid: GroceryItemUidSchema,
  name: z.string(),
  ingredient: z.string(),
  aisle: z.string(),
  aisleUid: z.string(),
  listUid: z.string(),
  purchased: z.boolean(),
  deleted: z.boolean().optional().default(false),
  orderFlag: z.number().int(),
  quantity: z.string(),
  instruction: z.string(),
  recipe: z.string().nullable(),
  separate: z.boolean(),
});

export type GroceryItem = z.infer<typeof GroceryItemStoredSchema>;

// GroceryItemSchema — accepts snake_case wire format, transforms to camelCase GroceryItem.
export const GroceryItemSchema = z
  .object({
    uid: GroceryItemUidSchema,
    name: z.string(),
    ingredient: z.string(),
    aisle: z.string(),
    aisle_uid: z.string().nullable(),
    list_uid: z.string(),
    purchased: z.boolean(),
    deleted: z.boolean().optional().default(false),
    order_flag: z.number().int(),
    quantity: z.string(),
    instruction: z.string(),
    recipe: z.string().nullable(),
    separate: z.boolean(),
  })
  .transform(
    ({ aisle_uid, list_uid, order_flag, ...rest }): GroceryItem => ({
      ...rest,
      aisleUid: aisle_uid ?? "",
      listUid: list_uid,
      orderFlag: order_flag,
    }),
  );

// GroceryIngredientStoredSchema — validates camelCase JSON read back from disk. No transform.
export const GroceryIngredientStoredSchema = z.object({
  uid: GroceryIngredientUidSchema,
  name: z.string(),
  aisleUid: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type GroceryIngredient = z.infer<typeof GroceryIngredientStoredSchema>;

// GroceryIngredientSchema — accepts snake_case wire format, transforms to camelCase GroceryIngredient.
export const GroceryIngredientSchema = z
  .object({
    uid: GroceryIngredientUidSchema,
    name: z.string(),
    aisle_uid: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ aisle_uid, ...rest }): GroceryIngredient => ({
      ...rest,
      aisleUid: aisle_uid ?? "",
    }),
  );

// Branded UID schemas for meals
export const MealUidSchema = z.string().brand("MealUid");
export type MealUid = z.infer<typeof MealUidSchema>;

export const MealTypeUidSchema = z.string().brand("MealTypeUid");
export type MealTypeUid = z.infer<typeof MealTypeUidSchema>;

// MealStoredSchema — validates camelCase JSON read back from disk. No transform.
// `typeUid` is nullable because legacy meals (created before Paprika's mealtypes
// feature) carry `null` for this field; new meals always carry a real UID.
export const MealStoredSchema = z.object({
  uid: MealUidSchema,
  recipeUid: z.string().nullable(),
  name: z.string(),
  date: z.string(),
  type: z.number().int().nonnegative(),
  typeUid: z.string().nullable(),
  orderFlag: z.number().int(),
  isIngredient: z.boolean(),
  scale: z.string().nullable(),
  deleted: z.boolean().optional().default(false),
});

export type Meal = z.infer<typeof MealStoredSchema>;

// MealSchema — accepts snake_case wire format, transforms to camelCase Meal.
export const MealSchema = z
  .object({
    uid: MealUidSchema,
    recipe_uid: z.string().nullable(),
    name: z.string(),
    date: z.string(),
    type: z.number().int().nonnegative(),
    type_uid: z.string().nullable(),
    order_flag: z.number().int(),
    is_ingredient: z.boolean(),
    scale: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ recipe_uid, type_uid, order_flag, is_ingredient, ...rest }): Meal => ({
      ...rest,
      recipeUid: recipe_uid,
      typeUid: type_uid,
      orderFlag: order_flag,
      isIngredient: is_ingredient,
    }),
  );

// mealToApiPayload — inverse of MealSchema's read transform. Accepts the camelCase
// Meal shape and emits the snake_case wire payload expected by the Paprika Cloud Sync API.
export function mealToApiPayload(item: Readonly<Meal>): Record<string, unknown> {
  return {
    uid: item.uid,
    recipe_uid: item.recipeUid,
    name: item.name,
    date: item.date,
    type: item.type,
    type_uid: item.typeUid,
    order_flag: item.orderFlag,
    is_ingredient: item.isIngredient,
    scale: item.scale,
    deleted: item.deleted,
  };
}

// MealTypeStoredSchema — validates camelCase JSON read back from disk. No transform.
// `exportTime` is seconds since midnight (e.g. 28800 = 08:00, 64800 = 18:00).
// `originalType` is the integer mapping back to one of the four built-in types
// (Breakfast=0, Lunch=1, Dinner=2, Snacks=3) for built-in types, or `null` for
// user-created custom types. Verified via mealtypes.har.json capture.
// `deleted` mirrors the other catalog entities (aisles, grocery ingredients):
// optional+default false because GET responses omit it for live items, but
// the soft-delete wire format POSTs it as `true` (see mealtypes.har.json
// "delete mealtype" capture).
// None of these fields are used by the read-only history feature; preserved
// for fidelity and so the sync layer can filter tombstones.
export const MealTypeStoredSchema = z.object({
  uid: MealTypeUidSchema,
  name: z.string(),
  color: z.string(),
  orderFlag: z.number().int(),
  originalType: z.number().int().nullable(),
  exportAllDay: z.boolean(),
  exportTime: z.number().int().nonnegative(),
  deleted: z.boolean().optional().default(false),
});

export type MealType = z.infer<typeof MealTypeStoredSchema>;

// MealTypeSchema — accepts snake_case wire format, transforms to camelCase MealType.
export const MealTypeSchema = z
  .object({
    uid: MealTypeUidSchema,
    name: z.string(),
    color: z.string(),
    order_flag: z.number().int(),
    original_type: z.number().int().nullable(),
    export_all_day: z.boolean(),
    export_time: z.number().int().nonnegative(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ order_flag, original_type, export_all_day, export_time, ...rest }): MealType => ({
      ...rest,
      orderFlag: order_flag,
      originalType: original_type,
      exportAllDay: export_all_day,
      exportTime: export_time,
    }),
  );

// Branded UID schemas for menu entities
export const MenuUidSchema = z.string().min(1).brand("MenuUid");
export type MenuUid = z.infer<typeof MenuUidSchema>;

export const MenuItemUidSchema = z.string().min(1).brand("MenuItemUid");
export type MenuItemUid = z.infer<typeof MenuItemUidSchema>;

// MenuStoredSchema — validates camelCase JSON read back from disk. No transform.
export const MenuStoredSchema = z.object({
  uid: MenuUidSchema,
  name: z.string(),
  days: z.number().int().nonnegative(),
  orderFlag: z.number().int(),
  notes: z.string(),
  deleted: z.boolean().optional().default(false),
});

export type Menu = z.infer<typeof MenuStoredSchema>;

// MenuSchema — accepts snake_case wire format, transforms to camelCase Menu.
export const MenuSchema = z
  .object({
    uid: MenuUidSchema,
    name: z.string(),
    days: z.number().int().nonnegative(),
    order_flag: z.number().int(),
    notes: z.string(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(({ order_flag, ...rest }): Menu => ({ ...rest, orderFlag: order_flag }));

// menuToApiPayload — inverse of MenuSchema's read transform. Accepts the camelCase
// Menu shape and emits the snake_case wire payload expected by the Paprika Cloud Sync API.
export function menuToApiPayload(item: Readonly<Menu>): Record<string, unknown> {
  return {
    uid: item.uid,
    name: item.name,
    days: item.days,
    order_flag: item.orderFlag,
    notes: item.notes,
    deleted: item.deleted,
  };
}

// MenuItemStoredSchema — validates camelCase JSON read back from disk. No transform.
// `menuUid` is nullable: a cascade-deleted menuitem has `menu_uid: null` on the wire
// (the menu's soft-delete nulls the back-reference). `recipeUid` is nullable as a
// defensive read — the wire format does not guarantee a recipe link exists.
export const MenuItemStoredSchema = z.object({
  uid: MenuItemUidSchema,
  menuUid: z.string().nullable(),
  recipeUid: z.string().nullable(),
  name: z.string(),
  day: z.number().int().nonnegative(),
  typeUid: z.string(),
  orderFlag: z.number().int(),
  deleted: z.boolean().optional().default(false),
});

export type MenuItem = z.infer<typeof MenuItemStoredSchema>;

// MenuItemSchema — accepts snake_case wire format, transforms to camelCase MenuItem.
export const MenuItemSchema = z
  .object({
    uid: MenuItemUidSchema,
    menu_uid: z.string().nullable(),
    recipe_uid: z.string().nullable(),
    name: z.string(),
    day: z.number().int().nonnegative(),
    type_uid: z.string(),
    order_flag: z.number().int(),
    deleted: z.boolean().optional().default(false),
  })
  .transform(
    ({ menu_uid, recipe_uid, type_uid, order_flag, ...rest }): MenuItem => ({
      ...rest,
      menuUid: menu_uid,
      recipeUid: recipe_uid,
      typeUid: type_uid,
      orderFlag: order_flag,
    }),
  );

// menuItemToApiPayload — inverse of MenuItemSchema's read transform. Accepts the
// camelCase MenuItem shape and emits the snake_case wire payload.
export function menuItemToApiPayload(item: Readonly<MenuItem>): Record<string, unknown> {
  return {
    uid: item.uid,
    menu_uid: item.menuUid,
    recipe_uid: item.recipeUid,
    name: item.name,
    day: item.day,
    type_uid: item.typeUid,
    order_flag: item.orderFlag,
    deleted: item.deleted,
  };
}

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
export type SyncEntityType = "recipes" | "pantry" | "grocery-lists" | "grocery-items" | "menus" | "menu-items";

// K is locked to SyncEntityType; T is the entity item type.
export type SyncResult<K extends SyncEntityType, T extends object> = {
  readonly changeType: K;
  readonly changes: EntityChanges<T>;
};

export type RecipeSyncResult = SyncResult<"recipes", Recipe>;
export type PantrySyncResult = SyncResult<"pantry", PantryItem>;
export type GroceryListSyncResult = SyncResult<"grocery-lists", GroceryList>;
export type GroceryItemSyncResult = SyncResult<"grocery-items", GroceryItem>;
export type MenuSyncResult = SyncResult<"menus", Menu>;
export type MenuItemSyncResult = SyncResult<"menu-items", MenuItem>;

// Union used as the sync:complete event payload.
export type AnySyncResult =
  | RecipeSyncResult
  | PantrySyncResult
  | GroceryListSyncResult
  | GroceryItemSyncResult
  | MenuSyncResult
  | MenuItemSyncResult;

export type DiffResult = {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};
