# Human Test Plan: MCP Resource Registration (p2-u10-resource-reg)

Generated: 2026-03-17

All 10 acceptance criteria are covered by automated unit tests. The manual steps below validate end-to-end behavior in a live environment, focusing on areas that unit tests (with stub servers and managed stores) cannot fully exercise.

## Prerequisites

- Node.js 24 running (via mise)
- Dependencies installed: `pnpm install`
- All unit tests passing: `pnpm test` (358 tests, 0 failures)
- Environment variables configured in `.env` (valid Paprika API credentials)

---

## Phase 1: Resource Registration Wiring

| Step | Action                                                                                                      | Expected                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Run `pnpm build`                                                                                            | No TypeScript errors. `dist/` contains `resources/recipes.js`.                                                                                                                        |
| 2    | Start the MCP server via `pnpm dev`                                                                         | Server starts without errors on stdio transport. No stray console output.                                                                                                             |
| 3    | Using an MCP client (e.g., Claude Desktop or MCP Inspector), send a `resources/list` request                | Response includes entries with `uri: "paprika://recipe/{uid}"` for each non-trashed recipe. Each entry has `name` and `mimeType: "text/markdown"`.                                    |
| 4    | Pick any recipe UID from the list response and send a `resources/read` request for `paprika://recipe/{uid}` | Response contains `contents[0]` with `mimeType: "text/markdown"`, `uri` matching the request URI, and `text` starting with `**UID:** \`{uid}\`` followed by the full recipe markdown. |
| 5    | Verify the markdown body contains resolved category names for a recipe with categories assigned             | The `**Categories:**` line shows human-readable names (e.g., "Desserts, Breakfast"), not UUID strings.                                                                                |
| 6    | Send a `resources/read` request for a nonexistent UID (e.g., `paprika://recipe/does-not-exist`)             | The server returns a protocol error. No crash or unhandled exception.                                                                                                                 |

---

## Phase 2: CRUD Mutation Triggers Resource List Changed Notification

| Step | Action                                                                                                                   | Expected                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1    | Connect an MCP client that subscribes to resource list change notifications                                              | Client is connected and listening for `notifications/resources/list_changed`.          |
| 2    | Use the `create_recipe` tool to create a new recipe (e.g., name: "Test Recipe", ingredients: "flour", directions: "mix") | Tool returns success. The MCP client receives a `resources/list_changed` notification. |
| 3    | After the notification, send a `resources/list` request                                                                  | The newly created recipe appears in the list with the correct URI, name, and mimeType. |
| 4    | Use the `update_recipe` tool to update the recipe name                                                                   | Tool returns success. A `resources/list_changed` notification is received.             |
| 5    | Use the `delete_recipe` tool to soft-delete the recipe                                                                   | Tool returns success. A `resources/list_changed` notification is received.             |
| 6    | After the delete notification, send a `resources/list` request                                                           | The deleted recipe no longer appears in the list (trashed recipes are excluded).       |

---

## End-to-End: Full Resource Lifecycle

**Purpose:** Validates that resource registration, listing, reading, and change notification work together across a complete create-read-update-delete cycle with a live Paprika account.

1. Start the MCP server with valid credentials.
2. List resources — note the count of recipes returned.
3. Create a recipe via `create_recipe` tool. Confirm a `resources/list_changed` notification fires.
4. Re-list resources. Confirm the count increased by 1 and the new recipe appears.
5. Read the new recipe via `resources/read` with its UID. Confirm the UID header, markdown body, and mimeType are correct.
6. Update the recipe's name via `update_recipe`. Confirm a `resources/list_changed` notification fires.
7. Re-list resources. Confirm the recipe's `name` field reflects the update.
8. Read the recipe again. Confirm the markdown title (`# {name}`) reflects the updated name.
9. Delete the recipe via `delete_recipe`. Confirm a `resources/list_changed` notification fires.
10. Re-list resources. Confirm the recipe is no longer in the list.
11. Attempt to read the deleted recipe by UID. Confirm an error is returned.

---

## Human Verification Required

| Criterion                                  | Why Manual                                                                                 | Steps                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource URI format visible to MCP clients | Unit tests use a stub server; only a real MCP client confirms the URI is routable          | Connect MCP Inspector, list resources, verify each `uri` is resolvable as `paprika://recipe/{uid}`                                                      |
| Markdown rendering quality                 | Automated tests check structure but not human readability                                  | Read a complex recipe (with categories, notes, nutritional info, source URL) and verify the markdown renders well                                       |
| Notification timing under real I/O         | Unit tests use sync mocks; real `flush()` and `notifySync()` involve disk and network I/O  | Create a recipe while watching the MCP client notification stream; verify the notification arrives promptly and the subsequent list reflects the change |
| Entry-point wiring                         | `registerRecipeResources()` being called from `src/index.ts` is out of scope for this unit | Start the server and confirm `resources/list` works — this proves the entry point wires it correctly                                                    |

---

## Traceability

| Acceptance Criterion                                              | Automated Test                 | Manual Step                |
| ----------------------------------------------------------------- | ------------------------------ | -------------------------- |
| AC1.1 — List returns non-trashed recipes with uri, name, mimeType | `recipes.test.ts` AC1.1        | Phase 1, Step 3            |
| AC1.2 — Empty store returns empty array                           | `recipes.test.ts` AC1.2        | N/A (covered by unit test) |
| AC1.3 — Trashed recipes excluded                                  | `recipes.test.ts` AC1.3        | Phase 2, Step 6            |
| AC2.1 — Read returns UID header + markdown                        | `recipes.test.ts` AC2.1        | Phase 1, Step 4            |
| AC2.2 — Categories resolved to names                              | `recipes.test.ts` AC2.2        | Phase 1, Step 5            |
| AC2.3 — Response has correct mimeType and uri                     | `recipes.test.ts` AC2.3        | Phase 1, Step 4            |
| AC2.4 — Missing UID throws error                                  | `recipes.test.ts` AC2.4        | Phase 1, Step 6            |
| AC3.1 — sendResourceListChanged called once                       | `helpers.test.ts` AC-helpers.7 | Phase 2, Steps 2/4/5       |
| AC3.2 — sendResourceListChanged after storeSet                    | `helpers.test.ts` AC-helpers.8 | Phase 2, Step 3            |
| AC3.3 — sendResourceListChanged before notifySync                 | `helpers.test.ts` AC-helpers.8 | Phase 2, Steps 2/4/5       |
| Entry-point wiring (out of unit scope)                            | None                           | Human Verification, row 4  |
