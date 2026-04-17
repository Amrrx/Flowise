# Flow Version Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authorship, named tags, and a publish pointer to the existing `FlowHistory` system so editors can see _who changed what_, tag specific versions, and decouple _what's being edited_ from _what's served to end users_.

**Architecture:** Three additive changes on top of the existing `FlowHistory` snapshot service: (1) three nullable author columns, (2) a new `FlowVersionTag` table, (3) a `publishedVersion` column on `ChatFlow` and `Assistant`. A single `resolveEffectiveFlowData` helper becomes the only place the publish pointer is consulted — every prediction path goes through it. Cherry-pick reusable entity/interface code from paused branch `feat/agentflow-version-control`, then prune `FlowDraft`.

**Tech Stack:** TypeORM 0.3.x, Express, TypeScript 5.4, React (MUI + Tabler icons) for UI. Jest for tests. Four DB dialects: sqlite, postgres, mariadb, mysql — each with its own timestamped migration file registered in `database/migrations/<dialect>/index.ts`.

---

## File Structure

**New files:**

-   `packages/server/src/database/entities/FlowVersionTag.ts` (via cherry-pick)
-   Three migrations × four dialects = **12 migration files**:
    -   `database/migrations/{sqlite,postgres,mariadb,mysql}/1767100000000-AddAuthorFieldsToFlowHistory.ts`
    -   `database/migrations/{sqlite,postgres,mariadb,mysql}/1767100000001-AddFlowVersionTagTable.ts`
    -   `database/migrations/{sqlite,postgres,mariadb,mysql}/1767100000002-AddPublishedVersionToEntities.ts`
-   `packages/server/src/services/flow-tags/index.ts`
-   `packages/server/src/services/flow-tags/index.test.ts`
-   `packages/server/src/controllers/flow-tags/index.ts`
-   `packages/server/src/routes/flow-tags/index.ts`
-   `packages/server/src/utils/resolveEffectiveFlowData.ts`
-   `packages/server/src/utils/resolveEffectiveFlowData.test.ts`
-   `packages/server/src/services/history/index.test.ts`
-   `packages/ui/src/api/flowTags.js`

**Modified files:**

-   `packages/server/src/Interface.ts` (cherry-pick, then prune `IFlowDraft` + `IDiffResult` + `draftData`)
-   `packages/server/src/database/entities/{FlowHistory,ChatFlow,Assistant,index}.ts`
-   `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/index.ts`
-   `packages/server/src/services/history/index.ts`
-   `packages/server/src/services/{chatflows,assistants}/index.ts`
-   `packages/server/src/controllers/{chatflows,assistants}/index.ts`
-   `packages/server/src/routes/{chatflows,assistants,index}.ts`
-   `packages/server/src/utils/{buildChatflow,buildAgentflow}.ts`
-   `packages/ui/src/views/canvas/CanvasHeader.jsx`
-   `packages/ui/src/ui-component/dialog/HistoryDialog.jsx`
-   `packages/ui/src/api/chatflows.js`, `packages/ui/src/api/assistants.js`

---

## Task 1: Branch setup, cherry-pick, FlowDraft cleanup

**Files:**

-   Create branch: `feat/flow-version-control` (already created)
-   Cherry-pick: `caec6b33`, `b0b06748` from `feat/agentflow-version-control`
-   Delete: `packages/server/src/database/entities/FlowDraft.ts`
-   Modify: `packages/server/src/Interface.ts`, `packages/server/src/database/entities/{ChatFlow,index}.ts`

-   [ ] **Step 1: Verify branch and spec commit**

```bash
git branch --show-current
# Expected: feat/flow-version-control
git log --oneline -1
# Expected: bb0eedeb docs: flow version control design spec (A+B+C scope)
```

-   [ ] **Step 2: Cherry-pick the two WIP commits**

```bash
git cherry-pick caec6b33 b0b06748
```

Expected: two new commits added; no conflicts.

-   [ ] **Step 3: Verify cherry-picks landed**

```bash
git log --oneline -4
# Expected (newest first):
#   <hash> feat(version-control): add FlowVersionTag and FlowDraft entities
#   <hash> feat(version-control): add flow version control interfaces
#   bb0eedeb docs: flow version control design spec (A+B+C scope)
#   f5fc6c17 Merge remote-tracking branch 'upstream/main'
ls packages/server/src/database/entities/FlowVersionTag.ts packages/server/src/database/entities/FlowDraft.ts
# Expected: both files exist
```

-   [ ] **Step 4: Delete `FlowDraft.ts`**

```bash
rm packages/server/src/database/entities/FlowDraft.ts
```

-   [ ] **Step 5: Remove `FlowDraft` import + registration from entities index**

File: `packages/server/src/database/entities/index.ts`

Remove the line that imports `FlowDraft` and the entry that registers it in the exported entity array. Leave `FlowVersionTag` in place.

-   [ ] **Step 6: Remove `draftData` column from `ChatFlow.ts`**

File: `packages/server/src/database/entities/ChatFlow.ts`

Delete the `draftData` column declaration. Keep `publishedVersion` and `currentHistoryVersion`. `mcpServerConfig` should remain (from upstream merge).

-   [ ] **Step 7: Prune interfaces**

File: `packages/server/src/Interface.ts`

Remove:

-   `IFlowDraft` interface declaration
-   `IDiffResult` interface declaration
-   `draftData?: string` line inside `IChatFlow`

Keep: `IFlowVersionTag`, the `commitMessage`/`authorId`/`authorName` additions to `IFlowHistory`, and `publishedVersion?: number` in `IChatFlow`.

-   [ ] **Step 8: Compile check**

```bash
pnpm --filter flowise-server exec tsc --noEmit
```

Expected: no errors.

-   [ ] **Step 9: Commit cleanup**

```bash
git add -A
git commit -m "chore(version-control): drop FlowDraft from scope (A+B+C only)"
```

---

## Task 2: Add `publishedVersion` to `Assistant` entity + interface

**Files:**

