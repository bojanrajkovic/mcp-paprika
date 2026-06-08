// URL scrubbing at the span-export chokepoint.
//
// The attribute discipline (docs/telemetry.md) is enforceable at our own
// recording sites, but the AUTO-instrumentations set URL attributes
// themselves: @hono/otel exports `url.full` straight from the request
// (`/oauth/callback?code=…&state=…` — live authorization codes), and the
// undici instrumentation records `url.full`/`url.query` for every outbound
// request (presigned credentials in user-supplied image URLs). Neither
// exposes a sanitization hook, so the scrub lives where every span from
// every instrumentation must pass: a delegating wrapper around the trace
// exporter. Queries, fragments, and userinfo never leave the process;
// origin + path survive. Path-embedded identifiers are accepted span-level
// detail in both directions — an outbound sync path's entity UID, and the
// inbound RFC 7592 `/register/{clientId}` client id (a public identifier
// per RFC 6749 §2.2): the material that needs protecting rides in queries,
// fragments, and userinfo, which is where the scrub draws the line.

import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

/** URL-valued attribute keys reduced to origin + path. */
const URL_ATTRIBUTE_KEYS = ["url.full", "http.url"];

/** Attribute keys dropped outright (pure query material). */
const DROPPED_ATTRIBUTE_KEYS = ["url.query"];

/**
 * Reduce a URL to origin + path: no query (presigned credentials, OAuth
 * codes/state), no fragment, no userinfo (`URL.origin` excludes it by
 * construction). An unparseable value is replaced wholesale — failing closed
 * beats exporting something we couldn't inspect.
 */
export function scrubUrl(raw: string): string {
  if (!URL.canParse(raw)) return "[scrubbed:unparseable]";
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

/**
 * Non-throwing host label for provider attributes (`gen_ai.provider.name`).
 * The config schemas only require a non-empty string, so a malformed base
 * URL must degrade to a fixed marker — a telemetry label may never throw,
 * neither at construction (boot) nor inside a Result-rail method.
 */
export function urlHostLabel(raw: string): string {
  return URL.canParse(raw) ? new URL(raw).host : "invalid-url";
}

function scrubSpan(span: ReadableSpan): void {
  // ReadableSpan's attributes are typed read-only, but the export path holds
  // the live object; mutating here — the documented chokepoint — is what
  // makes the scrub apply to every instrumentation uniformly, hooks or not.
  const attributes = span.attributes as Record<string, unknown>;
  for (const key of DROPPED_ATTRIBUTE_KEYS) {
    if (key in attributes) delete attributes[key];
  }
  for (const key of URL_ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (typeof value === "string") attributes[key] = scrubUrl(value);
  }
}

/** Wrap a span exporter so every span is URL-scrubbed on its way out. */
export function urlScrubbingExporter(inner: SpanExporter): SpanExporter {
  return {
    // Param types come contextually from SpanExporter — the ExportResult
    // callback type lives in @opentelemetry/core, which is not a direct dep.
    export(spans, resultCallback): void {
      for (const span of spans) scrubSpan(span);
      inner.export(spans, resultCallback);
    },
    shutdown: () => inner.shutdown(),
    ...(inner.forceFlush && { forceFlush: () => inner.forceFlush!() }),
  };
}
