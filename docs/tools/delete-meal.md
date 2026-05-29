# delete_meal

Soft-delete a meal from the planner by UID. The operation is idempotent: a second delete on the same UID returns "already deleted" without re-POSTing.

## Parameters

| Name  | Type   | Required | Default | Description        |
| ----- | ------ | -------- | ------- | ------------------ |
| `uid` | string | Yes      | —       | Meal UID to delete |

## Behavior

Marks the meal as `deleted: true` on the Paprika server. The meal is removed from the local store immediately; the UID is tombstoned in-session so retries are short-circuited without making additional API calls. The deletion propagates to all Paprika clients on the next sync.

**Idempotent:** a second delete on the same UID returns a friendly "already deleted" message without re-POSTing.

**Miss detection.** The tool checks for the meal UID in three tiers (the first two are mutually exclusive at the store lookup — a UID is either in the tombstone set or absent entirely, never both):

1. In the store's tombstone set (previously deleted via this server) → `Meal with UID "<uid>" is already deleted.`
2. Not in the meal store at all → `No meal found with UID "<uid>".`
3. In the store but with `deleted: true` (defense-in-depth) → `Meal "<name>" is already deleted.`

**Sync requirement.** The meal store must be synced before this tool can run. If called before the first sync completes, the tool returns an error.

## Example

```json
{
  "name": "delete_meal",
  "arguments": {
    "uid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

## Sample output

```text
Meal "Tacos" on 2026-06-15 18:00:00 deleted.
```
