import type { DiagApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { forwardingProbeTool } from "./tools/forwarding-probe.js";

// Self-register the public contract TYPE. Diag is a FEATURE (the config-gated
// diagnostics surface): no sibling consumes it, so its contract is empty —
// exactly like discover and photo-gen. It depends on nothing.
declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    diag: DiagApi;
  }
}

/**
 * The diag module's state: the gate it reads at build time. Diag owns no Paprika
 * entity, contributes no syncs, and registers its tools ONLY when `MCP_DIAG` is
 * on.
 *
 * This is CONDITIONAL registration, not the no-op-in-handler gate discover and
 * photo-gen use: a diagnostic must be ABSENT from the advertised `tools/list` in
 * production (so it ships nothing into normal results and the model never sees
 * it), which an always-registered-but-inert tool would not achieve.
 */
export interface DiagState {
  readonly enabled: boolean;
}

register(
  defineModule("diag", [])
    .state<DiagState>((infra) => ({ enabled: infra.config.diagnostics }))
    .build((state) => ({
      api: {},
      tools: state.enabled ? [forwardingProbeTool] : [],
    })),
);
