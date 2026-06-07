import { SpanStatusCode } from "@opentelemetry/api";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { useMswServer } from "../../test/support/msw.js";
import { PAPRIKA_API_BASE, PAPRIKA_AUTH_URL } from "../../test/support/paprika-msw.js";
import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { PaprikaClient } from "./client.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

const server = useMswServer();

beforeEach(() => {
  telemetry.spanExporter.reset();
});

describe("PaprikaClient telemetry", () => {
  it("wraps a request in a logical span named by the sync entity", async () => {
    server.use(http.get(`${PAPRIKA_API_BASE}/recipes/`, () => HttpResponse.json({ result: [] })));
    const client = new PaprikaClient("user@example.com", "pw");

    (await client.listRecipes()).match(
      (entries) => {
        expect(entries).toEqual([]);
      },
      () => {
        expect.fail("Expected Ok but got Err");
      },
    );

    const [span] = telemetry.spansNamed("paprika.recipes");
    expect(span).toBeDefined();
    expect(span!.attributes["mcp_paprika.client"]).toBe("paprika");
    expect(span!.attributes["http.request.method"]).toBe("GET");
    expect(span!.attributes["error.type"]).toBeUndefined();
    expect(span!.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("names the span by the path's entity segment, never the UID, and classes failures by error class", async () => {
    server.use(
      http.get(`${PAPRIKA_API_BASE}/recipe/UID-123/`, () => HttpResponse.json({ error: "nope" }, { status: 404 })),
    );
    const client = new PaprikaClient("user@example.com", "pw");

    (await client.getRecipe("UID-123")).match(
      () => {
        expect.fail("Expected Err but got Ok");
      },
      (error) => {
        expect(error.constructor.name).toBe("PaprikaAPIError");
      },
    );

    const [span] = telemetry.spansNamed("paprika.recipe");
    expect(span).toBeDefined();
    expect(span!.attributes["error.type"]).toBe("PaprikaAPIError");
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("spans authenticate() as paprika.login", async () => {
    server.use(http.post(PAPRIKA_AUTH_URL, () => HttpResponse.json({ result: { token: "tok" } })));
    const client = new PaprikaClient("user@example.com", "pw");

    (await client.authenticate()).match(
      () => undefined,
      () => {
        expect.fail("Expected Ok but got Err");
      },
    );

    expect(telemetry.spansNamed("paprika.login")).toHaveLength(1);
  });
});
