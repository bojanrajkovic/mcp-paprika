# P3-U09 npm Publish — Phase 1: Package Configuration and Project Files

**Goal:** Prepare the package for npm publishing — update package.json, tsconfig, add shebang, LICENSE, and README.

**Architecture:** Infrastructure changes only — no new runtime code. Update existing config files and create required project files for npm distribution.

**Tech Stack:** TypeScript, pnpm, npm registry

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-03-20

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### p3-u09-npm-publish.AC1: Package configuration

- **p3-u09-npm-publish.AC1.1 Success:** `package.json` has `name: "@bojanrajkovic/mcp-paprika"`
- **p3-u09-npm-publish.AC1.2 Success:** `package.json` has `bin: { "mcp-paprika": "dist/index.js" }`
- **p3-u09-npm-publish.AC1.3 Success:** `package.json` has `files: ["dist", "README.md", "LICENSE"]`
- **p3-u09-npm-publish.AC1.4 Success:** `package.json` has `publishConfig: { "access": "public" }`
- **p3-u09-npm-publish.AC1.5 Success:** `package.json` has `license: "MIT"`

### p3-u09-npm-publish.AC2: Build output

- **p3-u09-npm-publish.AC2.1 Success:** `dist/index.js` starts with `#!/usr/bin/env node`
- **p3-u09-npm-publish.AC2.2 Success:** `dist/index.d.ts` exists (TypeScript declaration files generated)
- **p3-u09-npm-publish.AC2.3 Success:** `pnpm pack` produces a tarball containing only `dist/`, `README.md`, and `LICENSE` (no source, tests, or config files)

### p3-u09-npm-publish.AC3: Project files

- **p3-u09-npm-publish.AC3.1 Success:** `LICENSE` file exists with MIT license text
- **p3-u09-npm-publish.AC3.2 Success:** `README.md` exists with package name, description, and installation instructions

### p3-u09-npm-publish.AC4b: CI compatibility

- **p3-u09-npm-publish.AC4b.1 Success:** Existing CI workflow (`ci.yml`) continues to pass with the updated package.json and tsconfig changes
- **p3-u09-npm-publish.AC4b.2 Success:** `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass locally after changes

---

## Context Files

- `/home/brajkovic/Projects/mcp-paprika/CLAUDE.md` — Project conventions
- `/home/brajkovic/Projects/mcp-paprika/.ed3d/implementation-plan-guidance.md` — Implementation standards

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

## Subcomponent A: Package Configuration

<!-- START_TASK_1 -->

### Task 1: Update `package.json` with publish fields

**Verifies:** p3-u09-npm-publish.AC1.1, p3-u09-npm-publish.AC1.2, p3-u09-npm-publish.AC1.3, p3-u09-npm-publish.AC1.4, p3-u09-npm-publish.AC1.5

**Files:**

- Modify: `package.json`

**Implementation:**

Update `package.json` to add npm publishing fields. The current file has `name: "mcp-paprika"` — this needs to become the scoped name `@bojanrajkovic/mcp-paprika`. Add `bin`, `files`, `publishConfig`, and `license` fields.

Changes to make (add/modify these fields at the top level):

1. **Change** `"name"` from `"mcp-paprika"` to `"@bojanrajkovic/mcp-paprika"`
2. **Add** `"license": "MIT"` (after `"description"`)
3. **Add** `"bin"` field:
   ```json
   "bin": {
     "mcp-paprika": "dist/index.js"
   }
   ```
4. **Add** `"files"` field:
   ```json
   "files": ["dist", "README.md", "LICENSE"]
   ```
5. **Add** `"publishConfig"` field:
   ```json
   "publishConfig": {
     "access": "public"
   }
   ```

Place `license` near the top with other metadata fields. Place `bin`, `files`, and `publishConfig` after `scripts` but before `dependencies`.

**Verification:**
Run: `cat package.json | node -e "const p=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(p.name, p.license, JSON.stringify(p.bin), JSON.stringify(p.files), JSON.stringify(p.publishConfig))"`
Expected: `@bojanrajkovic/mcp-paprika MIT {"mcp-paprika":"dist/index.js"} ["dist","README.md","LICENSE"] {"access":"public"}`

**Commit:** `build: configure package.json for npm publishing`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Add `declaration: true` to `tsconfig.json`

**Verifies:** p3-u09-npm-publish.AC2.2

**Files:**

- Modify: `tsconfig.json`

**Implementation:**

Add `"declaration": true` to the `compilerOptions` object. The current tsconfig extends `@tsconfig/strictest` and `@tsconfig/node24` — neither includes `declaration: true`, so it must be added explicitly.

Current `compilerOptions`:

```json
{
  "outDir": "dist",
  "rootDir": "src"
}
```

Updated `compilerOptions`:

```json
{
  "outDir": "dist",
  "rootDir": "src",
  "declaration": true
}
```

This causes `tsc` to emit `.d.ts` files alongside `.js` files in `dist/`. With `"module": "NodeNext"` (from `@tsconfig/node24`) and `"type": "module"` in package.json, the generated `.d.ts` files are treated as ESM declarations.

**Verification:**
Run: `pnpm build && ls dist/index.d.ts`
Expected: `dist/index.d.ts` exists

**Commit:** `build: enable TypeScript declaration file generation`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Add shebang to `src/index.ts`

**Verifies:** p3-u09-npm-publish.AC2.1

**Files:**

- Modify: `src/index.ts` (first line only)

**Implementation:**

Add `#!/usr/bin/env node` as the very first line of `src/index.ts`. TypeScript's compiler (`tsc`) preserves shebangs at the top of files when compiling, so the shebang will appear in `dist/index.js` after build.

