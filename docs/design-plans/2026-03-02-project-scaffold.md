# Project Scaffolding Design

## Summary

This unit establishes the project scaffold for `mcp-paprika`, a Model Context Protocol server written in TypeScript that will eventually expose recipe data from the Paprika recipe manager app. The scaffold itself contains no domain logic — its purpose is to produce a clean, buildable foundation that every downstream unit can rely on: a git repository with a proper `.gitignore`, a `package.json` configured for ESM, pinned tool versions for Node and pnpm, a strict TypeScript configuration, and an empty but correctly shaped `src/` directory tree.

The approach favours exactness over flexibility. Rather than writing `tsconfig.json` settings by hand, the configuration inherits from two community-maintained base configs — `@tsconfig/strictest` for maximum type safety and `@tsconfig/node24` for correct Node 24 runtime settings — and then adds only the two project-specific settings (`outDir` and `rootDir`) on top. Tool versions are pinned at two levels: `mise.toml` pins the Node major version for local development, and the `packageManager` field in `package.json` lets corepack enforce the exact pnpm version without a separate install step. Runtime dependencies are kept to four well-scoped libraries; everything else the project needs is available natively in Node 24.

## Definition of Done

P1-U01 is done when:

1. **A git repository exists** in the project root with a proper `.gitignore` covering `dist/`, `node_modules/`, `.env*`, IDE files, and OS files.
2. **The project builds** — `corepack enable && pnpm install && pnpm build` all succeed with zero errors against an empty `src/index.ts`.
3. **Tool versions are pinned** — `mise.toml` pins Node 24, `package.json` pins `pnpm@10.30.3` via the `packageManager` field.
4. **TypeScript is configured correctly** — `tsconfig.json` extends `@tsconfig/strictest` + `@tsconfig/node24` (in that order), with only `outDir` and `rootDir` as project-specific settings.
5. **The directory skeleton exists** — all 7 subdirectories under `src/` (`paprika/`, `cache/`, `utils/`, `tools/`, `types/`, `features/`, `resources/`).
6. **Runtime dependencies are declared** — `dotenv`, `luxon`, `parse-duration`, `zod` in dependencies; `@types/node@^24`, `@types/luxon`, `@tsconfig/strictest`, `@tsconfig/node24`, `typescript`, `tsx` in devDependencies.

Out of scope: no pnpm workspaces/catalogs, no domain-driven restructuring, no CLAUDE.md (P1-U00a), no CI (P1-U00b), no linting/formatting config (P1-U00a).

## Acceptance Criteria

### project-scaffold.AC1: Git repository is properly initialized
- **project-scaffold.AC1.1 Success:** `.git/` directory exists and `git status` returns clean output after initial commit
- **project-scaffold.AC1.2 Success:** `.gitignore` excludes `dist/`, `node_modules/`, `.env`, `.env.*`, `.idea/`, `.vscode/`, `.DS_Store`, `Thumbs.db`, `*.tgz`, `*.swp`, `*.swo`

### project-scaffold.AC2: Project installs and builds
- **project-scaffold.AC2.1 Success:** `corepack enable` completes without error
- **project-scaffold.AC2.2 Success:** `pnpm install` completes without error and creates `pnpm-lock.yaml`
- **project-scaffold.AC2.3 Success:** `pnpm build` (`tsc`) exits with code 0 and produces `dist/index.js`

### project-scaffold.AC3: Tool versions are pinned
- **project-scaffold.AC3.1 Success:** `mise.toml` contains `node = "24"`
- **project-scaffold.AC3.2 Success:** `package.json` contains `"packageManager": "pnpm@10.30.3"`

### project-scaffold.AC4: TypeScript is correctly configured
- **project-scaffold.AC4.1 Success:** `tsconfig.json` `extends` array is `["@tsconfig/strictest/tsconfig.json", "@tsconfig/node24/tsconfig.json"]` in that order
- **project-scaffold.AC4.2 Success:** `tsconfig.json` `compilerOptions` contains only `outDir` and `rootDir`
- **project-scaffold.AC4.3 Failure:** Adding `target`, `module`, or `moduleResolution` to `compilerOptions` should be considered incorrect — these are inherited

