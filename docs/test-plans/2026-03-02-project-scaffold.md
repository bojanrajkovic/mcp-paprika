# Human Test Plan: Project Scaffold

## Prerequisites

- Node.js 24.x installed (via `mise` or directly)
- `corepack` available (ships with Node.js)
- Git repository checked out on `brajkovic/project-scaffold` branch
- Working directory: project root

## Phase 1: Git Repository Initialization (AC1)

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Run `test -d .git && echo "Git repo exists" && git status` | Prints "Git repo exists" followed by `git status` showing a clean working tree. Untracked `.claude/` or `.ed3d/` directories are acceptable. |
| 1.2 | Run `cat .gitignore` | File contains exactly these entries (one per line, any order): `dist/`, `node_modules/`, `.env`, `.env.*`, `.idea/`, `.vscode/`, `.DS_Store`, `Thumbs.db`, `*.tgz`, `*.swp`, `*.swo`. No extra entries, no missing entries. |

## Phase 2: Install and Build (AC2)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Run `corepack enable` | Exit code 0, no error output. |
| 2.2 | Run `pnpm install && test -f pnpm-lock.yaml && echo "Lockfile created"` | pnpm resolves all dependencies without errors. Final line prints "Lockfile created". |
| 2.3 | Run `pnpm build && test -f dist/index.js && echo "Build output exists"` | TypeScript compiles with zero errors (exit code 0). Final line prints "Build output exists". |

## Phase 3: Tool Version Pinning (AC3)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Run `cat mise.toml` | File contains a `[tools]` section with exactly `node = "24"`. |
| 3.2 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); console.log(p.packageManager)"` | Prints exactly `pnpm@10.30.3`. |

## Phase 4: TypeScript Configuration (AC4)

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const t = JSON.parse(readFileSync('tsconfig.json', 'utf8')); console.log(JSON.stringify(t.extends))"` | Prints `["@tsconfig/strictest/tsconfig.json","@tsconfig/node24/tsconfig.json"]` — strictest first, node24 second. |
| 4.2 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const t = JSON.parse(readFileSync('tsconfig.json', 'utf8')); console.log(Object.keys(t.compilerOptions).sort().join(', '))"` | Prints exactly `outDir, rootDir` (two keys, alphabetically sorted). |
| 4.3 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const t = JSON.parse(readFileSync('tsconfig.json', 'utf8')); const bad = ['target','module','moduleResolution'].filter(k => k in t.compilerOptions); if (bad.length) { console.error('FAIL: found prohibited keys:', bad); process.exit(1); } else { console.log('PASS: no prohibited keys'); }"` | Prints "PASS: no prohibited keys". These settings are inherited from `@tsconfig/node24`. |

## Phase 5: Directory Skeleton (AC5)

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Run `for d in paprika cache utils tools types features resources; do test -d "src/$d" && echo "OK: src/$d" \|\| echo "MISSING: src/$d"; done` | All 7 lines print "OK". Zero "MISSING" lines. |
| 5.2 | Run `for d in paprika cache utils tools types features resources; do test -f "src/$d/.gitkeep" && echo "OK: src/$d/.gitkeep" \|\| echo "MISSING: src/$d/.gitkeep"; done` | All 7 lines print "OK". Each directory contains a `.gitkeep` file. |
| 5.3 | Run `test -f src/index.ts && echo "src/index.ts exists" \|\| echo "MISSING: src/index.ts"` | Prints "src/index.ts exists". The file may be empty (zero bytes). |

## Phase 6: Dependency Declarations (AC6)

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); const deps = Object.keys(p.dependencies).sort(); console.log(deps.join(', ')); const expected = ['dotenv','luxon','parse-duration','zod']; if (JSON.stringify(deps) === JSON.stringify(expected)) console.log('PASS'); else { console.error('FAIL: expected', expected); process.exit(1); }"` | Prints `dotenv, luxon, parse-duration, zod` followed by "PASS". |
| 6.2 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); const deps = Object.keys(p.devDependencies).sort(); console.log(deps.join(', ')); const expected = ['@tsconfig/node24','@tsconfig/strictest','@types/luxon','@types/node','tsx','typescript']; if (JSON.stringify(deps) === JSON.stringify(expected)) console.log('PASS'); else { console.error('FAIL: expected', expected); process.exit(1); }"` | Prints `@tsconfig/node24, @tsconfig/strictest, @types/luxon, @types/node, tsx, typescript` followed by "PASS". |
| 6.3 | Run `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); let ok = true; if (p.type !== 'module') { console.error('FAIL: type is', p.type); ok = false; } if (!p.engines \|\| p.engines.node !== '>=24') { console.error('FAIL: engines.node is', p.engines?.node); ok = false; } if (ok) console.log('PASS: type=module, engines.node=>=24');"` | Prints "PASS: type=module, engines.node=>=24". |

## End-to-End: Full Bootstrap from Clean State

**Purpose:** Validates the entire scaffold works as an integrated unit from scratch.

1. Start from a clean checkout on the scaffold branch
2. Run `corepack enable` — verify exit code 0
3. Run `pnpm install` — verify exit code 0, all dependencies resolve
4. Run `pnpm build` — verify exit code 0, no TypeScript errors
5. Run `test -f dist/index.js && echo "Build output exists"` — verify printed
6. Run `git status` — verify clean working tree

## Traceability

| Acceptance Criterion | Manual Step |
|----------------------|-------------|
| project-scaffold.AC1.1 | Phase 1, Step 1.1 |
| project-scaffold.AC1.2 | Phase 1, Step 1.2 |
| project-scaffold.AC2.1 | Phase 2, Step 2.1 |
| project-scaffold.AC2.2 | Phase 2, Step 2.2 |
| project-scaffold.AC2.3 | Phase 2, Step 2.3 |
| project-scaffold.AC3.1 | Phase 3, Step 3.1 |
| project-scaffold.AC3.2 | Phase 3, Step 3.2 |
| project-scaffold.AC4.1 | Phase 4, Step 4.1 |
| project-scaffold.AC4.2 | Phase 4, Step 4.2 |
| project-scaffold.AC4.3 | Phase 4, Step 4.3 |
| project-scaffold.AC5.1 | Phase 5, Step 5.1 |
| project-scaffold.AC5.2 | Phase 5, Step 5.2 |
| project-scaffold.AC5.3 | Phase 5, Step 5.3 |
| project-scaffold.AC6.1 | Phase 6, Step 6.1 |
| project-scaffold.AC6.2 | Phase 6, Step 6.2 |
| project-scaffold.AC6.3 | Phase 6, Step 6.3 |
| project-scaffold.E2E | End-to-End section |
