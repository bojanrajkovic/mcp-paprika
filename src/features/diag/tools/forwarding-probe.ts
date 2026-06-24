import { randomUUID } from "node:crypto";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { DiagState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";

/** The `structuredContent` key the one-time probe token rides on. */
const FORWARDING_PROBE_TOKEN_KEY = "forwarding_probe_token";

/**
 * Diagnostic probe for whether a host forwards `structuredContent` to its model.
 *
 * Since the structured payload now travels on BOTH channels for every
 * schema-bearing tool (the text carries it as JSON too), forwarding can no longer
 * be observed passively — there is no structured-only data left to watch. This
 * probe restores a structured-only signal ON PURPOSE: it returns a fresh random
 * token placed ONLY in `structuredContent`, NEVER in the text block — the inverse
 * of `structuredResult` (which mirrors the payload to text). The operator asks the
 * model in each host to read the token back; if it can, the host forwards
 * `structuredContent` to the model.
 *
 * It is config-gated (`MCP_DIAG`) and registered only when enabled, so it ships
 * nothing into normal production results. A production tool must NEVER withhold a
 * chainable identifier from the text this way.
 */
export const forwardingProbeTool = defineTool(
  {
    name: "diag_forwarding_probe",
    title: "Diagnostic: structuredContent forwarding probe",
    description:
      `Diagnostic. Returns a fresh random token placed ONLY in this result's structured content (key "${FORWARDING_PROBE_TOKEN_KEY}"), never in the text block. ` +
      "Repeat the token back verbatim: if you can, this host forwards structuredContent to the model; if you can only see the prose, it does not.",
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {},
  },
  (ctx: DomainCtx<DiagState, never>) => {
    const log = ctx.infra.log.child({ component: "diag-forwarding-probe" });
    return () => {
      const probeToken = randomUUID();
      // Logged server-side as `probeToken` (NOT a `token`-named field, which the
      // logger's REDACT_PATHS would censor) so the operator can cross-check what
      // the model echoed against what the structured channel actually carried.
      log.info({ probeToken }, "forwarding probe invoked");
      // Token in structuredContent ONLY — deliberately absent from the text block.
      return toolResult(
        `Forwarding probe: a one-time token was placed in this result's structured content under "${FORWARDING_PROBE_TOKEN_KEY}". ` +
          "If you can read it, repeat it back verbatim. If you can only see this sentence, you cannot see the structured channel.",
        { [FORWARDING_PROBE_TOKEN_KEY]: probeToken },
      );
    };
  },
);
