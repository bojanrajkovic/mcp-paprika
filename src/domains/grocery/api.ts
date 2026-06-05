/**
 * Grocery's public contract — deliberately EMPTY. Grocery is a pure leaf CONSUMER: it
 * depends on `aisle` (item/ingredient aisle resolution) and `pantry`
 * (`move_grocery_items_to_pantry` write-through), but NO sibling reads grocery state,
 * so there is nothing to expose. The contract stays `{}` until a future coordinator or
 * diagnostic surface actually needs grocery state.
 */
// oxlint-disable-next-line no-empty-object-type
export interface GroceryApi {}
