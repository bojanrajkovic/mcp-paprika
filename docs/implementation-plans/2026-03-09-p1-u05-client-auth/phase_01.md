# PaprikaClient Auth & Request Helper — Phase 1: Dependencies & Scaffolding

**Goal:** Add cockatiel (runtime) and msw (dev) dependencies, create empty PaprikaClient class that compiles

**Architecture:** Infrastructure-only phase. Adds two new packages and scaffolds the client file with constructor, no methods. Build and typecheck must pass.

**Tech Stack:** cockatiel (resilience), msw (HTTP mocking for tests), TypeScript 5.9, pnpm

**Scope:** 4 phases from original design (phase 1 of 4)

**Codebase verified:** 2026-03-09

---

## Acceptance Criteria Coverage

**Verifies: None** — this is an infrastructure phase. Operational verification only (install, typecheck, build).

---

<!-- START_TASK_1 -->

### Task 1: Add cockatiel and msw dependencies

**Files:**

- Modify: `package.json:18-43`

**Step 1: Install cockatiel as runtime dependency**

```bash
pnpm add cockatiel
```

This adds `cockatiel` to the `dependencies` section of `package.json`. Cockatiel is a zero-transitive-dependency TypeScript resilience library used for retry + circuit breaker policies.

**Step 2: Install msw as dev dependency**

```bash
pnpm add -D msw
```

This adds `msw` to the `devDependencies` section. MSW (Mock Service Worker) intercepts HTTP requests at the network level in tests without patching `fetch`.

**Step 3: Verify installation**

```bash
pnpm install
```

Expected: Installs without errors. Lock file updated.

**Step 4: Verify packages resolve**

```bash
node -e "import('cockatiel').then(() => console.log('cockatiel OK'))"
node -e "import('msw').then(() => console.log('msw OK'))"
```

Expected: Both print OK without errors.

**Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(paprika): add cockatiel and msw dependencies"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create empty PaprikaClient class

**Files:**

- Create: `src/paprika/client.ts`

**Step 1: Create the client file**

Create `src/paprika/client.ts` with the following content:

```typescript
/**
 * Typed HTTP client for the Paprika Cloud Sync API.
 *
 * Encapsulates authentication against the v1 login endpoint
 * and resilient request execution against the v2 data endpoint.
 *
 * No recipe or category read/write methods — those are deferred
 * to P1-U06 and P1-U07.
 */
export class PaprikaClient {
  private token: string | null = null;

  constructor(
    private readonly email: string,
    private readonly password: string,
  ) {}
}
```

Key points for the implementor:

- `email` and `password` are `private readonly` — stored at construction, never modified
- `token` is `private`, initially `null`, will be set by `authenticate()` in Phase 2
- The class is exported as a named export (no default exports per project convention)
- No methods yet — `authenticate()` comes in Phase 2, `request<T>()` in Phase 3

**Step 2: Verify typecheck passes**

```bash
pnpm typecheck
```

Expected: Exits with code 0, no errors.

**Step 3: Verify build succeeds**

```bash
pnpm build
```

Expected: Exits with code 0. `dist/paprika/client.js` and `dist/paprika/client.d.ts` are generated.

**Step 4: Verify lint passes**

```bash
pnpm lint
```

Expected: No warnings or errors.

**Step 5: Commit**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): scaffold empty PaprikaClient class"
```

<!-- END_TASK_2 -->
