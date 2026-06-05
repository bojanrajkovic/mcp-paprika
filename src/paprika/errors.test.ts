import { BrokenCircuitError } from "cockatiel";
import { describe, expect, it } from "vitest";

import { CircuitOpenError } from "../utils/errors.js";
import { PaprikaAPIError, PaprikaAuthError, PaprikaError } from "./errors.js";

describe("Error class hierarchy", () => {
  describe("Inheritance chain", () => {
    it("should verify PaprikaError instanceof Error", () => {
      const error = new PaprikaError("test error");
      expect(error instanceof PaprikaError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it("should verify PaprikaAuthError instanceof PaprikaError instanceof Error", () => {
      const error = new PaprikaAuthError("auth failed");
      expect(error instanceof PaprikaAuthError).toBe(true);
      expect(error instanceof PaprikaError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it("should verify PaprikaAPIError instanceof PaprikaError instanceof Error", () => {
      const error = new PaprikaAPIError("Not found", 404, "/api/test");
      expect(error instanceof PaprikaAPIError).toBe(true);
      expect(error instanceof PaprikaError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("PaprikaAPIError status and endpoint fields", () => {
    it("should expose status and endpoint as readonly properties", () => {
      const error = new PaprikaAPIError("Not found", 404, "/api/v2/sync/recipe/abc/");

      expect(error.status).toBe(404);
      expect(error.endpoint).toBe("/api/v2/sync/recipe/abc/");
    });

    it("should have status field marked as readonly", () => {
      const error = new PaprikaAPIError("test", 404, "/api/test");
      expect(error.status).toBe(404);
      // The readonly keyword prevents TypeScript from allowing assignment
      // @ts-expect-error status is readonly
      error.status = 500;
    });

    it("should have endpoint field marked as readonly", () => {
      const error = new PaprikaAPIError("test", 404, "/api/test");
      expect(error.endpoint).toBe("/api/test");
      // The readonly keyword prevents TypeScript from allowing assignment
      // @ts-expect-error endpoint is readonly
      error.endpoint = "/different/endpoint";
    });
  });

  describe("Error message formatting for PaprikaAPIError", () => {
    it("should format message as 'message (HTTP status from endpoint)'", () => {
      const error = new PaprikaAPIError("Not found", 404, "/api/v2/sync/recipe/abc/");

      expect(error.message).toBe("Not found (HTTP 404 from /api/v2/sync/recipe/abc/)");
    });

    it("should handle different status codes", () => {
      const error500 = new PaprikaAPIError("Server error", 500, "/api/test");
      expect(error500.message).toBe("Server error (HTTP 500 from /api/test)");

      const error403 = new PaprikaAPIError("Forbidden", 403, "/api/recipes");
      expect(error403.message).toBe("Forbidden (HTTP 403 from /api/recipes)");
    });
  });

  describe("ErrorOptions cause chaining", () => {
    it("should accept cause in PaprikaError", () => {
      const originalError = new Error("original cause");
      const error = new PaprikaError("wrapper error", {
        cause: originalError,
      });

      expect(error.cause instanceof Error).toBe(true);
      expect(error.cause).toBe(originalError);
      expect(error.message).toBe("wrapper error");
    });

    it("should accept cause in PaprikaAuthError with custom message", () => {
      const originalError = new Error("credentials invalid");
      const error = new PaprikaAuthError("Authentication failed", {
        cause: originalError,
      });

      expect(error.cause instanceof Error).toBe(true);
      if (error.cause instanceof Error) {
        expect(error.cause.message).toBe("credentials invalid");
      }
      expect(error.message).toBe("Authentication failed");
    });

    it("should accept cause in PaprikaAuthError with default message", () => {
      const originalError = new Error("token expired");
      const error = new PaprikaAuthError(undefined, {
        cause: originalError,
      });

      expect(error.cause instanceof Error).toBe(true);
      if (error.cause instanceof Error) {
        expect(error.cause.message).toBe("token expired");
      }
      expect(error.message).toBe("Authentication failed");
    });

    it("should accept cause in PaprikaAPIError", () => {
      const originalError = new Error("network timeout");
      const error = new PaprikaAPIError("Request failed", 0, "/api/endpoint", {
        cause: originalError,
      });

      expect(error.cause instanceof Error).toBe(true);
      if (error.cause instanceof Error) {
        expect(error.cause.message).toBe("network timeout");
      }
      expect(error.message).toBe("Request failed (HTTP 0 from /api/endpoint)");
    });

    it("should chain multiple levels of errors", () => {
      const rootCause = new Error("DNS lookup failed");
      const networkError = new Error("network error", { cause: rootCause });
      const apiError = new PaprikaAPIError("API call failed", 0, "/api/test", {
        cause: networkError,
      });

      expect(apiError.cause).toBe(networkError);
      if (networkError instanceof Error) {
        expect(networkError.cause).toBe(rootCause);
      }
    });
  });

  describe("Error name property", () => {
    it("should set name to 'PaprikaError' for PaprikaError instances", () => {
      const error = new PaprikaError("test");
      expect(error.name).toBe("PaprikaError");
    });

    it("should set name to 'PaprikaAuthError' for PaprikaAuthError instances", () => {
      const error = new PaprikaAuthError();
      expect(error.name).toBe("PaprikaAuthError");
    });

    it("should set name to 'PaprikaAuthError' with custom message", () => {
      const error = new PaprikaAuthError("custom auth message");
      expect(error.name).toBe("PaprikaAuthError");
    });

    it("should set name to 'PaprikaAPIError' for PaprikaAPIError instances", () => {
      const error = new PaprikaAPIError("error", 500, "/api/test");
      expect(error.name).toBe("PaprikaAPIError");
    });
  });

  describe("CircuitOpenError", () => {
    const SERVICE = "paprika";
    const ENDPOINT = "https://www.paprikaapp.com/api/v2/sync/recipes/";

    it("is an instance of CircuitOpenError and Error", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect(err instanceof CircuitOpenError).toBe(true);
      expect(err instanceof Error).toBe(true);
    });

    it("does not have a status property and is not instanceof PaprikaAPIError", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect("status" in err).toBe(false);
      expect(err instanceof PaprikaAPIError).toBe(false);
    });

    it("message contains the endpoint URL and no fabricated HTTP status", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect(err.message).toContain(ENDPOINT);
      expect(err.message).not.toContain("503");
      expect(err.message).not.toContain("HTTP 503");
    });

    it("cause is instanceof BrokenCircuitError when provided", () => {
      const brokenCircuit = new BrokenCircuitError();
      const err = new CircuitOpenError(SERVICE, ENDPOINT, { cause: brokenCircuit });
      expect(err.cause instanceof BrokenCircuitError).toBe(true);
      expect(err.cause).toBe(brokenCircuit);
    });

    // Additional: endpoint property accessible
    it("exposes endpoint as a readonly property matching the constructor argument", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect(err.endpoint).toBe(ENDPOINT);
    });

    // Additional: service property accessible
    it("exposes service as a readonly property matching the constructor argument", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect(err.service).toBe(SERVICE);
    });

    // Additional: name property set correctly
    it("has name set to 'CircuitOpenError'", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect(err.name).toBe("CircuitOpenError");
    });

    // Additional: message format matches the documented pattern
    it("message format renders as '<service> circuit breaker is open (endpoint=<url>)'", () => {
      const err = new CircuitOpenError(SERVICE, ENDPOINT);
      expect(err.message).toBe(`paprika circuit breaker is open (endpoint=${ENDPOINT})`);
    });
  });
});
