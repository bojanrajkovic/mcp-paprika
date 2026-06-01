# Recipe-hash ground-truth fixture generator

`computeRecipeHash` (`src/paprika/recipe-hash.ts`) reimplements Paprika's
client-owned recipe content hash in TypeScript so writes are hash-consistent and
the next sync stops re-fetching them (#167). The algorithm was reverse-engineered
from the shipped macOS app's `Paprika.framework`.

This tool regenerates the parity fixtures (`src/paprika/__fixtures__/recipe-hashes.ts`)
by calling the framework's **real** `Recipe.hashValues` getter over synthetic
recipes, so the TS port is pinned to authoritative output rather than a transcribed
spec.

## How it works

- `shim.c` / `shim.h` — a one-function C `swiftcall` bridge that forwards `self` in
  the Swift self/context register, so we can `dlsym` and call the pure-Swift
  `Recipe.hashValues` getter (it isn't `@objc`-reachable, so `objc_msgSend` can't
  reach it; `@convention(method)` isn't expressible in a Swift typealias either).
- `generate.swift` — loads the framework + its bundled Core Data model, builds
  in-memory `Recipe` objects spanning the edge cases (0/1/many categories with
  mixed-case UIDs, empty-vs-null fields, forward slashes, non-ASCII), calls
  `hashValues`, and emits `{name, recipe, expectedHash}` JSON. `recipe` is in our
  camelCase `Recipe` shape so the fixture feeds straight into `computeRecipeHash`.

## Re-verifying against a real app (drift check)

Static fixtures only certify that we match the framework version captured. To check
for **going-forward drift** (a future Paprika release changing the algorithm), run
this on a Mac with Paprika installed and see whether the committed fixtures change:

```bash
bash scripts/recipe-hash-fixtures/run.sh
git diff --stat src/paprika/__fixtures__/recipe-hashes.ts
pnpm vitest run src/paprika/recipe-hash.test.ts
```

- **No diff** → the official algorithm is unchanged; `computeRecipeHash` is still correct.
- **Fixture hashes changed** → Paprika changed its hash algorithm. The fixtures now
  reflect the new truth and the TS test will fail until `computeRecipeHash` is
  re-derived to match (inspect the new `frameworkJson` the generator can emit to see
  exactly what changed).

Prerequisites: macOS, Paprika Recipe Manager 3 (default `/Applications`, or set
`PAPRIKA_FRAMEWORK`), and Xcode command-line tools (`swiftc`, `clang`).