### project-scaffold.AC5: Directory skeleton is complete
- **project-scaffold.AC5.1 Success:** All 7 directories exist under `src/`: `paprika/`, `cache/`, `utils/`, `tools/`, `types/`, `features/`, `resources/`
- **project-scaffold.AC5.2 Success:** Each directory contains a `.gitkeep` file
- **project-scaffold.AC5.3 Success:** `src/index.ts` exists (empty file)

### project-scaffold.AC6: Dependencies are declared
- **project-scaffold.AC6.1 Success:** `dependencies` contains exactly `dotenv`, `luxon`, `parse-duration`, `zod`
- **project-scaffold.AC6.2 Success:** `devDependencies` contains `@types/luxon`, `@types/node`, `@tsconfig/strictest`, `@tsconfig/node24`, `typescript`, `tsx`
- **project-scaffold.AC6.3 Success:** `package.json` has `"type": "module"` and `"engines": { "node": ">=24" }`

## Glossary

- **MCP (Model Context Protocol)**: An open protocol that allows AI models to interact with external tools and data sources in a structured way. This server will expose Paprika recipe data to an MCP client.
- **Paprika**: A recipe manager application. The name also identifies the `src/paprika/` module that will hold the API client for communicating with it.
- **ESM (ECMAScript Modules)**: The standard JavaScript module system using `import`/`export` syntax, as opposed to the older CommonJS `require()` system. Declaring `"type": "module"` in `package.json` opts the entire project into ESM.
- **NodeNext**: A TypeScript `module` and `moduleResolution` setting that mirrors the actual module resolution behaviour of Node.js. Requires relative imports to use `.js` file extensions in source files.
- **corepack**: A Node.js built-in tool (included since Node 16.13) that reads the `packageManager` field from `package.json` and automatically installs and proxies the declared package manager version.
- **mise**: A polyglot runtime version manager (similar to `asdf`). Used here solely to pin the Node.js major version for local development via `mise.toml`.
- **@tsconfig/strictest**: A community-maintained `tsconfig.json` base that enables every strict TypeScript flag, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`.
- **@tsconfig/node24**: A community-maintained `tsconfig.json` base that provides the correct `target`, `module`, `moduleResolution`, and `lib` settings for running on Node 24.
- **verbatimModuleSyntax**: A TypeScript compiler option (part of `@tsconfig/strictest`) that requires type-only imports to be written with `import type`, preventing accidental inclusion of runtime values in type positions.
- **tsx**: A development-time tool that runs TypeScript files directly using Node's native loader, without a compile step. Used for the `dev` script.
- **dotenv**: A library that loads environment variables from a `.env` file into `process.env` at startup.
- **luxon**: A JavaScript library for parsing, formatting, and manipulating dates and times.
- **parse-duration**: A small library that converts human-readable duration strings (e.g. `"1h30m"`) into milliseconds.
- **zod**: A TypeScript-first schema declaration and validation library. Used to validate and parse data from external sources at runtime.
- **.gitkeep**: An empty placeholder file used to force git to track an otherwise empty directory, since git does not track directories themselves.
- **YAGNI**: "You Aren't Gonna Need It" — a software design principle used to justify removing speculative configuration that serves no current use case.

## Architecture

Single ESM-only Node.js 24 package using pnpm 10.30.3 (managed via corepack) and TypeScript 5.9+.

### Package Configuration

`package.json` declares:
- `"type": "module"` — all `.js` files use ESM semantics
- `"packageManager": "pnpm@10.30.3"` — corepack reads this to auto-install the correct pnpm version
- `"engines": { "node": ">=24" }` — documents minimum runtime
- Two scripts: `build` (`tsc`) and `dev` (`tsx src/index.ts`)

Runtime dependencies (4): `dotenv@^16`, `luxon@^3`, `parse-duration@^2`, `zod@^3`.

Dev dependencies (6): `@types/luxon@^3`, `@types/node@^24`, `@tsconfig/strictest@^2`, `@tsconfig/node24@^24`, `typescript@^5.9`, `tsx@^4.21`.

### TypeScript Configuration

`tsconfig.json` extends two community base configs via array `extends` (TypeScript 5.0+):

1. `@tsconfig/strictest` (first) — maximum type safety: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, etc.
2. `@tsconfig/node24` (second) — correct runtime settings: `target: "es2024"`, `module: "nodenext"`, `moduleResolution: "nodenext"`, `lib` tuned for Node 24.

Later entries override earlier ones, so Node 24's runtime settings take precedence over any conflicting strictest settings (currently none conflict).

Only two project-specific settings: `outDir: "dist"`, `rootDir: "src"`. No `resolveJsonModule` — removed during design review (YAGNI; no unit imports JSON files, and ESM requires `with { type: "json" }` import attributes anyway).

### Tool Version Pinning

- **Node**: `mise.toml` pins `node = "24"` for local development. CI pins independently via `actions/setup-node`.
- **pnpm**: `package.json` `packageManager` field pins `pnpm@10.30.3`. Managed by corepack (bundled with Node 16.13+), not by mise.

### Directory Skeleton

```
src/
├── index.ts          # Empty — P2-U12 populates this as entry point
├── paprika/          # API client + types (P1-U05, P1-U06, P1-U07)
│   └── .gitkeep
├── cache/            # Disk cache + recipe store (P1-U08, P1-U10)
│   └── .gitkeep
├── utils/            # XDG paths, config loader, duration helper (P1-U03, P1-U04, P1-U09)
│   └── .gitkeep
├── tools/            # MCP tool handlers (Phase 2)
│   └── .gitkeep
├── types/            # ServerContext + shared server types (Phase 2)
│   └── .gitkeep
├── features/         # Photography, embeddings, vector store (Phase 3)
│   └── .gitkeep
└── resources/        # MCP resource handlers (Phase 2)
    └── .gitkeep