-   Modify: `packages/server/src/database/entities/Assistant.ts`
-   Modify: `packages/server/src/Interface.ts` (`IAssistant`)

-   [ ] **Step 1: Find the end of Assistant column declarations**

```bash
grep -n "currentHistoryVersion\|@UpdateDateColumn" packages/server/src/database/entities/Assistant.ts
```

Use the location of `currentHistoryVersion` as reference — put `publishedVersion` immediately after it.

-   [ ] **Step 2: Add `publishedVersion` column to `Assistant.ts`**

Insert right after `currentHistoryVersion`:

```ts
    @Column({ nullable: true, type: 'int' })
    publishedVersion?: number
```

-   [ ] **Step 3: Add `publishedVersion` to `IAssistant` in `Interface.ts`**

```ts
    publishedVersion?: number
```

Place immediately after `currentHistoryVersion` for consistency with ChatFlow.

-   [ ] **Step 4: Compile check**

```bash
pnpm --filter flowise-server exec tsc --noEmit
```

Expected: no errors.

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/database/entities/Assistant.ts packages/server/src/Interface.ts
git commit -m "feat(version-control): add publishedVersion to Assistant"
```

---

## Task 3: Migration — author fields on `FlowHistory` (4 dialects)

**Files:**

-   Create: `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/1767100000000-AddAuthorFieldsToFlowHistory.ts`
-   Modify: `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/index.ts`

Use timestamp `1767100000000` (after upstream's latest `1767000000000-AddMcpServerConfigToChatFlow`).

-   [ ] **Step 1: Create sqlite migration**

File: `packages/server/src/database/migrations/sqlite/1767100000000-AddAuthorFieldsToFlowHistory.ts`

```ts
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddAuthorFieldsToFlowHistory1767100000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        const columns: TableColumn[] = []
        if (!(await queryRunner.hasColumn('flow_history', 'commitMessage'))) {
            columns.push(new TableColumn({ name: 'commitMessage', type: 'text', isNullable: true }))
        }
        if (!(await queryRunner.hasColumn('flow_history', 'authorId'))) {
            columns.push(new TableColumn({ name: 'authorId', type: 'text', isNullable: true }))
        }
        if (!(await queryRunner.hasColumn('flow_history', 'authorName'))) {
            columns.push(new TableColumn({ name: 'authorName', type: 'text', isNullable: true }))
        }
        if (columns.length) await queryRunner.addColumns('flow_history', columns)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('flow_history', 'commitMessage')
        await queryRunner.dropColumn('flow_history', 'authorId')
        await queryRunner.dropColumn('flow_history', 'authorName')
    }
}
```

-   [ ] **Step 2: Duplicate to postgres / mariadb / mysql**

Same file content (TypeORM abstracts `TableColumn` types across dialects here — `text` works in all four). Create the same file in all three other dialect folders with identical content.

-   [ ] **Step 3: Register in each dialect's `index.ts`**

For each of `sqlite/index.ts`, `postgres/index.ts`, `mariadb/index.ts`, `mysql/index.ts`:

Add import:

```ts
import { AddAuthorFieldsToFlowHistory1767100000000 } from './1767100000000-AddAuthorFieldsToFlowHistory'
```

Add `AddAuthorFieldsToFlowHistory1767100000000` to the exported migrations array, **after** `AddMcpServerConfigToChatFlow1767000000000`.

-   [ ] **Step 4: Run migrations locally (sqlite)**

```bash
cd packages/server && pnpm typeorm migration:run -d dist/utils/typeormDataSource.js || cd ../..
```

If DB is fresh, all migrations run. If DB already has post-2026-04-14 state, only the new three run.

-   [ ] **Step 5: Verify columns**

```bash
sqlite3 ~/.flowise/database.sqlite ".schema flow_history" | grep -E "commitMessage|authorId|authorName"
```

Expected: three new columns present.

-   [ ] **Step 6: Commit**

```bash
git add packages/server/src/database/migrations/
git commit -m "feat(db): add author fields migration (flow_history) across 4 dialects"
```

---

## Task 4: Migration — `flow_version_tag` table (4 dialects)

**Files:**

-   Create: `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/1767100000001-AddFlowVersionTagTable.ts`
-   Modify: `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/index.ts`

-   [ ] **Step 1: Create sqlite migration**

File: `packages/server/src/database/migrations/sqlite/1767100000001-AddFlowVersionTagTable.ts`

```ts
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm'

