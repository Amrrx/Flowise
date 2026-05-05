# Chatflow References & Active Toggle — Design

**Date:** 2026-05-05
**Status:** Draft — pending user review
**Branch:** `feature/chatflow-references-and-active-toggle`

---

## 1. Problem

Operating Flowise in production today has three friction points:

1. **Chatflow IDs are opaque UUIDs.** Daily callers (other services, scripts, integrations) reference chatflows by `/api/v1/prediction/<uuid>`. UUIDs are unmemorable, leak nothing about intent, and make multi-environment routing painful.
2. **No way to pin traffic to a specific version.** Flowise already snapshots history (`FlowHistory`) and supports tagging snapshots (`FlowVersionTag`), but these tags are not honored at request time. Only `chatflow.publishedVersion` (an integer) is consulted by the request resolver. Operators cannot say "send traffic to `Avl_Agent` version `v2.2.1`."
3. **No runtime kill-switch.** A `deployed: boolean` column has existed on `ChatFlow` since 2023 but is never read in business logic. There is no way to deactivate a chatflow without deleting it.

## 2. Goals

-   Allow callers to reference a chatflow by `name` instead of UUID.
-   Allow callers to pin a request to a specific tagged version using the syntax `name@tag` (e.g. `Avl_Agent@v2.2.1`, `Avl_Agent@production`).
-   Allow operators to mark a single tag per chatflow as `production` — calls to `name@production` resolve to whatever snapshot currently holds that tag.
-   Allow operators to deactivate a chatflow at the chatflow level. A deactivated chatflow rejects all incoming prediction requests regardless of which tag was targeted.
-   Preserve full backward compatibility: existing `/prediction/<uuid>` URLs keep working.

## 3. Non-goals

-   Per-tag activation/deactivation (e.g. disabling `canary` while leaving `production` enabled). The toggle is per-chatflow only. If per-tag granularity is ever needed, it can be added later as a separate column on `FlowVersionTag` without breaking the per-chatflow toggle.
-   Workspace-wide uniqueness of the `production` tag. Each chatflow has its own `production` independently.
-   A new "deployment" abstraction or pipeline. The active/inactive toggle is a runtime accept/reject switch, not a CI/CD concept.
-   Renaming the existing `deployed` column. The DB column stays as-is; the UI label is "Active/Inactive."
-   Inlining the full flow definition in the request body (this was option B for Feature 1; rejected — would abandon stored-flow benefits like history, analytics, chat associations).

## 4. Architecture overview

The change converges on **one resolver function** at the prediction controller. All three features share this resolver:

```
                    /prediction/<reference>
                              │
                              ▼
                ┌─────────────────────────┐
                │ resolveChatflowReference │
                └─────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
        UUID match       Name match        name@tag match
       (legacy path)    (Feature 1A)        (Feature 2)
            │                 │                 │
            └─────────────────┴─────────────────┘
                              │
                              ▼
                  { chatflow, effectiveFlowData }
                              │
                              ▼
                   if !chatflow.deployed → 403
                              │
                              ▼
                       execute prediction
```

The resolver returns:

-   `chatflow` — the live `ChatFlow` row (used for permissions, config, deployed flag, chatbotConfig, etc.)
-   `effectiveFlowData` — the JSON definition to execute. Comes from a tagged snapshot if `name@tag` was supplied, otherwise from `resolveEffectiveFlowData()` as today (which already honors `publishedVersion`).

## 5. Reference syntax

