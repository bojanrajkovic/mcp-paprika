# PaprikaClient Auth & Request Helper — Phase 4: Documentation & Cleanup

**Goal:** Update module CLAUDE.md with client.ts contract, verify all checks pass

**Architecture:** Documentation-only phase. Adds the `client.ts` entry to the module's CLAUDE.md with exports, dependencies, and consumer notes for downstream units P1-U06/U07.

**Tech Stack:** Markdown

**Scope:** 4 phases from original design (phase 4 of 4)

**Codebase verified:** 2026-03-09

---

## Acceptance Criteria Coverage

This phase implements:

### p1-u05-client-auth.AC5: Construction and module structure

- **p1-u05-client-auth.AC5.3 Success:** Module CLAUDE.md documents client.ts contract

---

<!-- START_TASK_1 -->

### Task 1: Update src/paprika/CLAUDE.md with client.ts contract

**Verifies:** p1-u05-client-auth.AC5.3

**Files:**

- Modify: `src/paprika/CLAUDE.md`

**Implementation:**

The current `src/paprika/CLAUDE.md` documents `types.ts` and `errors.ts`. Add `client.ts` to the file listing and add a new contract section.

After the existing "Files" section (line 8), add `client.ts`:

```markdown
- `client.ts` — Typed HTTP client for Paprika Cloud Sync API (auth + resilient requests)
```

After the existing "Error Hierarchy" section (around line 57), add a new section:

```markdown
### PaprikaClient (client.ts)

Typed HTTP client wrapping the Paprika Cloud Sync API.

**Exports:**

- `PaprikaClient` — class with `authenticate()` and private `request<T>()`

**Construction:**

- `new PaprikaClient(email: string, password: string)` — stores credentials, no I/O

**Public API:**

- `authenticate(): Promise<void>` — POSTs form-encoded credentials to v1 login endpoint, stores JWT token
- No recipe/category read/write methods — deferred to P1-U06/P1-U07

**Private API (P1-U06/U07 will add public methods to this class that call request):**

- `request<T>(method, url, schema, body?): Promise<T>` — authenticated v2 API calls with:
  - Bearer token header (when token exists)
  - Cockatiel retry (429, 500, 502, 503) + circuit breaker (5 consecutive failures)
  - 401 re-auth retry (single attempt)
  - Response envelope unwrapping (`{ result: T }` → `T`)
  - Zod schema validation of inner value

**Dependencies:**

- **Uses:** `zod` (response validation), `cockatiel` (retry + circuit breaker), `./types.js` (AuthResponseSchema), `./errors.js` (PaprikaAuthError, PaprikaAPIError)
- **Used by:** P1-U06 (recipe methods), P1-U07 (category methods) — will add public methods that call `request<T>()`
```

Update the "Dependencies" section at the bottom of the file to include cockatiel:

```markdown
- **Uses:** `zod` (validation), `cockatiel` (resilience), `type-fest` (type utilities)
```

Also update the "Last verified" date at the top of the file to `2026-03-09`.

**Verification:**

```bash
pnpm format:check
```

Expected: Exits with code 0. If formatting fails, run `pnpm format` to fix.

**Commit:**

```bash
git add src/paprika/CLAUDE.md
git commit -m "docs(paprika): add client.ts contract to module CLAUDE.md"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Final verification — all checks pass

**Files:** None (verification only)

**Step 1: Run full verification suite**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check && pnpm build
```

Expected: All five commands exit with code 0.

**Step 2: If any check fails, fix and commit**

Fix the issue, then:

```bash
git add -u
git commit -m "fix(paprika): address final verification issues"
```

**Step 3: Verify git status is clean**

```bash
git status
```

Expected: Working tree clean, all changes committed.

<!-- END_TASK_2 -->