export class AddFlowVersionTagTable1767100000001 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('flow_version_tag')) return

        await queryRunner.createTable(
            new Table({
                name: 'flow_version_tag',
                columns: [
                    { name: 'id', type: 'varchar', isPrimary: true },
                    { name: 'entityType', type: 'varchar', length: '20' },
                    { name: 'entityId', type: 'varchar' },
                    { name: 'historyId', type: 'varchar' },
                    { name: 'tagName', type: 'varchar', length: '100' },
                    { name: 'description', type: 'text', isNullable: true },
                    { name: 'createdById', type: 'text' },
                    { name: 'createdByName', type: 'text' },
                    { name: 'createdDate', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
                    { name: 'workspaceId', type: 'text' }
                ]
            })
        )
        await queryRunner.createIndex(
            'flow_version_tag',
            new TableIndex({
                name: 'IDX_flow_version_tag_entity_tag',
                columnNames: ['entityType', 'entityId', 'tagName'],
                isUnique: true
            })
        )
        await queryRunner.createIndex(
            'flow_version_tag',
            new TableIndex({ name: 'IDX_flow_version_tag_history', columnNames: ['historyId'] })
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('flow_version_tag', true)
    }
}
```

-   [ ] **Step 2: Postgres variant (uuid + timestamp)**

File: `packages/server/src/database/migrations/postgres/1767100000001-AddFlowVersionTagTable.ts`

Same content, but change:

-   `'id'`: `type: 'uuid'`, add `default: 'uuid_generate_v4()'`, `generationStrategy: 'uuid'`
-   `'entityId'`, `'historyId'`: `type: 'uuid'`
-   `'createdDate'`: `type: 'timestamp'`, `default: 'now()'`

Imports need `Table, TableIndex` only (same as sqlite).

-   [ ] **Step 3: MariaDB + MySQL variants**

Same as sqlite but:

-   `'createdDate'`: `type: 'datetime'`, `default: 'CURRENT_TIMESTAMP'`
-   `id` can remain `varchar(36)`

-   [ ] **Step 4: Register in each dialect's `index.ts`**

```ts
import { AddFlowVersionTagTable1767100000001 } from './1767100000001-AddFlowVersionTagTable'
```

Add after `AddAuthorFieldsToFlowHistory1767100000000` in the migrations array.

-   [ ] **Step 5: Run + verify (sqlite)**

```bash
sqlite3 ~/.flowise/database.sqlite ".schema flow_version_tag"
```

Expected: table exists with 10 columns and 2 indexes.

-   [ ] **Step 6: Commit**

```bash
git add packages/server/src/database/migrations/
git commit -m "feat(db): add flow_version_tag table migration across 4 dialects"
```

---

## Task 5: Migration — `publishedVersion` on `ChatFlow` + `Assistant` (4 dialects)

**Files:**

-   Create: `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/1767100000002-AddPublishedVersionToEntities.ts`
-   Modify: `packages/server/src/database/migrations/{sqlite,postgres,mariadb,mysql}/index.ts`

-   [ ] **Step 1: Create sqlite migration**

File: `packages/server/src/database/migrations/sqlite/1767100000002-AddPublishedVersionToEntities.ts`

```ts
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddPublishedVersionToEntities1767100000002 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('chat_flow', 'publishedVersion'))) {
            await queryRunner.addColumn('chat_flow', new TableColumn({ name: 'publishedVersion', type: 'int', isNullable: true }))
        }
        if (!(await queryRunner.hasColumn('assistant', 'publishedVersion'))) {
            await queryRunner.addColumn('assistant', new TableColumn({ name: 'publishedVersion', type: 'int', isNullable: true }))
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('chat_flow', 'publishedVersion')
        await queryRunner.dropColumn('assistant', 'publishedVersion')
    }
}
```

-   [ ] **Step 2: Duplicate to postgres / mariadb / mysql**

Same content; `int` is universal.

-   [ ] **Step 3: Register in each dialect's `index.ts`**

```ts
import { AddPublishedVersionToEntities1767100000002 } from './1767100000002-AddPublishedVersionToEntities'
```

Add after `AddFlowVersionTagTable1767100000001` in the migrations array.

-   [ ] **Step 4: Run + verify**

```bash
sqlite3 ~/.flowise/database.sqlite ".schema chat_flow" | grep publishedVersion
sqlite3 ~/.flowise/database.sqlite ".schema assistant" | grep publishedVersion
```

Expected: column present on both tables.

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/database/migrations/
git commit -m "feat(db): add publishedVersion column on ChatFlow + Assistant"
```

---

## Task 6: History service — stamp author fields on snapshot creation (TDD)

**Files:**

-   Modify: `packages/server/src/services/history/index.ts`
-   Create: `packages/server/src/services/history/index.test.ts`

-   [ ] **Step 1: Write the failing test for author propagation**

File: `packages/server/src/services/history/index.test.ts`

```ts
import historyService from './index'

jest.mock('../../utils/getRunningExpressApp', () => ({
    getRunningExpressApp: jest.fn()
}))

describe('historyService.createSnapshot', () => {
    let saveMock: jest.Mock
    let findOneMock: jest.Mock
    let updateMock: jest.Mock

    beforeEach(() => {
        saveMock = jest.fn(async (row) => ({ ...row, id: 'hist-1', version: 1, createdDate: new Date() }))
        findOneMock = jest.fn().mockResolvedValue(null)
        updateMock = jest.fn().mockResolvedValue({})
        const { getRunningExpressApp } = require('../../utils/getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: () => ({ save: saveMock, findOne: findOneMock, update: updateMock })
            }
        })
    })

    it('stamps authorId, authorName, commitMessage on new snapshot', async () => {
        await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            entityData: { flowData: '{}', id: 'cf-1' },
            changeDescription: 'update prompt',
            workspaceId: 'ws-1',
            author: { id: 'u-42', name: 'Alice' },
            commitMessage: 'fixed greeting'
        })
        expect(saveMock).toHaveBeenCalledWith(
            expect.objectContaining({
                authorId: 'u-42',
                authorName: 'Alice',
                commitMessage: 'fixed greeting'
            })
        )
    })

    it('accepts snapshot without author (nullable)', async () => {
        await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            entityData: { flowData: '{}', id: 'cf-1' },
            workspaceId: 'ws-1'
        })
        expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ authorId: undefined, authorName: undefined }))
    })
})
```

-   [ ] **Step 2: Run test — should FAIL**

```bash
pnpm --filter flowise-server exec jest src/services/history/index.test.ts
```

