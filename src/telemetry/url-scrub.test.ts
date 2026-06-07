import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";

import { scrubUrl, urlScrubbingExporter } from "./url-scrub.js";

describe("scrubUrl", () => {
  it("drops the query — OAuth codes, state, presigned credentials", () => {
    expect(scrubUrl("https://host.example/oauth/callback?code=SECRET&state=S1")).toBe(
      "https://host.example/oauth/callback",
    );
    expect(scrubUrl("https://bucket.s3.example/img.jpg?X-Amz-Signature=abc&X-Amz-Credential=key")).toBe(
      "https://bucket.s3.example/img.jpg",
    );
  });

  it("drops userinfo and fragments", () => {
    expect(scrubUrl("https://user:pass@host.example/p#frag")).toBe("https://host.example/p");
  });

  it("fails closed on an unparseable value", () => {
    expect(scrubUrl("not a url")).toBe("[scrubbed:unparseable]");
  });
});

describe("urlScrubbingExporter", () => {
  function fakeSpan(attributes: Record<string, unknown>): ReadableSpan {
    return { attributes } as unknown as ReadableSpan;
  }

  it("scrubs url.full / http.url, deletes url.query, and delegates to the inner exporter", () => {
    const exported: Array<ReadonlyArray<ReadableSpan>> = [];
    const inner = {
      export(spans: ReadonlyArray<ReadableSpan>, cb: (result: { code: number }) => void) {
        exported.push(spans);
        cb({ code: 0 });
      },
      shutdown: vi.fn(async () => undefined),
    } as unknown as SpanExporter;

    const span = fakeSpan({
      "url.full": "https://paprikaapp.com/api/v2/sync/recipe/UID-1/?token=leak",
      "url.query": "token=leak",
      "url.path": "/api/v2/sync/recipe/UID-1/",
      "http.route": "/mcp",
    });
    const cb = vi.fn();
    urlScrubbingExporter(inner).export([span], cb);

    expect(span.attributes["url.full"]).toBe("https://paprikaapp.com/api/v2/sync/recipe/UID-1/");
    expect(span.attributes["url.query"]).toBeUndefined();
    // Path and route survive — origin + path is the documented exception.
    expect(span.attributes["url.path"]).toBe("/api/v2/sync/recipe/UID-1/");
    expect(span.attributes["http.route"]).toBe("/mcp");
    expect(exported).toHaveLength(1);
    expect(cb).toHaveBeenCalledOnce();
  });
});
