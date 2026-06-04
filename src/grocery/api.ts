/**
 * Grocery's public contract — deliberately EMPTY.
 *
 * Grocery is a pure leaf CONSUMER: it depends on `aisle` (item/ingredient aisle
 * resolution) and `pantry` (the `move_grocery_items_to_pantry` write-through), but
 * NO live sibling reads grocery state. Verified by grepping every caller of
 * `groceryListStore` / `groceryItemStore` / `groceryIngredientStore` outside the
 * domain: only grocery's own tools and the `paprika://grocery-list/{uid}` resource
 * touch them, and both reach them via `ctx.self`, never a cross-domain contract.
 *
 * So there is nothing to expose. The spike's `listCount` / `itemCount` were
 * illustrative placeholders with no consumer; this contract is `{}` until a future
 * coordinator or diagnostic surface actually needs grocery state. The three stores
 * and caches stay private behind it.
 */
// oxlint-disable-next-line no-empty-object-type
export interface GroceryApi {}