Expected: fail (service doesn't accept `author`/`commitMessage`).

-   [ ] **Step 3: Extend `CreateSnapshotOptions` + writer**

File: `packages/server/src/services/history/index.ts`

Find the `CreateSnapshotOptions` interface and add:

```ts
    author?: { id: string; name: string }
    commitMessage?: string
```

Find the body of `createSnapshot` where the new `FlowHistory` row is built, and add:

```ts
    authorId: author?.id,
    authorName: author?.name,
    commitMessage
```

Note: `changeDescription` stays — it represents system-generated messages (e.g., "Initial creation"). `commitMessage` is user-supplied.

-   [ ] **Step 4: Run test — should PASS**

```bash
pnpm --filter flowise-server exec jest src/services/history/index.test.ts
```

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/history
git commit -m "feat(history): accept and persist author + commitMessage on createSnapshot"
```

---

## Task 7: Chatflow + assistant service — pass author + commitMessage to snapshots

**Files:**

-   Modify: `packages/server/src/services/chatflows/index.ts`
-   Modify: `packages/server/src/services/assistants/index.ts`
-   Modify: `packages/server/src/controllers/chatflows/index.ts` (pull user + body message)
-   Modify: `packages/server/src/controllers/assistants/index.ts`

-   [ ] **Step 1: Update `chatflowsService.saveChatflow` signature**

File: `packages/server/src/services/chatflows/index.ts`

Add optional `options` param to `saveChatflow`:

```ts
interface SaveChatflowOptions {
    author?: { id: string; name: string }
    commitMessage?: string
}

const saveChatflow = async (newChatFlow: Partial<IChatFlow>, orgId: string, options?: SaveChatflowOptions): Promise<any> => {
```

-   [ ] **Step 2: Pass to createSnapshot call sites**

In both `createSnapshot` calls inside `chatflows/index.ts`, add:

```ts
author: options?.author,
commitMessage: options?.commitMessage
```

Also do the same for `updateChatflow` (which already calls `createSnapshot`).

-   [ ] **Step 3: Update controller to extract and forward**

File: `packages/server/src/controllers/chatflows/index.ts`

In the `saveChatflow` handler (and `updateChatflow`), inject:

```ts
const author = req.user ? { id: req.user.id, name: req.user.name } : undefined
const commitMessage = typeof req.body?.commitMessage === 'string' ? req.body.commitMessage : undefined
// ...
const apiResponse = await chatflowsService.saveChatflow(req.body, orgId, { author, commitMessage })
```

-   [ ] **Step 4: Mirror for Assistant**

Apply the same four changes to `services/assistants/index.ts` and `controllers/assistants/index.ts`.

-   [ ] **Step 5: Compile**

```bash
pnpm --filter flowise-server exec tsc --noEmit
```

-   [ ] **Step 6: Smoke test via curl**

Start server. Save a chatflow with a body that includes `"commitMessage": "test author stamping"`. Then:

```bash
sqlite3 ~/.flowise/database.sqlite "SELECT authorId, authorName, commitMessage FROM flow_history ORDER BY createdDate DESC LIMIT 1"
```

Expected: your user id, name, and `test author stamping`.

-   [ ] **Step 7: Commit**

```bash
git add packages/server/src/{services,controllers}/{chatflows,assistants}
git commit -m "feat(history): capture request user as snapshot author"
```

---

## Task 8: Flow-tags service (TDD)

**Files:**

-   Create: `packages/server/src/services/flow-tags/index.ts`
-   Create: `packages/server/src/services/flow-tags/index.test.ts`

-   [ ] **Step 1: Write failing tests**

File: `packages/server/src/services/flow-tags/index.test.ts`

```ts
import flowTagsService from './index'

jest.mock('../../utils/getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))

describe('flowTagsService', () => {
    let tagRepo: any
    let historyRepo: any

    beforeEach(() => {
        tagRepo = {
            save: jest.fn(async (r) => ({ ...r, id: 'tag-1' })),
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            delete: jest.fn().mockResolvedValue({ affected: 1 })
        }
        historyRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'hist-1',
                entityType: 'CHATFLOW',
                entityId: 'cf-1',
                version: 3,
                workspaceId: 'ws-1'
            })
        }
        const { getRunningExpressApp } = require('../../utils/getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: (entity: any) => (entity?.name === 'FlowVersionTag' || entity === 'FlowVersionTag' ? tagRepo : historyRepo)
            }
        })
    })

    it('createTag writes entityType/entityId derived from history', async () => {
        const result = await flowTagsService.createTag({
            historyId: 'hist-1',
            tagName: 'release-1',
            description: 'first',
            user: { id: 'u-42', name: 'Alice' },
            workspaceId: 'ws-1'
        })
        expect(tagRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({
                entityType: 'CHATFLOW',
                entityId: 'cf-1',
                historyId: 'hist-1',
                tagName: 'release-1',
                createdById: 'u-42',
                createdByName: 'Alice'
            })
        )
        expect(result.id).toBe('tag-1')
    })

    it('createTag rejects when history not found', async () => {
        historyRepo.findOne.mockResolvedValue(null)
        await expect(
            flowTagsService.createTag({
                historyId: 'missing',
                tagName: 't',
                user: { id: 'u', name: 'u' },
                workspaceId: 'ws-1'
            })
        ).rejects.toThrow(/not found/i)
    })

    it('createTag rejects on workspace mismatch', async () => {
        historyRepo.findOne.mockResolvedValue({
            id: 'hist-1',
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            version: 3,
            workspaceId: 'other-ws'
        })
        await expect(
            flowTagsService.createTag({
                historyId: 'hist-1',
                tagName: 't',
                user: { id: 'u', name: 'u' },
                workspaceId: 'ws-1'
            })
        ).rejects.toThrow(/workspace/i)
    })
})
```

-   [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter flowise-server exec jest src/services/flow-tags
```

-   [ ] **Step 3: Implement `flow-tags/index.ts`**

