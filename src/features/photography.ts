/**
 * HTTP client for recipe-photo generation via OpenRouter's chat-completions
 * image-output API.
 *
 * Unlike a dedicated images endpoint, OpenRouter returns generated images inside
 * a chat message: `choices[0].message.images[0].image_url.url` as a base64
 * data-URI. Image-only models (Seedream) require `modalities: ["image"]`; models
 * that also emit text (Gemini, GPT) require `["image", "text"]`.
 *
 * Resilience (retry + circuit breaker) is shared with EmbeddingClient via
 * `createResilientExecutor`. The model is chosen per call (see PhotoModel), not
 * at construction — credentials are the only construction-time input.
 */
import type { IRetryContext } from "cockatiel";
import type { Logger } from "pino";
import { z } from "zod";

import type { Recipe } from "../domains/recipe/types.js";
import type { ResolvedImageGenConfig } from "../utils/config.js";

import { SILENT_LOG } from "../utils/log.js";
import {
  createResilientExecutor,
  type ResilientExecutor,
  RETRYABLE_STATUSES,
  TransientHTTPError,
} from "../utils/resilience.js";
import { PhotographyAPIError, PhotographyError } from "./photography-errors.js";

/** Ordered curated model aliases — a tuple so it can seed the tool's `z.enum`. */
export const PHOTO_MODELS = ["seedream", "nano-banana", "nano-banana-2", "gpt-image"] as const;

export type PhotoModel = (typeof PHOTO_MODELS)[number];

/**
 * Per-model OpenRouter slug + output modality, co-located so adding a model is a
 * single edit and `Record<PhotoModel, …>` forces the compiler to keep every
 * alias covered. Aliases are stable even if a provider renames a slug ("Nano
 * Banana" is a Google codename; the real slug is pinned here). `imageOnly`
 * models (Seedream) emit only an image and require `modalities: ["image"]`; the
 * rest emit image+text and require `["image", "text"]` — sending the wrong value
 * 404s with "no endpoints found that support the requested output modalities".
 * More models exist on OpenRouter; callers wanting one should open an issue
 * rather than passing a raw slug, so modality handling stays correct.
 */
const MODELS: Record<PhotoModel, { readonly slug: string; readonly imageOnly: boolean }> = {
  seedream: { slug: "bytedance-seed/seedream-4.5", imageOnly: true },
  "nano-banana": { slug: "google/gemini-2.5-flash-image", imageOnly: false },
  "nano-banana-2": { slug: "google/gemini-3.1-flash-image-preview", imageOnly: false },
  "gpt-image": { slug: "openai/gpt-5.4-image-2", imageOnly: false },
};

/** Default model: cheap, fast, strong food realism, flat per-image cost. */
export const DEFAULT_PHOTO_MODEL: PhotoModel = "seedream";

/** Supported output aspect ratios (the tool's input enum). */
export const PHOTO_ASPECT_RATIOS = ["1:1", "4:3", "3:2", "16:9"] as const;
export type PhotoAspectRatio = (typeof PHOTO_ASPECT_RATIOS)[number];

// Generous ceiling: GPT Image 2 legitimately takes ~3 minutes. Past this we
// abort rather than hang a tool call forever.
const REQUEST_TIMEOUT_MS = 300_000;

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** A reference image for image-to-image generation (the recipe's existing photo). */
export interface ReferenceImage {
  readonly data: Buffer;
  readonly mimeType: string;
}

export interface GeneratePhotoOptions {
  readonly prompt: string;
  readonly model: PhotoModel;
  readonly aspectRatio?: PhotoAspectRatio;
  /** When present, the request becomes image-to-image (restyle this image). */
  readonly referenceImage?: ReferenceImage;
}

export interface GeneratedPhoto {
  readonly bytes: Buffer;
  readonly mimeType: string;
  /** Reported by OpenRouter in `usage.cost` (USD); null if absent. */
  readonly costUsd: number | null;
  /** The concrete upstream model id that served the request. */
  readonly servedModel: string;
}

// Tolerant schema: only the image data-URI path is required. `usage.cost` and
// the served model id are best-effort (logged, not load-bearing).
const photoResponseSchema = z.object({
  model: z.string().optional(),
  usage: z.object({ cost: z.number() }).partial().passthrough().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({
          images: z.array(z.object({ image_url: z.object({ url: z.string() }) })).optional(),
        }),
      }),
    )
    .min(1),
});

const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is;

export class PhotographyClient {
  private readonly _endpoint: string;
  private readonly _apiKey: string;
  private readonly log: Logger;
  private readonly _executor: ResilientExecutor;

  constructor(config: Readonly<ResolvedImageGenConfig>, log?: Logger) {
    this._endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    this._apiKey = config.apiKey;
    this.log = log ?? SILENT_LOG;
    this._executor = createResilientExecutor({
      service: "photography",
      logLabel: "photo generation",
      log: this.log,
    });
  }

