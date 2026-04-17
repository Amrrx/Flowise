# Flow Version Control — Design Spec

**Date:** 2026-04-17
**Scope:** A+B+C — Authorship + Named Tags + Publish Pointer (no drafts)
**Target:** ChatFlow and Assistant entities (existing `EntityType = 'CHATFLOW' | 'ASSISTANT'`)
**Branch:** new branch cut from `main` (post upstream-merge), commit `f5fc6c17`

---

## Goal

Enhance the existing FlowHistory system so editors can:

1. See **who** made each change and **why** (authorship + commit message)
2. **Tag** specific history rows with meaningful names (`release-2026-04`, `demo-v1`)
3. **Publish** a specific version to end users, decoupling editing from serving

Explicit non-goals:

-   Per-user drafts (`FlowDraft`, `ChatFlow.draftData`) — deferred
-   Diff viewer between versions — deferred
-   Branching / merging — out of scope forever

---

## User Workflow

```
1. Editor opens flow in canvas → LIVE flowData loads (always latest)
2. Editor edits and saves with a message "fixed greeting prompt"
   → FlowHistory row stamped with authorId + authorName + commitMessage
3. Editor opens history panel → sees who/when/why for every change
4. Editor clicks "Tag this" on v7 → FlowVersionTag{tagName:"release-2026-04"}
5. Editor clicks "Publish" (or "Publish v7")
   → ChatFlow.publishedVersion = 7
6. End users calling the prediction API now get the v7 snapshot
7. Rollback: "Publish v3" from history row → instant revert for end users
```

Canvas and test-chat always load `chatflow.flowData` directly — editing is never blocked by publish state.

---

## Data Model

### New entity: `FlowVersionTag`

Already designed in paused WIP (commit `b0b06748`). Cherry-picked as-is.

```
id              uuid (pk)
entityType      'CHATFLOW' | 'ASSISTANT'
entityId        uuid
historyId       uuid → FlowHistory.id
tagName         varchar(100)
description     text?
createdById     text
createdByName   text
createdDate     timestamp
workspaceId     text

UNIQUE  (entityType, entityId, tagName)
INDEX   (historyId)
```

### Extended entity: `FlowHistory`

Adds three columns for authorship. Cherry-picked from WIP.

```
+ commitMessage   text?
+ authorId        text?
+ authorName      text?
```

Historical rows (pre-migration) have NULL values → UI displays "—".

### Extended entities: `ChatFlow` and `Assistant`

Both get the publish pointer.

```
+ publishedVersion   int?   // refers to FlowHistory.version for this entity
```

The paused WIP only extended `ChatFlow`. `Assistant` extension is new work on top of the cherry-pick.

### Dropped from WIP (scope cut)

-   `FlowDraft` entity — delete file and interface after cherry-pick
-   `ChatFlow.draftData` column — remove before migration is written
-   `IDiffResult` interface — delete after cherry-pick (tied to drafts)

---

## Runtime Change

Single choke-point: the flowData resolver used by every prediction path.

```ts
// new helper in packages/server/src/utils/resolveEffectiveFlowData.ts
export async function resolveEffectiveFlowData(entityType: EntityType, entity: ChatFlow | Assistant): Promise<string> {
    if (!entity.publishedVersion) return entity.flowData
    const snapshot = await historyRepository.findOne({
        where: { entityType, entityId: entity.id, version: entity.publishedVersion }
    })
    return snapshot?.snapshotData ?? entity.flowData
}
```

Call sites updated:

-   `packages/server/src/utils/buildChatflow.ts` — prediction entry
-   `packages/server/src/utils/buildAgentflow.ts` — agentflow v2 entry

Canvas / editor UI code never calls this helper; it continues to receive `chatflow.flowData` verbatim.

---

## API Surface

All routes are workspace-scoped and require the same auth as existing chatflow edit APIs.

