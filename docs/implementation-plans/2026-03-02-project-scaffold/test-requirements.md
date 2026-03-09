# Test Requirements: Project Scaffold

## Overview

This is an infrastructure scaffold unit (P1-U01). The design explicitly states: "No test runner, linter, or formatter in this unit." There are no automated tests. All acceptance criteria are verified through human inspection — running commands and checking their output against expected results.

Every criterion below is a **human verification** item. Each specifies the command(s) to run, what to inspect, and the expected result.

## Human Verification Checklist

### project-scaffold.AC1: Git repository is properly initialized

- [ ] **project-scaffold.AC1.1** — `.git/` directory exists and working tree is clean after initial commit
  - **Command:** `test -d .git && echo "Git repo exists" && git status`
  - **Expected:** Prints "Git repo exists" followed by `git status` output showing a clean working tree (no staged, modified, or untracked files relevant to the scaffold). Untracked `.claude/` or `.ed3d/` directories are acceptable and outside this unit's scope.

- [ ] **project-scaffold.AC1.2** — `.gitignore` excludes all required patterns
  - **Command:** `cat .gitignore`
  - **Expected:** The file contains exactly these entries (one per line, in any order): `dist/`, `node_modules/`, `.env`, `.env.*`, `.idea/`, `.vscode/`, `.DS_Store`, `Thumbs.db`, `*.tgz`, `*.swp`, `*.swo`

### project-scaffold.AC2: Project installs and builds

- [ ] **project-scaffold.AC2.1** — `corepack enable` completes without error
  - **Command:** `corepack enable`
  - **Expected:** Exit code 0, no error output.

- [ ] **project-scaffold.AC2.2** — `pnpm install` completes without error and creates `pnpm-lock.yaml`
  - **Command:** `pnpm install && test -f pnpm-lock.yaml && echo "Lockfile created"`
  - **Expected:** `pnpm install` exits with code 0, all dependencies resolve, and the final line prints "Lockfile created".

- [ ] **project-scaffold.AC2.3** — `pnpm build` exits with code 0 and produces `dist/index.js`
  - **Command:** `pnpm build && test -f dist/index.js && echo "Build output exists"`
  - **Expected:** `tsc` compiles with zero errors (exit code 0) and the final line prints "Build output exists".

### project-scaffold.AC3: Tool versions are pinned

- [ ] **project-scaffold.AC3.1** — `mise.toml` pins Node to major version 24
  - **Command:** `cat mise.toml`
  - **Expected:** File contains a `[tools]` section with `node = "24"`.

- [ ] **project-scaffold.AC3.2** — `package.json` pins pnpm via the `packageManager` field
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); console.log(p.packageManager)"`
  - **Expected:** Prints exactly `pnpm@10.30.3`.

### project-scaffold.AC4: TypeScript is correctly configured

- [ ] **project-scaffold.AC4.1** — `tsconfig.json` extends the two community base configs in the correct order
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const t = JSON.parse(readFileSync('tsconfig.json', 'utf8')); console.log(JSON.stringify(t.extends))"`
  - **Expected:** Prints `["@tsconfig/strictest/tsconfig.json","@tsconfig/node24/tsconfig.json"]` — strictest first, node24 second.

- [ ] **project-scaffold.AC4.2** — `tsconfig.json` `compilerOptions` contains only `outDir` and `rootDir`
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const t = JSON.parse(readFileSync('tsconfig.json', 'utf8')); console.log(Object.keys(t.compilerOptions).sort().join(', '))"`
  - **Expected:** Prints `outDir, rootDir` (exactly two keys, alphabetically sorted).

- [ ] **project-scaffold.AC4.3** — `compilerOptions` does NOT contain `target`, `module`, or `moduleResolution`
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const t = JSON.parse(readFileSync('tsconfig.json', 'utf8')); const bad = ['target','module','moduleResolution'].filter(k => k in t.compilerOptions); if (bad.length) { console.error('FAIL: found prohibited keys:', bad); process.exit(1); } else { console.log('PASS: no prohibited keys'); }"`
  - **Expected:** Prints "PASS: no prohibited keys". These settings are inherited from `@tsconfig/node24` and must not be overridden.

### project-scaffold.AC5: Directory skeleton is complete

- [ ] **project-scaffold.AC5.1** — All 7 directories exist under `src/`
  - **Command:** `for d in paprika cache utils tools types features resources; do test -d "src/$d" && echo "OK: src/$d" || echo "MISSING: src/$d"; done`
  - **Expected:** All 7 lines print "OK". No "MISSING" lines.

- [ ] **project-scaffold.AC5.2** — Each directory contains a `.gitkeep` file
  - **Command:** `for d in paprika cache utils tools types features resources; do test -f "src/$d/.gitkeep" && echo "OK: src/$d/.gitkeep" || echo "MISSING: src/$d/.gitkeep"; done`
  - **Expected:** All 7 lines print "OK". No "MISSING" lines.

- [ ] **project-scaffold.AC5.3** — `src/index.ts` exists
  - **Command:** `test -f src/index.ts && echo "src/index.ts exists" || echo "MISSING: src/index.ts"`
  - **Expected:** Prints "src/index.ts exists". The file may be empty (zero bytes) — that is correct for this scaffold unit.

### project-scaffold.AC6: Dependencies are declared

- [ ] **project-scaffold.AC6.1** — `dependencies` contains exactly `dotenv`, `luxon`, `parse-duration`, `zod`
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); const deps = Object.keys(p.dependencies).sort(); console.log(deps.join(', ')); const expected = ['dotenv','luxon','parse-duration','zod']; if (JSON.stringify(deps) === JSON.stringify(expected)) console.log('PASS'); else { console.error('FAIL: expected', expected); process.exit(1); }"`
  - **Expected:** Prints `dotenv, luxon, parse-duration, zod` followed by "PASS".

- [ ] **project-scaffold.AC6.2** — `devDependencies` contains the required 6 packages
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); const deps = Object.keys(p.devDependencies).sort(); console.log(deps.join(', ')); const expected = ['@tsconfig/node24','@tsconfig/strictest','@types/luxon','@types/node','tsx','typescript']; if (JSON.stringify(deps) === JSON.stringify(expected)) console.log('PASS'); else { console.error('FAIL: expected', expected); process.exit(1); }"`
  - **Expected:** Prints `@tsconfig/node24, @tsconfig/strictest, @types/luxon, @types/node, tsx, typescript` followed by "PASS".

- [ ] **project-scaffold.AC6.3** — `package.json` has `"type": "module"` and `"engines": { "node": ">=24" }`
  - **Command:** `node --input-type=module -e "import { readFileSync } from 'node:fs'; const p = JSON.parse(readFileSync('package.json', 'utf8')); let ok = true; if (p.type !== 'module') { console.error('FAIL: type is', p.type); ok = false; } if (!p.engines || p.engines.node !== '>=24') { console.error('FAIL: engines.node is', p.engines?.node); ok = false; } if (ok) console.log('PASS: type=module, engines.node=>=24');"`
  - **Expected:** Prints "PASS: type=module, engines.node=>=24".

## Full End-to-End Verification

After all individual checks pass, run the complete bootstrap sequence from a clean state to verify the entire scaffold works as an integrated unit:

- [ ] **project-scaffold.E2E** — Full bootstrap from clean checkout
  - **Commands (run in sequence):**
    ```bash
    corepack enable
    pnpm install
    pnpm build
    test -f dist/index.js && echo "Build output exists"
    git status
    ```
  - **Expected:** All commands exit with code 0. `dist/index.js` exists. `git status` shows a clean working tree (excluding out-of-scope directories like `.claude/`).