```ts
import { StatusCodes } from 'http-status-codes'
import { FlowHistory, EntityType } from '../../database/entities/FlowHistory'
import { FlowVersionTag } from '../../database/entities/FlowVersionTag'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

interface CreateTagOptions {
    historyId: string
    tagName: string
    description?: string
    user: { id: string; name: string }
    workspaceId: string
}

interface ListTagsOptions {
    entityType: EntityType
    entityId: string
    workspaceId: string
}

const createTag = async ({ historyId, tagName, description, user, workspaceId }: CreateTagOptions): Promise<FlowVersionTag> => {
    const app = getRunningExpressApp()
    const historyRepo = app.AppDataSource.getRepository(FlowHistory)
    const tagRepo = app.AppDataSource.getRepository(FlowVersionTag)

    const snapshot = await historyRepo.findOne({ where: { id: historyId } })
    if (!snapshot) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `History snapshot ${historyId} not found`)
    }
    if (snapshot.workspaceId && snapshot.workspaceId !== workspaceId) {
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'History snapshot belongs to a different workspace')
    }

    const tag = tagRepo.create({
        entityType: snapshot.entityType,
        entityId: snapshot.entityId,
        historyId,
        tagName,
        description,
        createdById: user.id,
        createdByName: user.name,
        workspaceId
    })
    return tagRepo.save(tag)
}

const listTags = async ({ entityType, entityId, workspaceId }: ListTagsOptions): Promise<FlowVersionTag[]> => {
    const tagRepo = getRunningExpressApp().AppDataSource.getRepository(FlowVersionTag)
    return tagRepo.find({
        where: { entityType, entityId, workspaceId },
        order: { createdDate: 'DESC' }
    })
}

const deleteTag = async (tagId: string, workspaceId: string): Promise<void> => {
    const tagRepo = getRunningExpressApp().AppDataSource.getRepository(FlowVersionTag)
    const tag = await tagRepo.findOne({ where: { id: tagId } })
    if (!tag) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Tag ${tagId} not found`)
    }
    if (tag.workspaceId !== workspaceId) {
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'Tag belongs to a different workspace')
    }
    await tagRepo.delete(tagId)
}

export default { createTag, listTags, deleteTag }
```

-   [ ] **Step 4: Run — PASS**

```bash
pnpm --filter flowise-server exec jest src/services/flow-tags
```

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/flow-tags
git commit -m "feat(tags): add flow-tags service (create/list/delete with workspace guards)"
```

---

## Task 9: Publish / unpublish — chatflow + assistant services (TDD)

**Files:**

-   Modify: `packages/server/src/services/chatflows/index.ts`
-   Modify: `packages/server/src/services/assistants/index.ts`

-   [ ] **Step 1: Add `publish` + `unpublish` test**

Append to (or create) a chatflows service test file:
`packages/server/src/services/chatflows/index.test.ts`

```ts
import chatflowsService from './index'

jest.mock('../../utils/getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))

describe('chatflowsService.publish', () => {
    let chatflowRepo: any
    let historyRepo: any

    beforeEach(() => {
        chatflowRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'cf-1',
                workspaceId: 'ws-1',
                currentHistoryVersion: 5
            }),
            update: jest.fn().mockResolvedValue({})
        }
        historyRepo = {
            findOne: jest.fn().mockResolvedValue({ version: 3 })
        }
        const { getRunningExpressApp } = require('../../utils/getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: (e: any) => (e?.name === 'FlowHistory' || e === 'FlowHistory' ? historyRepo : chatflowRepo)
            }
        })
    })

    it('publishes explicit version when provided', async () => {
        await chatflowsService.publish('cf-1', 3, 'ws-1')
        expect(chatflowRepo.update).toHaveBeenCalledWith('cf-1', { publishedVersion: 3 })
    })

    it('defaults to currentHistoryVersion when version omitted', async () => {
        await chatflowsService.publish('cf-1', undefined, 'ws-1')
        expect(chatflowRepo.update).toHaveBeenCalledWith('cf-1', { publishedVersion: 5 })
    })

    it('rejects non-existent version', async () => {
        historyRepo.findOne.mockResolvedValue(null)
        await expect(chatflowsService.publish('cf-1', 99, 'ws-1')).rejects.toThrow(/version/i)
    })

    it('unpublish clears pointer', async () => {
        await chatflowsService.unpublish('cf-1', 'ws-1')
        expect(chatflowRepo.update).toHaveBeenCalledWith('cf-1', { publishedVersion: null })
    })
})
```

-   [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter flowise-server exec jest src/services/chatflows/index.test.ts
```

-   [ ] **Step 3: Add `publish` + `unpublish` in `chatflowsService`**

File: `packages/server/src/services/chatflows/index.ts`. Append:

```ts
const publish = async (id: string, version: number | undefined, workspaceId: string): Promise<void> => {
    const appServer = getRunningExpressApp()
    const cfRepo = appServer.AppDataSource.getRepository(ChatFlow)
    const historyRepo = appServer.AppDataSource.getRepository(FlowHistory)

    const chatflow = await cfRepo.findOne({ where: { id } })
    if (!chatflow) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${id} not found`)
    if (chatflow.workspaceId !== workspaceId)
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'Chatflow belongs to a different workspace')

    const targetVersion = version ?? chatflow.currentHistoryVersion
    if (!targetVersion) throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'No version available to publish')

    const snapshot = await historyRepo.findOne({
        where: { entityType: 'CHATFLOW', entityId: id, version: targetVersion }
    })
    if (!snapshot) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `History version ${targetVersion} not found`)

    await cfRepo.update(id, { publishedVersion: targetVersion })
}

const unpublish = async (id: string, workspaceId: string): Promise<void> => {
    const appServer = getRunningExpressApp()
    const cfRepo = appServer.AppDataSource.getRepository(ChatFlow)
    const chatflow = await cfRepo.findOne({ where: { id } })
    if (!chatflow) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${id} not found`)
    if (chatflow.workspaceId !== workspaceId)
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'Chatflow belongs to a different workspace')
    await cfRepo.update(id, { publishedVersion: null })
}
```

Add `publish` and `unpublish` to the default export object.

-   [ ] **Step 4: Run — PASS**

```bash
pnpm --filter flowise-server exec jest src/services/chatflows/index.test.ts
```

-   [ ] **Step 5: Mirror for Assistant**

Copy the same `publish`/`unpublish` structure into `services/assistants/index.ts`, substituting `Assistant` repository and `entityType: 'ASSISTANT'`. No test duplication needed unless the service has distinct behavior (it doesn't).

-   [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/{chatflows,assistants}
git commit -m "feat(publish): add publish/unpublish in chatflows + assistants services"
```

---

## Task 10: `resolveEffectiveFlowData` helper (TDD)

**Files:**

-   Create: `packages/server/src/utils/resolveEffectiveFlowData.ts`
-   Create: `packages/server/src/utils/resolveEffectiveFlowData.test.ts`