| Method   | Path                              | Purpose                                                                                   |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/chatflows/:id/publish`   | Body `{ version?: number }` — publish given version (defaults to `currentHistoryVersion`) |
| `DELETE` | `/api/v1/chatflows/:id/publish`   | Clear `publishedVersion`, back to always-live                                             |
| `POST`   | `/api/v1/assistants/:id/publish`  | Same as above for Assistant                                                               |
| `DELETE` | `/api/v1/assistants/:id/publish`  | Same as above for Assistant                                                               |
| `POST`   | `/api/v1/history/:historyId/tags` | Body `{ tagName, description? }` → creates FlowVersionTag                                 |
| `DELETE` | `/api/v1/history-tags/:tagId`     | Remove a tag                                                                              |
| `GET`    | `/api/v1/chatflows/:id/tags`      | List tags for an entity                                                                   |
| `GET`    | `/api/v1/assistants/:id/tags`     | Same for Assistant                                                                        |

Authorship has **no endpoints** — the snapshot creation path reads the authenticated user from the request and stamps the row.

---

## Service Changes

### `packages/server/src/services/history/index.ts`

-   `createSnapshot` extended: accepts `author: { id, name }` and `commitMessage` — writes to new columns.
-   Caller (chatflow save, assistant save) passes request user.

### New service: `packages/server/src/services/flow-tags/index.ts`

-   `createTag(historyId, tagName, description, user, workspaceId)`
-   `listTags(entityType, entityId, workspaceId)`
-   `deleteTag(tagId, workspaceId)`

### `packages/server/src/services/chatflows/index.ts` + `assistants/index.ts`

-   `publish(id, version?, workspaceId)` — validates version exists in history, updates pointer
-   `unpublish(id, workspaceId)` — clears pointer

---

## UI Surface

### Canvas toolbar (existing component: `Canvas/CanvasHeader.jsx`)

-   New **Publish** / **Unpublish** button
-   Status badge: `Published: v5 · Editing: v7 (2 unpublished)`
-   Button is disabled when `currentHistoryVersion === publishedVersion`

### History panel (existing component, location TBD in UI investigation step)

-   New columns: **Author**, **Message**
-   Row actions: **Tag**, **Publish this version**
-   Tag dialog: simple form — name + optional description

### Tags dialog

-   List with delete action
-   Accessed from canvas header (icon button) or history panel

---

## Migrations (4 DBs: sqlite, postgres, mariadb, mysql)

Three separate timestamped migrations for clarity (one per concern):

1. `AddAuthorFieldsToFlowHistory<ts>` — three nullable columns
2. `AddFlowVersionTagTable<ts>` — new table, indexes
3. `AddPublishedVersionToEntities<ts>` — nullable int on ChatFlow and Assistant

Each migration uses the **idempotency guard pattern** already established in the fork (commit `b5dcc7b7`). Each runs safely on an already-migrated DB.

Stashed migrations from `stash@{0}` are **not** reused — they bundle FlowDraft creation. Re-authoring is cleaner.

---

## Edge Cases (decided up-front)

| Concern                                                  | Decision                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Credential drift on publish (snapshot refs deleted cred) | Publish succeeds; runtime fails cleanly if cred missing. Matches git. |
| Canvas "Test Chat" while published version differs       | Uses editing `flowData`, not published snapshot.                      |
| Who can publish                                          | Any editor (same permission as save). Revisit if needed.              |
| Historical rows without author                           | NULL → UI renders "—". No backfill.                                   |
| Tag uniqueness scope                                     | Per `(entityType, entityId, tagName)` — already in entity design.     |
| Tag deletion when history row is deleted                 | ON DELETE CASCADE on FlowVersionTag.historyId → auto-cleanup.         |
| Publishing a version then deleting that history row      | Should not happen — history is append-only today. Keep it that way.   |
| Assistant vs ChatFlow symmetry                           | Both get `publishedVersion` + tag support. Same helper for both.      |

---

## Cherry-pick Plan

Current `feat/agentflow-version-control` has two clean commits:

-   `caec6b33` — interfaces
-   `b0b06748` — entities (FlowVersionTag + FlowDraft + modifications)

**Both merge-tree cleanly with current `main`** (verified).

Execution on new branch `feat/flow-version-control`:

1. Branch from `main` at `f5fc6c17`
2. `git cherry-pick caec6b33 b0b06748`
3. Cleanup commit: remove `FlowDraft.ts`, `IFlowDraft`, `IDiffResult`, `ChatFlow.draftData`, entities/index.ts registration of FlowDraft
4. Everything afterwards is new work (no reuse from stash)

The stashed migrations are **not** cherry-picked. They include FlowDraft. Re-authoring is cleaner than surgical edit.

---

## Delivery Plan (milestones, not commits)

1. **Branch + cherry-pick + cleanup** — entities and interfaces on new branch
2. **Migrations** — three migrations × four DB dialects, with idempotency guard
3. **Service layer** — extend history service, new flow-tags service, extend chatflow+assistant services
4. **Controller + routes** — 8 endpoints total
5. **Resolver integration** — new helper, two call-site changes in `buildChatflow.ts` and `buildAgentflow.ts`
6. **UI — canvas header** — publish button + status badge
7. **UI — history panel** — author/message columns + row actions
8. **UI — tags dialog** — list + delete
9. **Testing** — service-level unit tests, one e2e: publish v1 → save v2 → prediction still returns v1 output

---

## Risks

-   **`buildChatflow.ts` fork-specific logic** — this file survived the upstream merge with customizations. Resolver insertion is ~5 lines but must be tested against all prediction paths (streaming, non-streaming, MCP, embedded chat, public URL).
-   **Migrations on populated production DB** — your SQLite→Postgres migration (separate project, paused) needs to run on the post-migration schema. Confirm order of operations.
-   **UI canvas header is shared** between AgentFlow v1, AgentFlow v2, and Chatflow canvases — the publish button placement needs to render in all three.

---

## Success Criteria

-   Saving a flow writes author and commit message to FlowHistory
-   History panel shows who/when/why for every row
-   Tagging a history row creates a FlowVersionTag; listed in dialog
-   Publishing a version causes prediction API to serve that snapshot until unpublished
-   Rollback = publish an older version; takes effect immediately with no destructive edit to live flowData
-   All 4 DB dialects migrate cleanly and idempotently

---
