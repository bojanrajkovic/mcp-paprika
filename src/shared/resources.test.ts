import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { resourceNotFound } from "./resources.js";

describe("resourceNotFound", () => {
  it("throws an McpError so the SDK Protocol layer renders a JSON-RPC error", () => {
    expect(() => resourceNotFound("Recipe not found: ABC")).toThrow(McpError);
  });

  it("carries the InvalidParams code and the caller's message", () => {
    let captured: unknown;
    try {
      resourceNotFound("Menu not found: XYZ");
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(McpError);
    expect((captured as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((captured as McpError).message).toContain("Menu not found: XYZ");
  });
});
