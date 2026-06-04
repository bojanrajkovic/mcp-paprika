# Shared Tool Helpers

Last verified: 2026-06-04

## Purpose

The few genuinely cross-cutting helpers the tool layer shares across domains — the leftovers from dissolving `src/tools/` (ADR-0009 §3) that belong to no single domain. Domain-specific helpers (the `*ToMarkdown` formatters, the meal-type spec/resolve) live with their domain under `src/domains/<domain>/`, not here.

## Contents

- `tools.ts` — `textResult` (the MCP text-content wire envelope every tool returns) and the uid-or-text lookup abstraction (`uidOrTextLookupSchema` + `resolveLookup` + `formatLookupOutcome` + the `LookupQuery`/`LookupOutcome` types) shared by the `read_*` tools.
- `photo-fetch.ts` — `fetchImageBytes` + `MAX_IMAGE_BYTES`: the SSRF-guarded image download used by both recipe photo uploads and AI photo generation.

## Sharp edges

- **`photo-fetch.ts` is the SSRF chokepoint — keep it strict.** It blocks private/loopback/link-local IPs after DNS resolution (not just by hostname), caps the body at `MAX_IMAGE_BYTES`, and is the only sanctioned way to pull a remote image. A photo `source` deliberately has no `file_path` (that would be LFI/SSRF); see `src/domains/recipe/`'s photo tooling and ADR-0004's photo notes.
- **This directory is for cross-domain leaves only.** If a helper is used by exactly one domain, it belongs in that domain. Resist the gravity that turned the old `src/tools/` into a god-bag.
