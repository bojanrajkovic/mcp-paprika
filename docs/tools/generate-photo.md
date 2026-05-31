# generate_photo

Generate a styled food photo for a recipe with an AI image model and (by default) attach it to the recipe.

This tool requires [image-generation configuration](../configuration.md#recipe-photo-generation-optional). If image generation isn't configured, the tool isn't registered and won't appear in the tool list.

## Parameters

| Name               | Type    | Required | Default    | Description                                                                                              |
| ------------------ | ------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `recipe_uid`       | string  | Yes      | —          | UID of the recipe to generate a photo for                                                                |
| `model`            | enum    | No       | `seedream` | One of `seedream`, `nano-banana`, `nano-banana-2`, `gpt-image` (see below)                               |
| `style`            | string  | No       | —          | Free-text styling/plating guidance appended to the prompt (e.g. `"on a white marble surface, daylight"`) |
| `aspect_ratio`     | enum    | No       | `1:1`      | `1:1`, `4:3`, `3:2`, or `16:9`                                                                           |
| `restyle_existing` | boolean | No       | `false`    | Restyle the recipe's current photo (image-to-image) instead of generating from scratch                   |
| `attach`           | boolean | No       | `true`     | Attach the result to the recipe; when `false`, return an inline preview without saving                   |

## Models

The exposed models are a curated subset of OpenRouter's image-generation catalog. The aliases are stable even if the upstream slug changes. Relative tradeoffs (not absolute prices, which drift — check OpenRouter for current pricing):

| Alias           | Upstream                      | Notes                                                                                                         |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `seedream`      | ByteDance Seedream 4.5        | Default. Inexpensive, fast, strong food realism.                                                              |
| `nano-banana`   | Google Gemini 2.5 Flash Image | Among the cheapest and fastest.                                                                               |
| `nano-banana-2` | Google Gemini 3.1 Flash Image | Higher-end Gemini.                                                                                            |
| `gpt-image`     | OpenAI GPT Image 2            | Highest quality, but markedly slower and pricier — its latency can exceed some MCP clients' request timeouts. |

Want a model that isn't listed? Open an issue — the curated set is intentionally small so modality handling stays correct.

## Behavior

The prompt is built from the recipe's **name, description, and category names** plus standard editorial photo cues. It deliberately does **not** include the ingredient list (which makes models scatter raw ingredients across the plate or render a labeled ingredient infographic). Well-described, categorized recipes therefore produce the best results; for an obscure dish the model may not recognize by name, pass a `style` hint to describe how it should look.

The generated image is normalized before attaching: re-encoded to JPEG and capped at 2048px on its longest edge (aspect preserved), and a ~280px thumbnail is produced — the same `upload_photo` pipeline. `image_size` is intentionally not exposed; output is normalized regardless of what the model emits.

With `restyle_existing: true` the tool downloads the recipe's current photo and runs image-to-image, so you can re-light or re-plate an existing shot. It errors if the recipe has no photo.

The image bytes never traverse the MCP wire to the model on the way in — the prompt is text — and on a successful attach only a confirmation (with the cost and new photo UID) is returned, not the bytes. With `attach: false`, the preview image is returned inline.

## Examples

Generate and attach a photo with the default model:

```json
{
  "name": "generate_photo",
  "arguments": {
    "recipe_uid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

Steer the plating and pick a wide aspect ratio, without saving:

```json
{
  "name": "generate_photo",
  "arguments": {
    "recipe_uid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "style": "overhead on dark slate, moody side light",
    "aspect_ratio": "16:9",
    "attach": false
  }
}
```

Re-style the recipe's existing photo:

```json
{
  "name": "generate_photo",
  "arguments": {
    "recipe_uid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "restyle_existing": true,
    "style": "bright and clean on white marble"
  }
}
```
