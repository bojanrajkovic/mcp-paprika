// Generated from docs/wire-captures/mealtypes.har.json — do not edit
// Regenerate with: npx tsx scripts/generate-har-fixtures.ts

import { fromTraffic } from "@msw/source/traffic";
import type Har from "har-format";
import type { HttpHandler } from "msw";

/* eslint-disable */

const har = {
  log: {
    version: "1.2",
    creator: {
      name: "mitmproxy + decode-capture.py",
      version: "1.0",
    },
    entries: [
      {
        comment: "create mealtype ([mcp-cap] Brunch — custom type with original_type: null)",
        startedDateTime: "2026-05-27T22:38:00.000000+00:00",
        time: 0,
        request: {
          method: "POST",
          url: "https://paprikaapp.com/api/v2/sync/mealtypes/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "multipart/form-data",
            },
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
          postData: {
            mimeType: "application/octet-stream",
            text: '[{"color": "#000000", "deleted": false, "name": "[mcp-cap] Brunch", "order_flag": 4, "uid": "C0F55C8F-8F1E-402B-B985-9CB85EC0B559", "export_time": 0, "export_all_day": false, "original_type": null}]',
          },
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 16,
            mimeType: "application/json",
            text: '{"result": true}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 16,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "delete mealtype ([mcp-cap] Brunch soft-delete)",
        startedDateTime: "2026-05-27T22:38:10.000000+00:00",
        time: 0,
        request: {
          method: "POST",
          url: "https://paprikaapp.com/api/v2/sync/mealtypes/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "multipart/form-data",
            },
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
          postData: {
            mimeType: "application/octet-stream",
            text: '[{"uid": "C0F55C8F-8F1E-402B-B985-9CB85EC0B559", "name": "[mcp-cap] Brunch", "original_type": null, "export_all_day": false, "order_flag": 4, "deleted": true, "export_time": 0, "color": "#000000"}]',
          },
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 16,
            mimeType: "application/json",
            text: '{"result": true}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 16,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
    ],
  },
} as const;

interface Fixture {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly requestBody: unknown;
  readonly responseBody: unknown;
}

function parseBody(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildFixtures() {
  const map = new Map<string, Fixture>();
  for (const entry of har.log.entries) {
    if (!entry.comment) continue;
    const req = entry.request as { postData?: { text?: string }; method: string; url: string };
    map.set(entry.comment, {
      method: req.method,
      url: req.url,
      status: entry.response.status,
      requestBody: parseBody(req.postData?.text),
      responseBody: parseBody(entry.response.content.text),
    });
  }
  return map;
}

const fixtureMap = buildFixtures();

export type FixtureKey =
  | "create mealtype ([mcp-cap] Brunch — custom type with original_type: null)"
  | "delete mealtype ([mcp-cap] Brunch soft-delete)";

export function fixture(key: FixtureKey): Fixture {
  return fixtureMap.get(key)!;
}

export const handlers: ReadonlyArray<HttpHandler> = fromTraffic(har as unknown as Har.Har);