-   [ ] **Step 1: Write failing test**

File: `packages/server/src/utils/resolveEffectiveFlowData.test.ts`

```ts
import { resolveEffectiveFlowData } from './resolveEffectiveFlowData'

jest.mock('./getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))

describe('resolveEffectiveFlowData', () => {
    it('returns entity.flowData when publishedVersion is null', async () => {
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: null }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })

    it('returns snapshot.snapshotData when publishedVersion set', async () => {
        const findOneMock = jest.fn().mockResolvedValue({ snapshotData: JSON.stringify({ flowData: 'PUBLISHED' }) })
        const { getRunningExpressApp } = require('./getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: { getRepository: () => ({ findOne: findOneMock }) }
        })
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: 3 }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('PUBLISHED')
    })

    it('falls back to entity.flowData if snapshot missing', async () => {
        const findOneMock = jest.fn().mockResolvedValue(null)
        const { getRunningExpressApp } = require('./getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: { getRepository: () => ({ findOne: findOneMock }) }
        })
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: 99 }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })
})
```

-   [ ] **Step 2: Run — FAIL**

```bash
pnpm --filter flowise-server exec jest src/utils/resolveEffectiveFlowData
```

-   [ ] **Step 3: Implement helper**

File: `packages/server/src/utils/resolveEffectiveFlowData.ts`

```ts
import { FlowHistory, EntityType } from '../database/entities/FlowHistory'
import { getRunningExpressApp } from './getRunningExpressApp'

interface PublishableEntity {
    id: string
    flowData?: string
    publishedVersion?: number | null
}

export async function resolveEffectiveFlowData<T extends PublishableEntity>(
    entityType: EntityType,
    entity: T
): Promise<string | undefined> {
    if (!entity.publishedVersion) return entity.flowData

    const historyRepo = getRunningExpressApp().AppDataSource.getRepository(FlowHistory)
    const snapshot = await historyRepo.findOne({
        where: { entityType, entityId: entity.id, version: entity.publishedVersion }
    })
    if (!snapshot) return entity.flowData

    try {
        const parsed = JSON.parse(snapshot.snapshotData)
        return parsed.flowData ?? entity.flowData
    } catch {
        return entity.flowData
    }
}
```

-   [ ] **Step 4: Run — PASS**

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/utils/resolveEffectiveFlowData.ts packages/server/src/utils/resolveEffectiveFlowData.test.ts
git commit -m "feat(publish): add resolveEffectiveFlowData helper"
```

---

## Task 11: Integrate resolver in `buildChatflow` + `buildAgentflow`

**Files:**

-   Modify: `packages/server/src/utils/buildChatflow.ts`
-   Modify: `packages/server/src/utils/buildAgentflow.ts`

-   [ ] **Step 1: Locate flowData usage in `buildChatflow.ts`**

```bash
grep -n "chatflow\.flowData\|\.flowData)" packages/server/src/utils/buildChatflow.ts | head
```

Identify the first call site where a chatflow object's `flowData` is parsed or used to build nodes.

-   [ ] **Step 2: Replace direct access with resolver**

Near the top of the prediction flow (after chatflow is loaded from DB, before `flowData` is parsed), insert:

```ts
import { resolveEffectiveFlowData } from './resolveEffectiveFlowData'
// ...
const effectiveFlowData = await resolveEffectiveFlowData('CHATFLOW', chatflow)
// Then use effectiveFlowData instead of chatflow.flowData for parsing / building nodes
```

The goal: every `JSON.parse(chatflow.flowData)` downstream should parse `effectiveFlowData` instead. If you see multiple call sites in the same function, assign `chatflow.flowData = effectiveFlowData ?? chatflow.flowData` immediately after the call and leave downstream code unchanged.

-   [ ] **Step 3: Repeat for `buildAgentflow.ts`**

Same pattern — use `EntityType` `'CHATFLOW'` (agentflows are stored in ChatFlow table with a different `type`).

-   [ ] **Step 4: Manual smoke test**

1. Save chatflow `X` (creates history v1).
2. `curl -X POST /api/v1/chatflows/X/publish -d '{}' -H 'content-type: application/json'` — Task 12 endpoint, skip for now and hit DB directly: `UPDATE chat_flow SET publishedVersion = 1 WHERE id = 'X'`.
3. Save a modification that creates v2 (change the prompt).
4. Hit prediction endpoint for `X` — should get v1 behavior, not v2.
5. Clear `publishedVersion` in DB, retry — should get v2.

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/utils/build*.ts
git commit -m "feat(publish): resolve effective flowData in build paths"
```

---

## Task 12: Controllers + routes — publish + tag endpoints

**Files:**

-   Modify: `packages/server/src/controllers/chatflows/index.ts` (add `publish`, `unpublish`)
-   Modify: `packages/server/src/controllers/assistants/index.ts` (add `publish`, `unpublish`)
-   Create: `packages/server/src/controllers/flow-tags/index.ts`
-   Create: `packages/server/src/routes/flow-tags/index.ts`
-   Modify: `packages/server/src/routes/chatflows/index.ts` (mount publish routes)
-   Modify: `packages/server/src/routes/assistants/index.ts` (mount publish routes)
-   Modify: `packages/server/src/routes/index.ts` (mount `/flow-tags` + `/history` tag sub-routes)

-   [ ] **Step 1: Add `publish` + `unpublish` to chatflows controller**

File: `packages/server/src/controllers/chatflows/index.ts`

```ts
const publishChatflow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params
        const version = typeof req.body?.version === 'number' ? req.body.version : undefined
        await chatflowsService.publish(id, version, req.user?.activeWorkspaceId)
        return res.json({ success: true })
    } catch (err) {
        next(err)
    }
}

const unpublishChatflow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await chatflowsService.unpublish(req.params.id, req.user?.activeWorkspaceId)
        return res.json({ success: true })
    } catch (err) {
        next(err)
    }
}
```

Export them in the default object.

-   [ ] **Step 2: Mount chatflow publish routes**

