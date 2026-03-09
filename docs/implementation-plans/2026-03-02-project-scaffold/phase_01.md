# Project Scaffold Implementation Plan — Phase 1

**Goal:** Create all repository configuration files and verify the project installs and builds.

**Architecture:** Single ESM-only Node.js 24 package using pnpm 10.30.3 (via corepack) with TypeScript 5.9+. Configuration inherits from community-maintained tsconfig bases (`@tsconfig/strictest` for maximum type safety, `@tsconfig/node24` for correct Node 24 runtime settings).

**Tech Stack:** Node.js 24, pnpm 10.30.3, TypeScript 5.9+, @tsconfig/strictest, @tsconfig/node24

**Scope:** 2 phases from original design (phases 1-2). This is Phase 1.

**Codebase verified:** 2026-03-02

**Precondition:** A git repository has already been initialized in the project root (`.git/` exists on branch `brajkovic/project-scaffold`). The design's "Done when" states "`git init` succeeds" — this was completed prior to this implementation unit.

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### project-scaffold.AC1: Git repository is properly initialized

- **project-scaffold.AC1.1 Success:** `.git/` directory exists and `git status` returns clean output after initial commit — git repository already exists; clean state is verified in Task 5 Step 3 after the initial commit
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

### project-scaffold.AC6: Dependencies are declared

- **project-scaffold.AC6.1 Success:** `dependencies` contains exactly `dotenv`, `luxon`, `parse-duration`, `zod`
- **project-scaffold.AC6.2 Success:** `devDependencies` contains `@types/luxon`, `@types/node`, `@tsconfig/strictest`, `@tsconfig/node24`, `typescript`, `tsx`
- **project-scaffold.AC6.3 Success:** `package.json` has `"type": "module"` and `"engines": { "node": ">=24" }`

---

<!-- START_TASK_1 -->

### Task 1: Create .gitignore and mise.toml

**Files:**

- Create: `.gitignore`
- Create: `mise.toml`

**Step 1: Create `.gitignore`**

Create `.gitignore` in the project root with the following exact content:

```gitignore
dist/
node_modules/
.env
.env.*
.idea/
.vscode/
.DS_Store
Thumbs.db
*.tgz
*.swp
*.swo
```

Each line excludes one category: build output (`dist/`), dependencies (`node_modules/`), environment secrets (`.env`, `.env.*`), IDE directories (`.idea/`, `.vscode/`), OS files (`.DS_Store`, `Thumbs.db`), package archives (`*.tgz`), and editor swap files (`*.swp`, `*.swo`).

**Step 2: Create `mise.toml`**

Create `mise.toml` in the project root with the following exact content:

```toml
[tools]
node = "24"
```

This pins Node.js to major version 24 for local development. mise resolves this to the latest Node 24.x release. CI pins independently via `actions/setup-node`.

**Step 3: Verify files exist**

Run:

```bash
cat .gitignore && echo "---" && cat mise.toml
```

Expected: Both files display their contents without error.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create package.json

**Files:**

- Create: `package.json`

**Step 1: Create `package.json`**

Create `package.json` in the project root with the following exact content:

```json
{
  "name": "mcp-paprika",
  "version": "0.0.0",
  "description": "MCP server for Paprika recipe manager",
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "dotenv": "^16",
    "luxon": "^3",
    "parse-duration": "^2",
    "zod": "^3"
  },
  "devDependencies": {
    "@tsconfig/node24": "^24",
    "@tsconfig/strictest": "^2",
    "@types/luxon": "^3",
    "@types/node": "^24",
    "tsx": "^4.21",
    "typescript": "^5.9"
  }
}
```

Key fields:

- `"type": "module"` — all `.js` files use ESM semantics (import/export, not require)
- `"packageManager": "pnpm@10.30.3"` — corepack reads this to auto-install the exact pnpm version
- `"engines": { "node": ">=24" }` — documents minimum Node.js runtime
- `"build": "tsc"` — compiles TypeScript to JavaScript in `dist/`
- `"dev": "tsx src/index.ts"` — runs the entry point directly without a build step
- Dependencies are listed alphabetically within each section

**Step 2: Verify valid JSON**

Run:

```bash
node --input-type=module -e "import { readFileSync } from 'node:fs'; JSON.parse(readFileSync('package.json', 'utf8')); console.log('Valid JSON')"
```

Expected: Prints `Valid JSON` without error.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Create tsconfig.json and src/index.ts

**Files:**

- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Create `src/index.ts`**

Create the `src/` directory and an empty `src/index.ts` file:

```bash
mkdir -p src
touch src/index.ts
```

The file must exist (even empty) so that `tsc` has something to compile. Downstream units (P2-U12) will populate this as the MCP server entry point.

**Step 2: Create `tsconfig.json`**

Create `tsconfig.json` in the project root with the following exact content:

```json
{
  "extends": ["@tsconfig/strictest/tsconfig.json", "@tsconfig/node24/tsconfig.json"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

Key design decisions:

- **Array `extends`** (TypeScript 5.0+): Later entries override earlier ones. `@tsconfig/node24` provides runtime settings (`target`, `module`, `moduleResolution`, `lib`); `@tsconfig/strictest` provides type safety settings (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- **Only `outDir` and `rootDir`**: All other compiler options are inherited from the base configs. Do NOT add `target`, `module`, or `moduleResolution` — these are provided by `@tsconfig/node24`.
- `outDir: "dist"` — compiled JavaScript output goes to `dist/`
- `rootDir: "src"` — TypeScript source files live under `src/`

**Step 3: Verify files exist**

Run:

```bash
cat tsconfig.json && echo "---" && test -f src/index.ts && echo "src/index.ts exists"
```

Expected: `tsconfig.json` content is displayed, followed by `src/index.ts exists`.

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Install dependencies and verify build

**Step 1: Enable corepack**

Run:

```bash
corepack enable
```

Expected: Completes without error. This activates corepack so it can read the `packageManager` field from `package.json` and proxy the correct pnpm version.

Note: Corepack is bundled with Node.js but is NOT enabled by default in Node 24. This step is required.

**Step 2: Install dependencies**

Run:

```bash
pnpm install
```

Expected: Completes without error. Corepack intercepts the `pnpm` command, installs pnpm@10.30.3 if needed, then pnpm resolves and installs all dependencies. A `pnpm-lock.yaml` file and `node_modules/` directory are created.

Verify lockfile exists:

```bash
test -f pnpm-lock.yaml && echo "Lockfile created"
```

Expected: Prints `Lockfile created`.

**Step 3: Build the project**

Run:

```bash
pnpm build
```

Expected: `tsc` exits with code 0. An empty `src/index.ts` compiles to `dist/index.js`.

Verify output exists:

```bash
test -f dist/index.js && echo "Build output exists"
```

Expected: Prints `Build output exists`.

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Commit Phase 1 files

**Step 1: Stage all Phase 1 files**

```bash
git add .gitignore mise.toml package.json pnpm-lock.yaml tsconfig.json src/index.ts
```

Do NOT stage `node_modules/` or `dist/` — these are excluded by `.gitignore`.

**Step 2: Commit**

```bash
git commit -m "build(scaffold): initialize project with pnpm and typescript

Set up .gitignore, mise.toml (Node 24), package.json (ESM, pnpm@10.30.3,
runtime and dev dependencies), tsconfig.json (extending @tsconfig/strictest
and @tsconfig/node24), and empty src/index.ts entry point.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 3: Verify clean state**

Run:

```bash
git status
```

Expected: Working tree is clean (only untracked files from `.claude/` and `.ed3d/` which are not part of this scaffold unit).

<!-- END_TASK_5 -->
