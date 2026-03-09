# Project Scaffold Implementation Plan — Phase 2

**Goal:** Create the `src/` directory skeleton that downstream units populate.

**Architecture:** 7 subdirectories under `src/`, each with a `.gitkeep` placeholder file. These directories establish the module boundaries for the project. Downstream units create real files and remove the `.gitkeep`.

**Tech Stack:** git (directory tracking via `.gitkeep` convention)

**Scope:** 2 phases from original design (phases 1-2). This is Phase 2.

**Codebase verified:** 2026-03-02

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### project-scaffold.AC5: Directory skeleton is complete

- **project-scaffold.AC5.1 Success:** All 7 directories exist under `src/`: `paprika/`, `cache/`, `utils/`, `tools/`, `types/`, `features/`, `resources/`
- **project-scaffold.AC5.2 Success:** Each directory contains a `.gitkeep` file
- **project-scaffold.AC5.3 Success:** `src/index.ts` exists (empty file)

---

<!-- START_TASK_1 -->

### Task 1: Create 7 subdirectories with .gitkeep files

**Files:**

- Create: `src/paprika/.gitkeep`
- Create: `src/cache/.gitkeep`
- Create: `src/utils/.gitkeep`
- Create: `src/tools/.gitkeep`
- Create: `src/types/.gitkeep`
- Create: `src/features/.gitkeep`
- Create: `src/resources/.gitkeep`

**Step 1: Create all directories and .gitkeep files**

```bash
mkdir -p src/paprika src/cache src/utils src/tools src/types src/features src/resources
touch src/paprika/.gitkeep src/cache/.gitkeep src/utils/.gitkeep src/tools/.gitkeep src/types/.gitkeep src/features/.gitkeep src/resources/.gitkeep
```

Each `.gitkeep` is an empty file. Git does not track empty directories, so `.gitkeep` forces git to preserve the directory structure. Downstream units replace `.gitkeep` with real source files.

The 7 directories serve these purposes:

- `paprika/` — API client + types (P1-U05, P1-U06, P1-U07)
- `cache/` — Disk cache + recipe store (P1-U08, P1-U10)
- `utils/` — XDG paths, config loader, duration helper (P1-U03, P1-U04, P1-U09)
- `tools/` — MCP tool handlers (Phase 2)
- `types/` — ServerContext + shared server types (Phase 2)
- `features/` — Photography, embeddings, vector store (Phase 3)
- `resources/` — MCP resource handlers (Phase 2)

**Step 2: Verify all directories and .gitkeep files exist**

Run:

```bash
find src -name ".gitkeep" | sort
```

Expected output (7 files):

```
src/cache/.gitkeep
src/features/.gitkeep
src/paprika/.gitkeep
src/resources/.gitkeep
src/tools/.gitkeep
src/types/.gitkeep
src/utils/.gitkeep
```

**Step 3: Verify `src/index.ts` still exists**

Run:

```bash
test -f src/index.ts && echo "src/index.ts exists"
```

Expected: Prints `src/index.ts exists`. This file was created in Phase 1 and must not have been removed.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Verify build and commit

**Step 1: Verify project still builds**

Run:

```bash
pnpm build
```

Expected: `tsc` exits with code 0. The `.gitkeep` files are not `.ts` files, so they do not affect compilation. `dist/index.js` is still produced from `src/index.ts`.

**Step 2: Stage and commit**

```bash
git add src/paprika/.gitkeep src/cache/.gitkeep src/utils/.gitkeep src/tools/.gitkeep src/types/.gitkeep src/features/.gitkeep src/resources/.gitkeep
git commit -m "build(scaffold): add src directory skeleton

Create 7 subdirectories under src/ with .gitkeep placeholders:
paprika/, cache/, utils/, tools/, types/, features/, resources/.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

**Step 3: Verify clean state**

Run:

```bash
git status
```

Expected: Working tree is clean (only untracked `.claude/` and `.ed3d/` directories remain, which are not part of this scaffold unit).

<!-- END_TASK_2 -->
