# filter_by_time

Filter recipes by prep, cook, or total time. All constraints are optional — set any combination. Results are sorted by total time ascending.

## Parameters

| Name           | Type    | Required | Default | Description                                        |
| -------------- | ------- | -------- | ------- | -------------------------------------------------- |
| `maxPrepTime`  | string  | No       | —       | Maximum prep time (e.g., `"30 minutes"`, `"1 hr"`) |
| `maxCookTime`  | string  | No       | —       | Maximum cook time (e.g., `"45 min"`, `"1 hour"`)   |
| `maxTotalTime` | string  | No       | —       | Maximum total time (e.g., `"1 hour 30 minutes"`)   |
| `limit`        | integer | No       | 20      | Maximum results (max: 50)                          |

## Behavior

Time strings are parsed flexibly — `"30 minutes"`, `"30 min"`, `"30m"`, and `"PT30M"` all work. See the [duration format docs](../configuration.md#sync-interval-format) for the full list.

All constraints are AND'd together. A recipe must satisfy every specified constraint to appear in results. Recipes without a recorded time for a given constraint are excluded.

## Examples

Quick weeknight dinners (30 minutes or less total):

```json
{
  "name": "filter_by_time",
  "arguments": {
    "maxTotalTime": "30 minutes"
  }
}
```

Low-prep recipes (prep under 10 minutes, cook under 1 hour):

```json
{
  "name": "filter_by_time",
  "arguments": {
    "maxPrepTime": "10 min",
    "maxCookTime": "1 hour",
    "limit": 10
  }
}
```