  /**
   * Generate an image and return its raw bytes. Throws:
   * - PhotographyAPIError on a permanent (non-retryable) HTTP status
   * - PhotographyError on a 200 with no image (refusal / text-only completion)
   *   or an unparseable image payload
   * - CircuitOpenError when the breaker is open
   * - ZodError on a malformed response envelope
   */
  async generate(options: Readonly<GeneratePhotoOptions>): Promise<GeneratedPhoto> {
    const { slug, imageOnly } = MODELS[options.model];
    const modalities = imageOnly ? ["image"] : ["image", "text"];
    const content: string | Array<ContentPart> = options.referenceImage
      ? [
          { type: "text", text: options.prompt },
          {
            type: "image_url",
            image_url: {
              url: `data:${options.referenceImage.mimeType};base64,${options.referenceImage.data.toString("base64")}`,
            },
          },
        ]
      : options.prompt;

    const body = {
      model: slug,
      messages: [{ role: "user", content }],
      modalities,
      // image_size is deliberately omitted: it is inconsistent/broken across
      // models, and output is normalized downstream by uploadPhoto. We only
      // steer the aspect ratio.
      image_config: { aspect_ratio: options.aspectRatio ?? "1:1" },
    };
    // Serialize once — the body can carry a multi-MB base64 reference image
    // (restyle), and the execute closure runs on every retry attempt.
    const bodyJson = JSON.stringify(body);

    const execute = async (ctx: IRetryContext): Promise<GeneratedPhoto> => {
      const attempt = ctx.attempt + 1;
      const t0 = performance.now();
      this.log.debug({ attempt, model: options.model }, "photo generation request start");

      // Generous abort ceiling (GPT Image 2 legitimately takes ~3 min). A
      // manual controller + clearTimeout avoids leaking a long-lived timer once
      // the request settles.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(this._endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._apiKey}`,
          },
          body: bodyJson,
          signal: controller.signal,
        });

        if (!response.ok) {
          if (RETRYABLE_STATUSES.has(response.status)) {
            // onRetry hook logs the warn; just signal cockatiel to retry.
            throw new TransientHTTPError(response.status);
          }
          this.log.error(
            { status: response.status, attempt, model: options.model },
            "photo generation request failed (non-retryable)",
          );
          throw new PhotographyAPIError("Image generation API error", response.status, this._endpoint);
        }

        const json: unknown = await response.json();
        const parsed = photoResponseSchema.parse(json);
        const url = parsed.choices[0]?.message.images?.[0]?.image_url.url;
        if (url === undefined) {
          throw new PhotographyError(`Model "${options.model}" returned no image (a refusal or text-only completion).`);
        }

        const photo = decodeDataUri(url);
        const costUsd = parsed.usage?.cost ?? null;
        const servedModel = parsed.model ?? slug;
        const attemptDurationMs = Math.round(performance.now() - t0);
        this.log.info(
          {
            model: options.model,
            servedModel,
            costUsd,
            bytes: photo.bytes.length,
            mimeType: photo.mimeType,
            attemptDurationMs,
          },
          "photo generated",
        );
        return { ...photo, costUsd, servedModel };
      } finally {
        clearTimeout(timer);
      }
    };

    return this._executor.execute(this._endpoint, execute);
  }
}

/**
 * Build the text-to-image prompt for a recipe.
 *
 * Uses the recipe NAME, DESCRIPTION, and resolved CATEGORY names plus editorial
 * photo cues — deliberately NOT the ingredient list. Empirically, injecting the
 * ingredient list makes models scatter raw ingredients around the plate or even
 * render a labeled ingredient infographic; the dish name carries the signal and
 * description/categories disambiguate it. An optional `style` hint (free text
 * from the caller/agent) is appended last so it can steer or correct plating —
 * the main escape hatch for obscure dishes the model may not recognize by name.
 *
 * Pure function, no I/O. Resolve category names via
 * `ctx.categoryStore.resolveNames(recipe.categories)` before calling.
 */
export function recipeToPhotoPrompt(
  recipe: Readonly<Recipe>,
  categoryNames: ReadonlyArray<string>,
  style?: string,
): string {
  const parts: Array<string> = [`Professional food photography of ${recipe.name}.`];

  if (recipe.description) {
    parts.push(recipe.description);
  }
  if (categoryNames.length > 0) {
    parts.push(`Cuisine/type: ${categoryNames.join(", ")}.`);
  }
  const trimmedStyle = style?.trim();
  if (trimmedStyle) {
    parts.push(trimmedStyle);
  }
  parts.push("Natural daylight, shallow depth of field, appetizing plating, editorial style.");

  return parts.join(" ");
}

function decodeDataUri(url: string): { bytes: Buffer; mimeType: string } {
  const match = DATA_URI_RE.exec(url);
  const mimeType = match?.[1];
  const base64 = match?.[2];
  if (mimeType === undefined || base64 === undefined) {
    throw new PhotographyError("Image payload was not a base64 data-URI as expected.");
  }
  return { bytes: Buffer.from(base64, "base64"), mimeType };
}