File: `packages/server/src/routes/chatflows/index.ts`

```ts
router.post('/:id/publish', checkAnyPermission('chatflows:update'), chatflowsController.publishChatflow)
router.delete('/:id/publish', checkAnyPermission('chatflows:update'), chatflowsController.unpublishChatflow)
```

-   [ ] **Step 3: Mirror for Assistant**

Same pattern — `publishAssistant`, `unpublishAssistant`, same route shape under `/assistants/:id/publish`, permission `assistants:update`.

-   [ ] **Step 4: Create flow-tags controller**

File: `packages/server/src/controllers/flow-tags/index.ts`

```ts
import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { EntityType } from '../../database/entities/FlowHistory'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import flowTagsService from '../../services/flow-tags'

const validateEntityType = (t: string): EntityType => {
    const u = t.toUpperCase()
    if (!['CHATFLOW', 'ASSISTANT'].includes(u)) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'entityType must be CHATFLOW or ASSISTANT')
    }
    return u as EntityType
}

const createTag = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { historyId } = req.params
        const { tagName, description } = req.body
        if (!tagName) throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'tagName is required')
        const result = await flowTagsService.createTag({
            historyId,
            tagName,
            description,
            user: { id: req.user!.id, name: req.user!.name },
            workspaceId: req.user!.activeWorkspaceId
        })
        return res.json(result)
    } catch (err) {
        next(err)
    }
}

const listTags = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const entityType = validateEntityType(req.params.entityType)
        const result = await flowTagsService.listTags({
            entityType,
            entityId: req.params.entityId,
            workspaceId: req.user!.activeWorkspaceId
        })
        return res.json(result)
    } catch (err) {
        next(err)
    }
}

const deleteTag = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await flowTagsService.deleteTag(req.params.tagId, req.user!.activeWorkspaceId)
        return res.json({ success: true })
    } catch (err) {
        next(err)
    }
}

export default { createTag, listTags, deleteTag }
```

-   [ ] **Step 5: Create flow-tags router**

File: `packages/server/src/routes/flow-tags/index.ts`

```ts
import express from 'express'
import flowTagsController from '../../controllers/flow-tags'
import { checkAnyPermission } from '../../enterprise/rbac/PermissionCheck'

const router = express.Router()

router.post('/history/:historyId', checkAnyPermission('chatflows:update,assistants:update'), flowTagsController.createTag)
router.get('/entity/:entityType/:entityId', checkAnyPermission('chatflows:view,assistants:view'), flowTagsController.listTags)
router.delete('/:tagId', checkAnyPermission('chatflows:update,assistants:update'), flowTagsController.deleteTag)

export default router
```

-   [ ] **Step 6: Register router**

File: `packages/server/src/routes/index.ts`

Import:

```ts
import flowTagsRouter from './flow-tags'
```

Mount (group with history):

```ts
router.use('/flow-tags', flowTagsRouter)
```

-   [ ] **Step 7: Manual endpoint check**

```bash
curl -s http://localhost:3002/api/v1/flow-tags/entity/CHATFLOW/<id> -H "Authorization: ..." | jq
# Expected: []
```

-   [ ] **Step 8: Commit**

```bash
git add packages/server/src/controllers packages/server/src/routes
git commit -m "feat(version-control): publish + tag HTTP endpoints"
```

---

## Task 13: UI — Canvas header publish button + badge

**Files:**

-   Modify: `packages/ui/src/views/canvas/CanvasHeader.jsx`
-   Modify: `packages/ui/src/api/chatflows.js` (add publish + unpublish)
-   Modify: `packages/ui/src/api/assistants.js` (same)

-   [ ] **Step 1: Add API client functions**

File: `packages/ui/src/api/chatflows.js`

```js
const publishChatflow = (id, version) => client.post(`/chatflows/${id}/publish`, version ? { version } : {})
const unpublishChatflow = (id) => client.delete(`/chatflows/${id}/publish`)
```

Add to the default export. Mirror the same two functions in `packages/ui/src/api/assistants.js`.

-   [ ] **Step 2: Locate toolbar area in `CanvasHeader.jsx`**

```bash
grep -n "IconButton\|Save\|Tooltip" packages/ui/src/views/canvas/CanvasHeader.jsx | head -20
```

Find the save-button region — publish button goes next to it.

-   [ ] **Step 3: Add publish button + status badge**

Inside the header render, adjacent to the existing save button, add:

```jsx
import { IconRocket, IconRocketOff } from '@tabler/icons-react'
import { Chip } from '@mui/material'
import chatflowsApi from '@/api/chatflows'

// Inside the component, after chatflow state hook:
const publishedVersion = chatflow?.publishedVersion ?? null
const currentHistoryVersion = chatflow?.currentHistoryVersion ?? null
const hasUnpublishedChanges = publishedVersion !== null && publishedVersion !== currentHistoryVersion

const handlePublish = async () => {
    try {
        await chatflowsApi.publishChatflow(chatflow.id)
        enqueueSnackbar('Published current version', { variant: 'success' })
        // trigger chatflow reload
    } catch (e) {
        enqueueSnackbar(e.message, { variant: 'error' })
    }
}
const handleUnpublish = async () => {
    try {
        await chatflowsApi.unpublishChatflow(chatflow.id)
        enqueueSnackbar('Unpublished — end users now get live edits', { variant: 'success' })
    } catch (e) {
        enqueueSnackbar(e.message, { variant: 'error' })
    }
}

// Render (next to Save button):
{
    publishedVersion !== null && (
        <Chip
            size='small'
            label={`Published v${publishedVersion}${hasUnpublishedChanges ? ` · Editing v${currentHistoryVersion}` : ''}`}
            color={hasUnpublishedChanges ? 'warning' : 'success'}
        />
    )
}
;<Tooltip title={publishedVersion === null ? 'Publish current version to end users' : 'Unpublish (serve live edits)'}>
    <IconButton onClick={publishedVersion === null ? handlePublish : handleUnpublish} disabled={!chatflow?.id}>
        {publishedVersion === null ? <IconRocket /> : <IconRocketOff />}
    </IconButton>
</Tooltip>
```