```

Each empty directory uses a `.gitkeep` file to preserve it in git. Downstream units create real files and remove the `.gitkeep`.

### Build & Dev Workflow

Bootstrap sequence (one-time):
1. `corepack enable` — activates corepack
2. `pnpm install` — installs dependencies, creates lockfile
3. `pnpm build` — verifies TypeScript configuration compiles cleanly

No test runner, linter, or formatter in this unit — those arrive in P1-U00a (conventions) and P1-U00b (CI).

## Existing Patterns

No existing codebase patterns — the project directory is empty. This is the root unit that establishes all conventions for downstream units.

Key conventions established here that downstream units must follow:
- **ESM with `.js` extensions**: `module: "nodenext"` requires all relative imports to use `.js` extensions in source files (e.g., `import { foo } from './bar.js'` even though the source is `bar.ts`).
- **No manual tsconfig overrides**: Downstream units must not add `target`, `module`, or `moduleResolution` to tsconfig — these are inherited from `@tsconfig/node24`.
- **Minimal runtime dependencies**: Node 24 provides `fetch`, `FormData`, `Blob`, `node:zlib`, `node:crypto`, and `node:fs/promises` natively. Do not add packages like `node-fetch`, `axios`, `uuid`, or `form-data`.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Repository and Configuration Files

**Goal:** Initialize git repository and create all configuration files.

**Components:**
- Git repository initialization and `.gitignore`
- `mise.toml` — Node version pinning
- `package.json` — project metadata, scripts, dependencies, corepack config
- `tsconfig.json` — TypeScript configuration extending community bases

**Dependencies:** None (root phase)

**Done when:** `git init` succeeds, all config files exist with correct content, `corepack enable && pnpm install` succeeds, `pnpm build` compiles the empty `src/index.ts` without errors.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Directory Skeleton

**Goal:** Create the `src/` directory structure that downstream units populate.

**Components:**
- `src/index.ts` — empty entry point
- 7 subdirectories under `src/` with `.gitkeep` files: `paprika/`, `cache/`, `utils/`, `tools/`, `types/`, `features/`, `resources/`

**Dependencies:** Phase 1 (repository must exist)

**Done when:** All 7 directories exist, `pnpm build` still compiles cleanly, initial commit is created.
<!-- END_PHASE_2 -->

## Additional Considerations

**Spec corrections applied:**
- Original spec AC #8 stated "no entries in dependencies" — contradicts the package.json template which lists 4 runtime dependencies. This design includes the 4 runtime deps as specified in the package.json template.
- `@types/node` updated from `^22` to `^24` to match Node 24 LTS target.
- `resolveJsonModule` removed from tsconfig (no unit imports JSON files; ESM requires import attributes anyway).
- Version caret ranges updated to current: `typescript@^5.9`, `tsx@^4.21`.

**NodeNext import convention:** The `.js` extension requirement in imports is a TypeScript convention, not a bug. `import { foo } from './bar.js'` resolves to `bar.ts` during compilation and `bar.js` at runtime. This must be documented in CLAUDE.md (P1-U00a).
