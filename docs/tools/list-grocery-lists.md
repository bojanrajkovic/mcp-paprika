# list_grocery_lists

List all grocery lists sorted alphabetically by name.

## Parameters

No parameters.

## Behavior

Returns the name, UID, and item count for each list. Lists are sorted alphabetically.

When there are no grocery lists, returns a message saying so.

Use `read_grocery_list` with the UID to get full details including all items.

## Example

```json
{
  "name": "list_grocery_lists",
  "arguments": {}
}
```

## Sample output

```text
You have 3 grocery list(s):

- **Party Supplies** — 8 item(s) (uid: `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`)
- **Weekly Groceries** — 14 item(s) (uid: `B2C3D4E5-F6A7-8901-BCDE-F12345678901`)
- **Work Lunches** — 5 item(s) (uid: `C3D4E5F6-A7B8-9012-CDEF-123456789012`)
```