| Form                | Resolves to                                                               | Example                |
| ------------------- | ------------------------------------------------------------------------- | ---------------------- |
| `<uuid>`            | ChatFlow by primary key (today's behavior)                                | `3f8a-b21c-...`        |
| `<name>`            | ChatFlow by `name` column, scoped to caller's workspace                   | `Avl_Agent`            |
| `<name>@<tag>`      | ChatFlow by name + load `flowData` from `FlowVersionTag.tagName` snapshot | `Avl_Agent@v2.2.1`     |
| `<name>@production` | Same — `production` is just a tag name with extra invariant               | `Avl_Agent@production` |

**Discrimination rule:** the resolver tries UUID first (cheap regex test on shape). If not a UUID, it checks for an `@` separator. The part before `@` is the name; the part after is the tag.

**URL encoding:** `@` is a reserved-ish character in URLs but does not require percent-encoding in the path component per RFC 3986. Existing path syntax `/prediction/foo@bar` is valid as-is.

## 6. Component changes

### 6.1 Database

**One new index required** — uniqueness on chatflow name within a workspace, since name-based resolution would otherwise be ambiguous:

```sql
CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, workspaceId);
```

This requires:

-   A new migration file under `packages/server/src/database/migrations/<engine>/` for each supported engine (sqlite, postgres, mysql, mariadb).
-   A pre-flight check before applying: if any duplicate `(name, workspaceId)` rows exist in production, the migration will fail. Mitigation: a one-time cleanup query that auto-suffixes duplicates (e.g. `name -> name (2)`) so the index can be created. Run the cleanup as part of the migration's `up()`.
-   The chatflow create/update endpoints already let users pick any name; we add a friendly 409 response when the name collides instead of leaking a DB error.

All other required columns exist:

-   `ChatFlow.deployed` — already a column (currently dead, will be repurposed).
-   `FlowVersionTag.tagName` — already free-text.
-   Unique index `(entityType, entityId, tagName)` on `FlowVersionTag` — already in place.

### 6.2 New utility: `resolveChatflowReference`

**Location:** `packages/server/src/utils/resolveChatflowReference.ts` (new file)

**Interface:**

```ts
type ChatflowReference = { kind: 'uuid'; id: string } | { kind: 'name'; name: string } | { kind: 'nameTag'; name: string; tag: string }

function parseChatflowReference(input: string): ChatflowReference

async function resolveChatflowReference(input: string, workspaceId: string): Promise<{ chatflow: ChatFlow; effectiveFlowData: string }>
```

**Resolution algorithm:**

1. Parse `input` into a `ChatflowReference`.
2. Look up the `ChatFlow` row:
    - `uuid` → `findOneBy({ id })`
    - `name` / `nameTag` → `findOneBy({ name, workspaceId })`
3. If `nameTag`:
   a. Look up `FlowVersionTag.findOneBy({ entityType: 'CHATFLOW', entityId: chatflow.id, tagName: tag, workspaceId })` and load the linked `FlowHistory` snapshot.
   b. Use `snapshotData.flowData` as `effectiveFlowData`.
   c. **Clear `chatflow.publishedVersion = null`** on the in-memory object so the downstream `resolveEffectiveFlowData()` call in `buildChatflow`/`buildAgentflow` does not override our tag choice. This is purely an in-memory mutation; the DB row is untouched.
4. Otherwise, call existing `resolveEffectiveFlowData('CHATFLOW', chatflow)` to honor `publishedVersion`.
5. Set `chatflow.flowData = effectiveFlowData` so all downstream code reads the correct definition.
6. If anything is not found, throw `InternalFlowiseError(404, ...)` with a precise message indicating which step failed (chatflow not found vs tag not found).

### 6.3 Prediction controller — `predictions/index.ts:30`

Replace:

```ts
const chatflow = await chatflowsService.getChatflowById(req.params.id, workspaceId)
if (!chatflow) throw new InternalFlowiseError(404, ...)
```

With:

```ts
const { chatflow, effectiveFlowData } = await resolveChatflowReference(req.params.id, workspaceId)
if (!chatflow.deployed) {
    throw new InternalFlowiseError(StatusCodes.FORBIDDEN, `Chatflow is deactivated`)
}
```

Then thread `effectiveFlowData` through to `buildChatflow` so it does not re-resolve. The simplest path: set `chatflow.flowData = effectiveFlowData` before calling downstream — same pattern `buildChatflow.ts:1008-1009` already uses today.

### 6.4 `buildChatflow.ts` and `buildAgentflow.ts`

These currently call `resolveEffectiveFlowData('CHATFLOW', chatflow)` themselves (`buildChatflow.ts:1007`, `buildAgentflow.ts:1582`). With the new flow, the controller has already resolved the right snapshot. The downstream call must not override that choice.

**Behavior by reference type:**

-   `uuid` / `name` (no tag): `publishedVersion` remains intact. The downstream `resolveEffectiveFlowData()` call resolves the same snapshot the controller already resolved — it returns the same `flowData` we already set. Idempotent.
-   `name@tag`: the resolver clears `chatflow.publishedVersion` in memory (see 6.2 step 3c). The downstream `resolveEffectiveFlowData()` then returns `entity.flowData` unchanged because there is no `publishedVersion` to look up. The tag-resolved snapshot is preserved.

No structural change needed to these files. The contract that downstream code must respect: **whatever `chatflow.flowData` holds when handed off is the definition to execute** — and clearing `publishedVersion` is how we signal "do not re-resolve."

### 6.5 `services/flow-tags/index.ts` — `production` uniqueness

When `createTag` is called with `tagName === 'production'`, before insert:

```ts
if (tagName === 'production') {
    await tagRepo.delete({
        entityType: snapshot.entityType,
        entityId: snapshot.entityId,
        tagName: 'production',
        workspaceId
    })
}
```

This implements "promote to production" semantics: tagging a new version as `production` automatically untagged the previous one. The unique index `(entityType, entityId, tagName)` would otherwise reject the insert; this delete-before-insert turns rejection into promotion.

The string `'production'` is a constant — extract to `PRODUCTION_TAG_NAME` in the same file.

### 6.6 Active/Inactive UI

**Canvas header (`packages/ui/src/views/canvas/CanvasHeader.jsx`):**

-   Add an MUI `Switch` labelled "Active" placed left of the existing Publish controls.
-   When toggled, call a new endpoint `PUT /api/v1/chatflows/:id` (already exists — chatflow update) with `{ deployed: true|false }`.
-   Tooltip on the switch: "When inactive, this chatflow rejects incoming API requests with 403."
-   When `deployed === false`, render a warning banner across the top of the canvas: "⏸ This chatflow is deactivated. It will not respond to API requests."

**Chatflow list card (`packages/ui/src/ui-component/cards/ItemCard.jsx`):**

-   Add a small status dot on each card: green dot + "Active" if `deployed`, grey dot + "Inactive" otherwise.
-   The card itself is read-only for this state (no toggle on the card to prevent accidental clicks). Toggling happens in the canvas.

**Tag management UI:**

-   Out of scope for this design — the existing tag controllers/services handle CRUD. The `production` uniqueness logic in 6.5 means the UI does not need a special "promote" button; tagging anything as `production` automatically promotes.

### 6.7 Backward compatibility

-   All existing `/prediction/<uuid>` calls work unchanged because the resolver tries UUID first.
-   All existing chatflows with `deployed = null` or `deployed = false` (the default for new flows in the UI today) would suddenly start rejecting traffic if we shipped the active-gate as-is. **Mitigation:** during the migration step, set `deployed = true` for every existing row that is currently being served (i.e. all rows). New chatflows default to `deployed = true` going forward (change the UI default in `views/canvas/index.jsx:233` and `views/agentflowsv2/Canvas.jsx:228` from `false` to `true`).
-   Existing `FlowVersionTag` rows with `tagName = 'production'` are already constrained by the unique index, so the new uniqueness rule is consistent with existing data.

## 7. Error handling

| Condition                                            | Status | Body                                                         |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Reference is malformed (e.g. `name@`, `@tag`, empty) | 400    | `Invalid chatflow reference`                                 |
| Chatflow name not found                              | 404    | `Chatflow '<name>' not found`                                |
| UUID not found                                       | 404    | `Chatflow <uuid> not found` (today's behavior)               |
| Tag not found on chatflow                            | 404    | `Tag '<tag>' not found on chatflow '<name>'`                 |
| Tag exists but linked snapshot is missing            | 500    | `Tag '<tag>' references a missing snapshot` (data integrity) |
| Chatflow is deactivated                              | 403    | `Chatflow is deactivated`                                    |

Errors are thrown as `InternalFlowiseError` to match existing pattern.

## 8. Testing strategy

Following project rules (`packages/server/src` already has `*.test.ts` co-located):

**Unit tests (new):**

-   `resolveChatflowReference.test.ts` — covers all three reference forms, malformed input, not-found cases.
-   Extension to `services/flow-tags/index.test.ts` — covers `production` promotion: creating second `production` deletes first; non-`production` tags still rejected by unique index when duplicated.

**Integration touchpoints (manual smoke tests during review):**

-   `POST /prediction/<uuid>` — unchanged behavior.
-   `POST /prediction/<name>` — resolves and serves.
-   `POST /prediction/<name>@<existingTag>` — serves the tagged snapshot.
-   `POST /prediction/<name>@production` after promoting v1, then promoting v2 — second call serves v2.
-   Toggle off via UI → `POST` returns 403.

No changes to existing tests are anticipated; the prediction controller's external contract widens, not changes.

## 9. Risks and trade-offs

-   **Naming mismatch (DB `deployed` vs UI "Active").** Future maintainers may rename the column and break the UI. Mitigation: a single-line comment on the `ChatFlow.deployed` field explaining the runtime accept/reject semantic.
-   **Workspace scoping for name lookup.** If two workspaces have a chatflow named `Avl_Agent`, the resolver picks the one matching the caller's `activeWorkspaceId`. Cross-workspace API keys (if they exist) need scrutiny — the chatflow service already filters by workspace, so this should be consistent.
-   **Tag content trust.** The `tagName` is free text. Allowing arbitrary characters via URL means we should validate tag names on creation (alphanumeric + `.` + `-` + `_` + `:` is a safe set). The existing tag service does not currently validate; we add a regex check at create time.
-   **Per-chatflow `production` is a delete-then-insert.** It is not transactional in the strict sense — a crash between delete and insert leaves the chatflow with no `production` tag. Acceptable: operators retry. A transaction wrapping both is trivial to add if the framework permits.

## 10. Out-of-scope follow-ups

-   Per-tag activation/deactivation.
-   Workspace-wide single `production`.
-   Tag aliases or "latest" semantics.
-   API endpoint for toggling active state programmatically (today the chatflow update endpoint suffices; a dedicated `PUT /chatflows/:id/deployed` endpoint is unnecessary unless an external pipeline needs it).
-   Migration to rename `deployed` → `isActive`. Cosmetic; can be done in a separate housekeeping branch.

## 11. Implementation surface summary

| File                                                                                                | Change                                                                                         |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/server/src/utils/resolveChatflowReference.ts`                                             | **NEW** — parser + resolver                                                                    |
| `packages/server/src/utils/resolveChatflowReference.test.ts`                                        | **NEW** — unit tests                                                                           |
| `packages/server/src/controllers/predictions/index.ts`                                              | Swap `getChatflowById` for `resolveChatflowReference`; add `deployed` guard                    |
| `packages/server/src/services/flow-tags/index.ts`                                                   | `production` promotion logic; tag-name validation                                              |
| `packages/server/src/services/flow-tags/index.test.ts`                                              | Add promotion test                                                                             |
| `packages/server/src/database/entities/ChatFlow.ts`                                                 | Add explanatory comment on `deployed`; add `@Index(['name', 'workspaceId'], { unique: true })` |
| `packages/server/src/database/migrations/<engine>/<timestamp>-AddUniqueChatFlowNamePerWorkspace.ts` | **NEW** (×4 engines) — duplicate cleanup + unique index creation                               |
| `packages/server/src/services/chatflows/index.ts`                                                   | Translate name-collision DB error into 409 response                                            |
| `packages/ui/src/views/canvas/CanvasHeader.jsx`                                                     | Add Active switch + warning banner                                                             |
| `packages/ui/src/views/canvas/index.jsx`                                                            | Default `deployed: true` on creation                                                           |
| `packages/ui/src/views/agentflowsv2/Canvas.jsx`                                                     | Default `deployed: true` on creation                                                           |
| `packages/ui/src/ui-component/cards/ItemCard.jsx`                                                   | Active/Inactive status dot                                                                     |

One-time data migration (manual or migration file): `UPDATE chat_flow SET deployed = true WHERE deployed IS NULL OR deployed = false` — run before deploying to production so existing flows do not start rejecting traffic.

## 12. Approval checklist

-   [ ] Reference syntax (`uuid` / `name` / `name@tag`) confirmed
-   [ ] Per-chatflow `production` uniqueness via delete-then-insert confirmed
-   [ ] Reuse of `deployed` column with UI label "Active" confirmed
-   [ ] Default `deployed = true` for new chatflows confirmed
-   [ ] One-time backfill of existing rows confirmed
-   [ ] Backward compatibility (UUID URLs keep working) confirmed
-   [ ] **New:** unique-name-per-workspace constraint + duplicate-cleanup migration confirmed
-   [ ] No commits until reviewer (you) approves this spec