The current first line is:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
```

Add the shebang before it:

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
```

**Verification:**
Run: `pnpm build && head -1 dist/index.js`
Expected: `#!/usr/bin/env node`

**Commit:** `build: add shebang for CLI execution`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

## Subcomponent B: Project Files

<!-- START_TASK_4 -->

### Task 4: Create `LICENSE` file

**Verifies:** p3-u09-npm-publish.AC3.1

**Files:**

- Create: `LICENSE`

**Implementation:**

Create an MIT license file in the project root. Use the standard MIT license text with:

- Year: 2026
- Copyright holder: Bojan Rajkovic

```
MIT License

Copyright (c) 2026 Bojan Rajkovic

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Verification:**
Run: `head -3 LICENSE`
Expected: Shows "MIT License" and copyright line

**Commit:** `docs: add MIT license`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Create `README.md`

**Verifies:** p3-u09-npm-publish.AC3.2

**Files:**

- Create: `README.md`

**Implementation:**

Create a minimal README with the package name, description, and installation instructions. Include:

- Package name as heading
- One-line description
- Installation command (both global and npx)
- Basic configuration/usage section mentioning MCP client configuration
- License reference

The README should be practical and concise — this is an MCP server, so usage involves configuring an MCP client (like Claude Desktop) to run the binary, not importing it as a library.

**Verification:**
Run: `head -5 README.md`
Expected: Shows package name heading and description

**Commit:** `docs: add README with installation and usage`

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

## Subcomponent C: Build and Pack Verification

<!-- START_TASK_6 -->

### Task 6: Verify build output and pack tarball

**Verifies:** p3-u09-npm-publish.AC2.1, p3-u09-npm-publish.AC2.2, p3-u09-npm-publish.AC2.3

**Files:** None (verification only)

**Verification:**

Run: `pnpm build`
Expected: Build succeeds without errors

Run: `head -1 dist/index.js`
Expected: `#!/usr/bin/env node` (AC2.1)

Run: `ls dist/index.d.ts`
Expected: File exists (AC2.2)

Run: `TARBALL=$(pnpm pack --pack-destination /tmp 2>&1 | tail -1) && tar tzf "$TARBALL" | sort`
Expected: Tarball contains ONLY files under `package/dist/`, `package/README.md`, and `package/LICENSE` — no `src/`, no test files, no config files (AC2.3)

Clean up: `rm "$TARBALL"`

<!-- END_TASK_6 -->

<!-- START_TASK_7 -->

### Task 7: Verify CI compatibility

**Verifies:** p3-u09-npm-publish.AC4b.1, p3-u09-npm-publish.AC4b.2

**Files:** None (verification only)

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm test`
Expected: All existing tests pass

Run: `pnpm format:check`
Expected: All files formatted correctly

These verify that the package.json rename, tsconfig declaration change, and shebang addition don't break existing CI checks.

**Commit:** (no commit — verification only, but commit all Phase 1 changes if not already committed in prior tasks)

<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->
