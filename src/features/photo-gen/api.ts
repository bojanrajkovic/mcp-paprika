/**
 * Photo-gen's public contract — EMPTY. Photo-gen is a FEATURE module (the AI
 * recipe-photo generation surface): no sibling reaches into it via `ctx.deps`, so
 * it exposes no methods, exactly like discover. The one piece of state it genuinely
 * OWNS is the ephemeral `GeneratedImageStore` (the `gen_…` preview ring buffer);
 * that lives in its `state`, not in this contract.
 *
 * The reverse edge — recipe's `upload_recipe_photo` CONSUMING a `gen_` token to
 * attach a previewed image — is a recipe→photo-gen back-edge with no seam (the
 * generated-image store is photo-gen-owned, and recipe does not declare photo-gen
 * as a dependency). Adding a method here is NOT the fix — that would invert the
 * dependency (recipe depends on nothing here today); the handoff rides `infra`
 * (`Infra.generatedImageStore`) instead.
 */
// oxlint-disable-next-line no-empty-object-type
export interface PhotoGenApi {}
