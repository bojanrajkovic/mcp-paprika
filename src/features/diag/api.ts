import type { EmptyApi } from "../../kernel/registry.js";

/**
 * Diag's public contract — EMPTY. Diag is a FEATURE module (the config-gated
 * diagnostics surface): no sibling reaches into it via `ctx.deps`, so it exposes
 * no methods, exactly like discover and photo-gen. It owns no entity and no
 * state beyond the gate it reads at build time.
 */
export type DiagApi = EmptyApi;
