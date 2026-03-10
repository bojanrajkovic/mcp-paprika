/**
 * Typed HTTP client for the Paprika Cloud Sync API.
 *
 * Encapsulates authentication against the v1 login endpoint
 * and resilient request execution against the v2 data endpoint.
 *
 * No recipe or category read/write methods — those are deferred
 * to P1-U06 and P1-U07.
 */

import {
  ExponentialBackoff,
  ConsecutiveBreaker,
  retry,
  circuitBreaker,
  handleType,
  wrap,
  BrokenCircuitError,
} from "cockatiel";
import type { ZodType } from "zod";
import { z } from "zod";
import { AuthResponseSchema } from "./types.js";
import { PaprikaAuthError, PaprikaAPIError } from "./errors.js";

const AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
// @ts-expect-error API_BASE will be used by public methods in P1-U06 and P1-U07
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const API_BASE = "https://paprikaapp.com/api/v2/sync";

class TransientHTTPError extends Error {
  constructor(readonly status: number) {
    super(`Transient HTTP error (${status.toString()})`);
    this.name = "TransientHTTPError";
  }
}

class TokenExpiredError extends Error {
  constructor() {
    super("Token expired");
    this.name = "TokenExpiredError";
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);

const retryPolicy = retry(handleType(TransientHTTPError), {
  maxAttempts: 3,
  backoff: new ExponentialBackoff({
    initialDelay: 500,
    maxDelay: 10_000,
  }),
});

const breakerPolicy = circuitBreaker(handleType(TransientHTTPError), {
  halfOpenAfter: 30_000,
  breaker: new ConsecutiveBreaker(5),
});

const resilience = wrap(retryPolicy, breakerPolicy);

export class PaprikaClient {
  private token: string | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
  ) {}

  async authenticate(): Promise<void> {
    const response = await fetch(AUTH_URL, {
      method: "POST",
      body: new URLSearchParams({ email: this.email, password: this.password }),
    });

    if (!response.ok) {
      throw new PaprikaAuthError(`Authentication failed (HTTP ${response.status.toString()})`);
    }

    const json: unknown = await response.json();
    const data = AuthResponseSchema.parse(json);
    this.token = data.result.token;
  }

  // @ts-expect-error request will be used by public methods in P1-U06 and P1-U07
  private async request<T>(
    method: "GET" | "POST",
    url: string,
    schema: ZodType<T>,
    body?: FormData | URLSearchParams,
  ): Promise<T> {
    const execute = async (): Promise<T> => {
      const headers: Record<string, string> = {};
      if (this.token) {
        headers["Authorization"] = `Bearer ${this.token}`;
      }

      const fetchInit: RequestInit = { method, headers };
      if (body !== undefined) {
        fetchInit.body = body;
      }

      const response = await fetch(url, fetchInit);

      if (!response.ok) {
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new TransientHTTPError(response.status);
        }

        if (response.status === 401) {
          throw new TokenExpiredError();
        }

        throw new PaprikaAPIError("Request failed", response.status, url);
      }

      const json: unknown = await response.json();
      const envelope = z.object({ result: schema }).parse(json);
      return envelope.result as T;
    };

    try {
      return await resilience.execute(execute);
    } catch (error) {
      if (error instanceof BrokenCircuitError) {
        throw new PaprikaAPIError("Service unavailable (circuit open)", 503, url);
      }

      if (error instanceof TokenExpiredError) {
        if (!this.token) {
          throw new PaprikaAuthError("Authentication required (HTTP 401)");
        }

        await this.authenticate();

        try {
          return await resilience.execute(execute);
        } catch (retryError) {
          if (retryError instanceof TokenExpiredError) {
            throw new PaprikaAuthError("Authentication failed after re-auth (HTTP 401)");
          }
          if (retryError instanceof BrokenCircuitError) {
            throw new PaprikaAPIError("Service unavailable (circuit open)", 503, url);
          }
          throw retryError;
        }
      }

      throw error;
    }
  }
}