Replace the "trigger chatflow reload" comment with the existing reload mechanism in the file (likely a Redux action or `setChatflow`).

-   [ ] **Step 4: Manually test**

Start UI (`pnpm --filter flowise-ui dev`) and server. Open a chatflow, click the rocket. Confirm chip appears, DB has `publishedVersion` set, end-user prediction calls serve that version.

-   [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): publish button + status badge on canvas header"
```

---

## Task 14: UI — Author column + tag/publish actions in History dialog

**Files:**

-   Modify: `packages/ui/src/ui-component/dialog/HistoryDialog.jsx`
-   Create: `packages/ui/src/api/flowTags.js`

-   [ ] **Step 1: Create flow-tags API client**

File: `packages/ui/src/api/flowTags.js`

```js
import client from './client'

const createTag = (historyId, tagName, description) => client.post(`/flow-tags/history/${historyId}`, { tagName, description })

const listTags = (entityType, entityId) => client.get(`/flow-tags/entity/${entityType}/${entityId}`)

const deleteTag = (tagId) => client.delete(`/flow-tags/${tagId}`)

export default { createTag, listTags, deleteTag }
```

-   [ ] **Step 2: Add Author + Message columns to history list**

File: `packages/ui/src/ui-component/dialog/HistoryDialog.jsx`

Locate the list-item render where each snapshot is shown. Under the existing primary/secondary text, add:

```jsx
<Typography variant='caption' color='text.secondary'>
    {item.authorName || '—'} · {item.commitMessage || item.changeDescription || 'No message'}
</Typography>
```

-   [ ] **Step 3: Add "Tag" + "Publish this version" row actions**

Inside `ListItemSecondaryAction` (where `IconRestore`/`IconTrash` currently live), add two more icon buttons with tooltips:

```jsx
import { IconTag, IconRocket } from '@tabler/icons-react'
import flowTagsApi from '@/api/flowTags'
import chatflowsApi from '@/api/chatflows'

// Handler (add to component):
const handleTag = async (item) => {
    const tagName = window.prompt('Tag name (e.g., release-2026-04):')
    if (!tagName) return
    try {
        await flowTagsApi.createTag(item.id, tagName)
        enqueueSnackbar(`Tagged v${item.version} as "${tagName}"`, { variant: 'success' })
    } catch (e) { enqueueSnackbar(e.message, { variant: 'error' }) }
}
const handlePublishVersion = async (item) => {
    try {
        await chatflowsApi.publishChatflow(entityId, item.version)
        enqueueSnackbar(`Published v${item.version}`, { variant: 'success' })
    } catch (e) { enqueueSnackbar(e.message, { variant: 'error' }) }
}

// Render inside ListItemSecondaryAction, between view and restore:
<Tooltip title='Tag this version'>
    <IconButton size='small' onClick={() => handleTag(item)}><IconTag /></IconButton>
</Tooltip>
<Tooltip title='Publish this version to end users'>
    <IconButton size='small' onClick={() => handlePublishVersion(item)}><IconRocket /></IconButton>
</Tooltip>
```

Note: `window.prompt` is a deliberate shortcut for the simple-form tag input — upgrade to a proper dialog only if needed.

-   [ ] **Step 4: Manually verify end-to-end**

1. Save chatflow 3 times.
2. Open history dialog.
3. Each row shows author + message.
4. Click tag icon on v2, type `demo`, confirm snackbar.
5. Click rocket on v2, confirm snackbar.
6. Return to canvas — chip should say `Published v2 · Editing v3`.
7. Refresh history — tag is saved.

-   [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): author display + tag/publish actions in history dialog"
```

---

## Task 15: End-to-end smoke test + final commit

-   [ ] **Step 1: Ensure all Jest suites pass**

```bash
pnpm --filter flowise-server test
```

Expected: all green (including new `history`, `flow-tags`, `chatflows`, `resolveEffectiveFlowData` tests).

-   [ ] **Step 2: Migration replay check**

Delete local DB, restart server with a fresh sqlite file, confirm all migrations run from scratch without error:

```bash
mv ~/.flowise/database.sqlite ~/.flowise/database.sqlite.bak && pnpm start
```

Expected: server starts cleanly.

-   [ ] **Step 3: Restore DB**

```bash
mv ~/.flowise/database.sqlite ~/.flowise/database.sqlite.fresh
mv ~/.flowise/database.sqlite.bak ~/.flowise/database.sqlite
```

-   [ ] **Step 4: Manual regression check**

Before merging: confirm the golden path still works without any publish/tag involvement (unpublished chatflow serves live `flowData` as before).

-   [ ] **Step 5: Push feature branch to origin**

```bash
git push -u origin feat/flow-version-control
```

---

## Risks & watch-outs (during execution)

-   **`buildChatflow.ts` / `buildAgentflow.ts` fork-specific logic** — those files survived the upstream merge with your customizations. Confirm the resolver insertion doesn't collide with MCP routing. If `flowData` is parsed in more than one location in a single function, assign `chatflow.flowData = effectiveFlowData ?? chatflow.flowData` once near the top so downstream code is unchanged.
-   **Permission names** — `checkAnyPermission('chatflows:update,assistants:update')` expects permissions defined in your enterprise RBAC. Confirm they exist; if `publishedVersion` needs finer-grained control later (e.g., `chatflows:publish`), make that a follow-up.
-   **Workspace isolation** — every service guards on `workspaceId`. Don't remove those checks during refactor-temptations.
-   **FKs on FlowVersionTag.historyId** — not enforced at DB level (TypeORM `@Index` only). Accept the soft constraint; ON DELETE CASCADE not worth the per-dialect complexity.
-   **`mcpServerConfig` survival** — when cherry-picking the entities commit, confirm `mcpServerConfig` column is still present on `ChatFlow` after cleanup.
