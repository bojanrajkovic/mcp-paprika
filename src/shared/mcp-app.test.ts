import {
  RESOURCE_MIME_TYPE as EXT_RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY as EXT_RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/server";
import { describe, expect, it } from "vitest";

import { UI_RESOURCE_MIME_TYPE, UI_RESOURCE_URI_META_KEY } from "./mcp-app.js";

/**
 * The widget surface mirrors two ext-apps wire constants as local literals so the
 * package stays a build-time-only devDependency (see `mcp-app.ts`). These tests
 * pin the mirrors against the installed package: if ext-apps changes a value, the
 * mirror is now wrong and this fails loudly rather than silently mis-advertising a
 * widget. The import here lives in a `*.test.ts` (never shipped), so it does not
 * pull ext-apps onto the runtime path.
 */
describe("ext-apps wire constants (mirrored in mcp-app.ts)", () => {
  it("UI_RESOURCE_MIME_TYPE matches the installed ext-apps RESOURCE_MIME_TYPE", () => {
    expect(UI_RESOURCE_MIME_TYPE).toBe(EXT_RESOURCE_MIME_TYPE);
  });

  it("UI_RESOURCE_URI_META_KEY matches the installed ext-apps RESOURCE_URI_META_KEY", () => {
    expect(UI_RESOURCE_URI_META_KEY).toBe(EXT_RESOURCE_URI_META_KEY);
  });
});
