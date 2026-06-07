// Auth-surface counters, recorded at the decision points the audit log lines
// already mark. Co-located with auth (not src/telemetry/) because auth is the
// sole owner — the same rule that keeps the auth disk caches in auth/disk.ts.
//
// Attribute discipline is STRICTER here than the logs: only enum-valued
// outcomes — grant types, OAuth error classes, decision names. No sub, no
// email, no client ids, no token material; the full who/why stays in the
// operator log behind REDACT_PATHS.

import { getMeter, lazy } from "../telemetry/scope.js";

export const ATTR_AUTH_GRANT_TYPE = "mcp_paprika.auth.grant_type";
export const ATTR_AUTH_OUTCOME = "mcp_paprika.auth.outcome";
export const ATTR_AUTH_ENDPOINT = "mcp_paprika.auth.endpoint";
export const ATTR_AUTH_REASON = "mcp_paprika.auth.reason";
export const ATTR_AUTH_DECISION = "mcp_paprika.auth.decision";

/** Access tokens minted, by grant type (authorization_code | refresh_token). */
export const tokensIssued = lazy(() =>
  getMeter().createCounter("mcp_paprika.auth.tokens_issued", {
    description: "Access tokens minted, by grant type",
    unit: "{token}",
  }),
);

/** Bearer-token checks on MCP requests: outcome ok | invalid — the per-request auth health signal. */
export const tokenVerifications = lazy(() =>
  getMeter().createCounter("mcp_paprika.auth.token_verifications", {
    description: "Access-token verifications on MCP requests",
    unit: "{check}",
  }),
);

/** Failed auth-flow decisions, by endpoint + enum reason (identity_not_allowed is the security signal). */
export const authFailures = lazy(() =>
  getMeter().createCounter("mcp_paprika.auth.failures", {
    description: "Auth-flow denials and failures, by endpoint and reason",
    unit: "{failure}",
  }),
);

/** Confused-deputy consent screen outcomes (allow | deny | expired). */
export const consentDecisions = lazy(() =>
  getMeter().createCounter("mcp_paprika.auth.consent", {
    description: "Consent-screen decisions for unrecognized redirect origins",
    unit: "{decision}",
  }),
);

/** Successful dynamic client registrations. */
export const dcrRegistrations = lazy(() =>
  getMeter().createCounter("mcp_paprika.auth.dcr.registrations", {
    description: "Clients registered via DCR",
    unit: "{client}",
  }),
);
