import type { EmptyApi } from "../../kernel/registry.js";

/**
 * Grocery's public contract — deliberately EMPTY. Grocery is a pure leaf CONSUMER: it
 * depends on `aisle` (item/ingredient aisle resolution) and `pantry`
 * (`move_grocery_items_to_pantry` write-through), but NO sibling reads grocery state,
 * so there is nothing to expose. The contract stays {@link EmptyApi} until a future
 * coordinator or diagnostic surface actually needs grocery state.
 */
export type GroceryApi = EmptyApi;
