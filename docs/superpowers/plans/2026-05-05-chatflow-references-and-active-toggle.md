# Chatflow References & Active Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow callers to reference chatflows by `name` or `name@tag`, add a runtime active/inactive toggle reusing the dead `deployed` column, and enforce per-chatflow uniqueness of the `production` tag.

**Architecture:** All three features converge on a new `resolveChatflowReference()` utility called from the prediction controller. UUID lookups remain unchanged for backward compatibility. The dead `ChatFlow.deployed` column gets a guard in the controller and a UI surface labelled "Active".

**Tech Stack:** TypeScript / Express / TypeORM / Jest / React (MUI). Four DB engines supported (sqlite, postgres, mysql, mariadb).

**Spec:** [`docs/superpowers/specs/2026-05-05-chatflow-references-and-active-toggle-design.md`](../specs/2026-05-05-chatflow-references-and-active-toggle-design.md)

---

## Phase 0 — Prep

### Task 0: Commit baseline (spec only)

**Files:**

-   Existing untracked: `docs/superpowers/specs/2026-05-05-chatflow-references-and-active-toggle-design.md`
-   Existing untracked: `docs/superpowers/plans/2026-05-05-chatflow-references-and-active-toggle.md` (this file)

-   [ ] **Step 1: Verify branch and clean state**

```bash
git branch --show-current
git status --short
```

Expected branch: `feature/chatflow-references-and-active-toggle`
Expected status: only the spec and this plan as untracked.

-   [ ] **Step 2: Commit spec + plan**

```bash
git add docs/superpowers/specs/2026-05-05-chatflow-references-and-active-toggle-design.md docs/superpowers/plans/2026-05-05-chatflow-references-and-active-toggle.md
git commit -m "docs: spec and plan for chatflow references and active toggle"
```

---

## Phase 1 — Database: unique chatflow name per workspace

### Task 1: Add unique index decorator on `ChatFlow.name`

**Files:**

-   Modify: `packages/server/src/database/entities/ChatFlow.ts`

-   [ ] **Step 1: Add `@Index` import and decorator**

In `packages/server/src/database/entities/ChatFlow.ts`, add `Index` to the typeorm import and decorate the class:

```ts
import { Entity, Column, CreateDateColumn, UpdateDateColumn, PrimaryGeneratedColumn, Index } from 'typeorm'
// ...
@Entity()
@Index('idx_chat_flow_name_workspace', ['name', 'workspaceId'], { unique: true })
export class ChatFlow implements IChatFlow {
```

-   [ ] **Step 2: Add explanatory comment on `deployed`**

Replace the `deployed` column line with:

```ts
// 'deployed' is reused as the runtime active/inactive toggle.
// When false, the prediction controller rejects requests with 403.
// (UI labels this "Active/Inactive" — name retained to avoid breaking migrations.)
@Column({ nullable: true })
deployed?: boolean
```

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/database/entities/ChatFlow.ts
git commit -m "feat(chatflow): unique name per workspace; document deployed reuse"
```

### Task 2: Migration — sqlite

**Files:**

-   Create: `packages/server/src/database/migrations/sqlite/1788000000000-UniqueChatFlowNamePerWorkspace.ts`
-   Modify: `packages/server/src/database/migrations/sqlite/index.ts` (export new migration)

-   [ ] **Step 1: Create migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Resolve duplicates by appending " (N)" so the unique index can be created.
        await queryRunner.query(`
            UPDATE chat_flow
               SET name = name || ' (' || (
                   SELECT COUNT(*) FROM chat_flow AS dup
                    WHERE dup.workspaceId = chat_flow.workspaceId
                      AND dup.name = chat_flow.name
                      AND dup.createdDate < chat_flow.createdDate
               ) || ')'
             WHERE rowid IN (
                 SELECT cf.rowid
                   FROM chat_flow cf
                   JOIN chat_flow other
                     ON other.workspaceId = cf.workspaceId
                    AND other.name = cf.name
                    AND other.createdDate < cf.createdDate
             );
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, workspaceId);`)
        // Backfill: existing flows are active. Default for new flows handled in UI.
        await queryRunner.query(`UPDATE chat_flow SET deployed = 1 WHERE deployed IS NULL OR deployed = 0;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS idx_chat_flow_name_workspace;`)
    }
}
```

-   [ ] **Step 2: Register in migrations index**

In `packages/server/src/database/migrations/sqlite/index.ts`, add the import and append to the exported array.

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/database/migrations/sqlite/
git commit -m "feat(db): sqlite migration for unique chatflow name and deployed backfill"
```

### Task 3: Migration — postgres

**Files:**

-   Create: `packages/server/src/database/migrations/postgres/1788000000000-UniqueChatFlowNamePerWorkspace.ts`
-   Modify: `packages/server/src/database/migrations/postgres/index.ts`

-   [ ] **Step 1: Create migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY "workspaceId", name ORDER BY "createdDate") - 1 AS dup_rank
                  FROM chat_flow
            )
            UPDATE chat_flow
               SET name = chat_flow.name || ' (' || ranked.dup_rank || ')'
              FROM ranked
             WHERE chat_flow.id = ranked.id
               AND ranked.dup_rank > 0;
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, "workspaceId");`)
        await queryRunner.query(`UPDATE chat_flow SET deployed = true WHERE deployed IS NULL OR deployed = false;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS idx_chat_flow_name_workspace;`)
    }
}
```

-   [ ] **Step 2: Register in `postgres/index.ts`**

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/database/migrations/postgres/
git commit -m "feat(db): postgres migration for unique chatflow name and deployed backfill"
```

### Task 4: Migration — mysql

**Files:**

-   Create: `packages/server/src/database/migrations/mysql/1788000000000-UniqueChatFlowNamePerWorkspace.ts`
-   Modify: `packages/server/src/database/migrations/mysql/index.ts`

-   [ ] **Step 1: Create migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE chat_flow cf
              JOIN (
                  SELECT id,
                         ROW_NUMBER() OVER (PARTITION BY workspaceId, name ORDER BY createdDate) - 1 AS dup_rank
                    FROM chat_flow
              ) ranked ON ranked.id = cf.id
               SET cf.name = CONCAT(cf.name, ' (', ranked.dup_rank, ')')
             WHERE ranked.dup_rank > 0;
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, workspaceId);`)
        await queryRunner.query(`UPDATE chat_flow SET deployed = 1 WHERE deployed IS NULL OR deployed = 0;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX idx_chat_flow_name_workspace ON chat_flow;`)
    }
}
```

-   [ ] **Step 2: Register in `mysql/index.ts`**

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/database/migrations/mysql/
git commit -m "feat(db): mysql migration for unique chatflow name and deployed backfill"
```

### Task 5: Migration — mariadb

**Files:**

-   Create: `packages/server/src/database/migrations/mariadb/1788000000000-UniqueChatFlowNamePerWorkspace.ts`
-   Modify: `packages/server/src/database/migrations/mariadb/index.ts`

-   [ ] **Step 1: Create migration**

Identical SQL to the mysql version (mariadb supports `ROW_NUMBER()` window functions since 10.2):

```ts
import { MigrationInterface, QueryRunner } from 'typeorm'

export class UniqueChatFlowNamePerWorkspace1788000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE chat_flow cf
              JOIN (
                  SELECT id,
                         ROW_NUMBER() OVER (PARTITION BY workspaceId, name ORDER BY createdDate) - 1 AS dup_rank
                    FROM chat_flow
              ) ranked ON ranked.id = cf.id
               SET cf.name = CONCAT(cf.name, ' (', ranked.dup_rank, ')')
             WHERE ranked.dup_rank > 0;
        `)
        await queryRunner.query(`CREATE UNIQUE INDEX idx_chat_flow_name_workspace ON chat_flow(name, workspaceId);`)
        await queryRunner.query(`UPDATE chat_flow SET deployed = 1 WHERE deployed IS NULL OR deployed = 0;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX idx_chat_flow_name_workspace ON chat_flow;`)
    }
}
```

-   [ ] **Step 2: Register in `mariadb/index.ts`**

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/database/migrations/mariadb/
git commit -m "feat(db): mariadb migration for unique chatflow name and deployed backfill"
```

---

## Phase 2 — Resolver utility (TDD)

### Task 6: Tests for `parseChatflowReference`

**Files:**

-   Create: `packages/server/src/utils/resolveChatflowReference.test.ts`

-   [ ] **Step 1: Write the failing tests for the parser**

```ts
import { parseChatflowReference } from './resolveChatflowReference'

describe('parseChatflowReference', () => {
    it('parses a UUID', () => {
        const ref = parseChatflowReference('3f8a1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d')
        expect(ref).toEqual({ kind: 'uuid', id: '3f8a1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d' })
    })

    it('parses a plain name', () => {
        const ref = parseChatflowReference('Avl_Agent')
        expect(ref).toEqual({ kind: 'name', name: 'Avl_Agent' })
    })

    it('parses name@tag', () => {
        const ref = parseChatflowReference('Avl_Agent@v2.2.1')
        expect(ref).toEqual({ kind: 'nameTag', name: 'Avl_Agent', tag: 'v2.2.1' })
    })

    it('parses name@production', () => {
        const ref = parseChatflowReference('Avl_Agent@production')
        expect(ref).toEqual({ kind: 'nameTag', name: 'Avl_Agent', tag: 'production' })
    })

    it('rejects empty string', () => {
        expect(() => parseChatflowReference('')).toThrow(/invalid/i)
    })

    it('rejects empty name (e.g. @tag)', () => {
        expect(() => parseChatflowReference('@v1')).toThrow(/invalid/i)
    })

    it('rejects empty tag (e.g. name@)', () => {
        expect(() => parseChatflowReference('Avl_Agent@')).toThrow(/invalid/i)
    })

    it('rejects multiple @ separators', () => {
        expect(() => parseChatflowReference('a@b@c')).toThrow(/invalid/i)
    })
})
```

-   [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && pnpm jest src/utils/resolveChatflowReference.test.ts
```

Expected: FAIL — `Cannot find module './resolveChatflowReference'`

### Task 7: Implement `parseChatflowReference`

**Files:**

-   Create: `packages/server/src/utils/resolveChatflowReference.ts`

-   [ ] **Step 1: Write the parser**

```ts
import { StatusCodes } from 'http-status-codes'
import { ChatFlow } from '../database/entities/ChatFlow'
import { FlowHistory } from '../database/entities/FlowHistory'
import { FlowVersionTag } from '../database/entities/FlowVersionTag'
import { InternalFlowiseError } from '../errors/internalFlowiseError'
import { resolveEffectiveFlowData } from './resolveEffectiveFlowData'
import { getRunningExpressApp } from './getRunningExpressApp'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ChatflowReference =
    | { kind: 'uuid'; id: string }
    | { kind: 'name'; name: string }
    | { kind: 'nameTag'; name: string; tag: string }

export function parseChatflowReference(input: string): ChatflowReference {
    if (!input) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid chatflow reference: empty')
    }
    if (UUID_REGEX.test(input)) {
        return { kind: 'uuid', id: input }
    }
    const atCount = (input.match(/@/g) || []).length
    if (atCount > 1) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid chatflow reference: '${input}' has multiple '@' separators`)
    }
    if (atCount === 1) {
        const [name, tag] = input.split('@')
        if (!name || !tag) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid chatflow reference: '${input}'`)
        }
        return { kind: 'nameTag', name, tag }
    }
    return { kind: 'name', name: input }
}
```

-   [ ] **Step 2: Run tests to verify pass**

```bash
cd packages/server && pnpm jest src/utils/resolveChatflowReference.test.ts -t parseChatflowReference
```

Expected: PASS — all 8 parser tests green.

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/utils/resolveChatflowReference.ts packages/server/src/utils/resolveChatflowReference.test.ts
git commit -m "feat(server): parseChatflowReference for uuid/name/name@tag"
```

### Task 8: Tests for `resolveChatflowReference` lookup behavior

**Files:**

-   Modify: `packages/server/src/utils/resolveChatflowReference.test.ts`

-   [ ] **Step 1: Append integration-style tests with mocked repositories**

```ts
import { resolveChatflowReference } from './resolveChatflowReference'

jest.mock('./getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))
jest.mock('./resolveEffectiveFlowData', () => ({ resolveEffectiveFlowData: jest.fn() }))

const mockApp = (repos: Record<string, any>) => {
    const { getRunningExpressApp } = require('./getRunningExpressApp')
    getRunningExpressApp.mockReturnValue({
        AppDataSource: {
            getRepository: (entity: any) => repos[entity.name] ?? { findOne: jest.fn(), findOneBy: jest.fn() }
        }
    })
}

describe('resolveChatflowReference', () => {
    afterEach(() => jest.clearAllMocks())

    it('resolves a uuid', async () => {
        const chatflow = { id: 'cf-1', flowData: 'LIVE', publishedVersion: null }
        mockApp({
            ChatFlow: { findOneBy: jest.fn().mockResolvedValue(chatflow) }
        })
        const { resolveEffectiveFlowData } = require('./resolveEffectiveFlowData')
        resolveEffectiveFlowData.mockResolvedValue('LIVE')

        const out = await resolveChatflowReference('3f8a1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d', 'ws-1')
        expect(out.chatflow).toBe(chatflow)
        expect(out.effectiveFlowData).toBe('LIVE')
    })

    it('resolves a name', async () => {
        const chatflow = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', publishedVersion: null, workspaceId: 'ws-1' }
        mockApp({
            ChatFlow: { findOneBy: jest.fn().mockResolvedValue(chatflow) }
        })
        const { resolveEffectiveFlowData } = require('./resolveEffectiveFlowData')
        resolveEffectiveFlowData.mockResolvedValue('LIVE')

        const out = await resolveChatflowReference('Avl_Agent', 'ws-1')
        expect(out.chatflow).toBe(chatflow)
        expect(out.effectiveFlowData).toBe('LIVE')
    })

    it('resolves name@tag and clears publishedVersion in memory', async () => {
        const chatflow: any = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', publishedVersion: 5, workspaceId: 'ws-1' }
        const tag = { historyId: 'hist-1' }
        const history = { snapshotData: JSON.stringify({ flowData: 'TAGGED' }) }
        mockApp({
            ChatFlow: { findOneBy: jest.fn().mockResolvedValue(chatflow) },
            FlowVersionTag: { findOneBy: jest.fn().mockResolvedValue(tag) },
            FlowHistory: { findOneBy: jest.fn().mockResolvedValue(history) }
        })

        const out = await resolveChatflowReference('Avl_Agent@v2.2.1', 'ws-1')
        expect(out.effectiveFlowData).toBe('TAGGED')
        expect(out.chatflow.flowData).toBe('TAGGED')
        expect(out.chatflow.publishedVersion).toBeNull()
    })

    it('throws 404 when chatflow name not found', async () => {
        mockApp({ ChatFlow: { findOneBy: jest.fn().mockResolvedValue(null) } })
        await expect(resolveChatflowReference('Nope', 'ws-1')).rejects.toThrow(/not found/i)
    })

    it('throws 404 when tag not found', async () => {
        const chatflow = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', workspaceId: 'ws-1' }
        mockApp({
            ChatFlow: { findOneBy: jest.fn().mockResolvedValue(chatflow) },
            FlowVersionTag: { findOneBy: jest.fn().mockResolvedValue(null) }
        })
        await expect(resolveChatflowReference('Avl_Agent@v9.9.9', 'ws-1')).rejects.toThrow(/tag/i)
    })

    it('throws 500 when tag exists but snapshot is missing', async () => {
        const chatflow = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', workspaceId: 'ws-1' }
        const tag = { historyId: 'hist-orphan' }
        mockApp({
            ChatFlow: { findOneBy: jest.fn().mockResolvedValue(chatflow) },
            FlowVersionTag: { findOneBy: jest.fn().mockResolvedValue(tag) },
            FlowHistory: { findOneBy: jest.fn().mockResolvedValue(null) }
        })
        await expect(resolveChatflowReference('Avl_Agent@v2.2.1', 'ws-1')).rejects.toThrow(/missing snapshot/i)
    })
})
```

-   [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/server && pnpm jest src/utils/resolveChatflowReference.test.ts -t resolveChatflowReference
```

Expected: FAIL — `resolveChatflowReference is not a function`.

### Task 9: Implement `resolveChatflowReference`

**Files:**

-   Modify: `packages/server/src/utils/resolveChatflowReference.ts`

-   [ ] **Step 1: Append the implementation**

```ts
export async function resolveChatflowReference(
    input: string,
    workspaceId: string
): Promise<{ chatflow: ChatFlow; effectiveFlowData: string }> {
    const ref = parseChatflowReference(input)
    const dataSource = getRunningExpressApp().AppDataSource
    const chatflowRepo = dataSource.getRepository(ChatFlow)

    const chatflow =
        ref.kind === 'uuid' ? await chatflowRepo.findOneBy({ id: ref.id }) : await chatflowRepo.findOneBy({ name: ref.name, workspaceId })

    if (!chatflow) {
        const identifier = ref.kind === 'uuid' ? ref.id : ref.name
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow '${identifier}' not found`)
    }

    if (ref.kind === 'nameTag') {
        const tagRepo = dataSource.getRepository(FlowVersionTag)
        const tag = await tagRepo.findOneBy({
            entityType: 'CHATFLOW',
            entityId: chatflow.id,
            tagName: ref.tag,
            workspaceId
        })
        if (!tag) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Tag '${ref.tag}' not found on chatflow '${ref.name}'`)
        }
        const historyRepo = dataSource.getRepository(FlowHistory)
        const snapshot = await historyRepo.findOneBy({ id: tag.historyId })
        if (!snapshot) {
            throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Tag '${ref.tag}' references a missing snapshot`)
        }
        const parsed = JSON.parse(snapshot.snapshotData)
        const effectiveFlowData = parsed.flowData ?? chatflow.flowData
        chatflow.flowData = effectiveFlowData
        chatflow.publishedVersion = null // prevent downstream resolveEffectiveFlowData from overriding our tag choice
        return { chatflow, effectiveFlowData }
    }

    const effectiveFlowData = (await resolveEffectiveFlowData('CHATFLOW', chatflow)) ?? chatflow.flowData
    chatflow.flowData = effectiveFlowData
    return { chatflow, effectiveFlowData }
}
```

-   [ ] **Step 2: Run tests to verify pass**

```bash
cd packages/server && pnpm jest src/utils/resolveChatflowReference.test.ts
```

Expected: PASS — all parser + resolver tests green.

-   [ ] **Step 3: Commit**

```bash
git add packages/server/src/utils/resolveChatflowReference.ts packages/server/src/utils/resolveChatflowReference.test.ts
git commit -m "feat(server): resolveChatflowReference with name@tag support"
```

---

## Phase 3 — Wire resolver into prediction controller

### Task 10: Replace `getChatflowById` with `resolveChatflowReference` and add active-gate

**Files:**

-   Modify: `packages/server/src/controllers/predictions/index.ts:30`

-   [ ] **Step 1: Edit the controller**

Replace lines 28-33 in `packages/server/src/controllers/predictions/index.ts`:

Old:

```ts
const workspaceId = req.user?.activeWorkspaceId

const chatflow = await chatflowsService.getChatflowById(req.params.id, workspaceId)
if (!chatflow) {
    throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${req.params.id} not found`)
}
```

New:

```ts
const workspaceId = req.user?.activeWorkspaceId

const { chatflow } = await resolveChatflowReference(req.params.id, workspaceId)
if (chatflow.deployed === false) {
    throw new InternalFlowiseError(StatusCodes.FORBIDDEN, `Chatflow is deactivated`)
}
```

Also add the import at the top:

```ts
import { resolveChatflowReference } from '../../utils/resolveChatflowReference'
```

-   [ ] **Step 2: Adjust `req.params.id` references downstream**

Search for `req.params.id` later in the same function (around line 57). The streaming check `chatflowsService.checkIfChatflowIsValidForStreaming(req.params.id)` still uses the raw input — change it to use the resolved chatflow's id:

Old:

```ts
const streamable = await chatflowsService.checkIfChatflowIsValidForStreaming(req.params.id)
```

New:

```ts
const streamable = await chatflowsService.checkIfChatflowIsValidForStreaming(chatflow.id)
```

-   [ ] **Step 3: Adjust `req.params.id` so `buildChatflow` finds the chatflow**

`predictionsServices.buildChatflow(req)` calls `utilBuildChatflow` which reads `req.params.id` and re-fetches the chatflow by id. To avoid a second name-resolution round-trip, set `req.params.id = chatflow.id` immediately after resolution.

After the active-gate check, add:

```ts
req.params.id = chatflow.id
```

-   [ ] **Step 4: Manual smoke test (defer to integration phase)**

A full smoke test happens in Task 18. For now, verify the file compiles:

```bash
cd packages/server && pnpm tsc --noEmit
```

Expected: no errors.

-   [ ] **Step 5: Commit**

```bash
git add packages/server/src/controllers/predictions/index.ts
git commit -m "feat(server): resolve chatflow by uuid/name/name@tag and gate on deployed"
```

---

## Phase 4 — Tag service: `production` uniqueness + tag-name validation

### Task 11: Tests for `production` promotion

**Files:**

-   Modify: `packages/server/src/services/flow-tags/index.test.ts`

-   [ ] **Step 1: Read existing test file to find test patterns**

```bash
cat packages/server/src/services/flow-tags/index.test.ts
```

Use the same mocking approach (`jest.mock('../../utils/getRunningExpressApp')`).

-   [ ] **Step 2: Append two tests**

```ts
describe('createTag — production promotion', () => {
    it('deletes existing production tag for the same chatflow before inserting new one', async () => {
        const tagRepo = {
            create: jest.fn((x) => x),
            save: jest.fn().mockResolvedValue({ id: 'new-tag' }),
            delete: jest.fn().mockResolvedValue({ affected: 1 })
        }
        const historyRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'hist-2',
                entityType: 'CHATFLOW',
                entityId: 'cf-1',
                workspaceId: 'ws-1'
            })
        }
        const { getRunningExpressApp } = require('../../utils/getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: (e: any) => (e.name === 'FlowVersionTag' ? tagRepo : historyRepo)
            }
        })

        const flowTagsService = require('./').default
        await flowTagsService.createTag({
            historyId: 'hist-2',
            tagName: 'production',
            user: { id: 'u1', name: 'Alice' },
            workspaceId: 'ws-1'
        })

        expect(tagRepo.delete).toHaveBeenCalledWith({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            tagName: 'production',
            workspaceId: 'ws-1'
        })
        expect(tagRepo.save).toHaveBeenCalled()
    })

    it('does NOT delete when creating a non-production tag', async () => {
        const tagRepo = {
            create: jest.fn((x) => x),
            save: jest.fn().mockResolvedValue({ id: 'new-tag' }),
            delete: jest.fn()
        }
        const historyRepo = {
            findOne: jest.fn().mockResolvedValue({
                id: 'hist-3',
                entityType: 'CHATFLOW',
                entityId: 'cf-1',
                workspaceId: 'ws-1'
            })
        }
        const { getRunningExpressApp } = require('../../utils/getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: (e: any) => (e.name === 'FlowVersionTag' ? tagRepo : historyRepo)
            }
        })

        const flowTagsService = require('./').default
        await flowTagsService.createTag({
            historyId: 'hist-3',
            tagName: 'v2.2.1',
            user: { id: 'u1', name: 'Alice' },
            workspaceId: 'ws-1'
        })

        expect(tagRepo.delete).not.toHaveBeenCalled()
    })

    it('rejects invalid tag names', async () => {
        const flowTagsService = require('./').default
        await expect(
            flowTagsService.createTag({
                historyId: 'hist-3',
                tagName: 'has spaces',
                user: { id: 'u1', name: 'Alice' },
                workspaceId: 'ws-1'
            })
        ).rejects.toThrow(/invalid tag name/i)
    })
})
```

-   [ ] **Step 3: Run tests to verify they fail**

```bash
cd packages/server && pnpm jest src/services/flow-tags/index.test.ts -t "production promotion"
```

Expected: FAIL — `delete` not called / validation absent.

### Task 12: Implement `production` promotion + validation

**Files:**

-   Modify: `packages/server/src/services/flow-tags/index.ts`

-   [ ] **Step 1: Add constant and validator**

At the top of the file, after imports:

```ts
const PRODUCTION_TAG_NAME = 'production'
const TAG_NAME_REGEX = /^[A-Za-z0-9._:-]{1,100}$/
```

-   [ ] **Step 2: Update `createTag`**

```ts
const createTag = async ({ historyId, tagName, description, user, workspaceId }: CreateTagOptions): Promise<FlowVersionTag> => {
    if (!TAG_NAME_REGEX.test(tagName)) {
        throw new InternalFlowiseError(
            StatusCodes.BAD_REQUEST,
            `Invalid tag name '${tagName}'. Allowed: alphanumeric, '.', '_', '-', ':' (max 100 chars).`
        )
    }

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

    if (tagName === PRODUCTION_TAG_NAME) {
        // Per-chatflow uniqueness: tagging a new snapshot as 'production' promotes it,
        // automatically untagging the previous production version.
        await tagRepo.delete({
            entityType: snapshot.entityType,
            entityId: snapshot.entityId,
            tagName: PRODUCTION_TAG_NAME,
            workspaceId
        })
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
```

-   [ ] **Step 3: Run tests to verify pass**

```bash
cd packages/server && pnpm jest src/services/flow-tags/index.test.ts
```

Expected: PASS — including pre-existing tests.

-   [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/flow-tags/
git commit -m "feat(flow-tags): production promotion semantics and tag-name validation"
```

---

## Phase 5 — Chatflow service: friendly 409 on duplicate name

### Task 13: Translate name-collision DB error to 409

**Files:**

-   Modify: `packages/server/src/services/chatflows/index.ts`

-   [ ] **Step 1: Find the create and update functions**

```bash
grep -n "saveChatflow\|updateChatflow\|createChatflow" packages/server/src/services/chatflows/index.ts | head
```

-   [ ] **Step 2: Wrap the save calls with collision detection**

Inside `saveChatflow` and `updateChatflow`, wrap the `repo.save(...)` call:

```ts
try {
    const dbResponse = await chatFlowRepository.save(chatflow)
    // ... existing post-save logic
    return dbResponse
} catch (error: any) {
    if (
        error?.code === 'SQLITE_CONSTRAINT' ||
        error?.code === '23505' /* postgres */ ||
        error?.code === 'ER_DUP_ENTRY' /* mysql/mariadb */
    ) {
        if (String(error?.message || '').includes('idx_chat_flow_name_workspace')) {
            throw new InternalFlowiseError(StatusCodes.CONFLICT, `A chatflow named '${chatflow.name}' already exists in this workspace.`)
        }
    }
    throw error
}
```

-   [ ] **Step 3: Compile-check**

```bash
cd packages/server && pnpm tsc --noEmit
```

Expected: no errors.

-   [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/chatflows/index.ts
git commit -m "feat(chatflows): return 409 on duplicate name within workspace"
```

---

## Phase 6 — UI: Active toggle + status indicators

### Task 14: Default new chatflows to `deployed: true`

**Files:**

-   Modify: `packages/ui/src/views/canvas/index.jsx:233`
-   Modify: `packages/ui/src/views/agentflowsv2/Canvas.jsx:228`

-   [ ] **Step 1: Change `deployed: false` → `deployed: true` in both files**

Both files have a payload object during chatflow creation. Update both occurrences.

-   [ ] **Step 2: Commit**

```bash
git add packages/ui/src/views/canvas/index.jsx packages/ui/src/views/agentflowsv2/Canvas.jsx
git commit -m "feat(ui): default new chatflows to active"
```

### Task 15: Active/Inactive switch in canvas header

**Files:**

-   Modify: `packages/ui/src/views/canvas/CanvasHeader.jsx`

-   [ ] **Step 1: Read current header to find the publish button cluster**

```bash
sed -n '550,620p' packages/ui/src/views/canvas/CanvasHeader.jsx
```

-   [ ] **Step 2: Import `Switch` and `Tooltip` if missing, then add toggle handler**

Inside the component body, near the existing `handlePublish` definition, add:

```jsx
const isActive = chatflow?.deployed !== false // null/undefined treated as active for legacy rows

const handleToggleActive = async () => {
    const target = !isActive
    try {
        await chatflowsApi.updateChatflow(chatflow.id, { deployed: target })
        await reloadChatflow() // existing helper at CanvasHeader.jsx:307
        enqueueSnackbar({
            message: target ? 'Chatflow activated — accepting requests' : 'Chatflow deactivated — requests will be rejected',
            options: {
                key: new Date().getTime() + Math.random(),
                variant: target ? 'success' : 'warning'
            }
        })
    } catch (error) {
        enqueueSnackbar({
            message: `Failed to toggle active state: ${error?.response?.data?.message || error.message}`,
            options: {
                key: new Date().getTime() + Math.random(),
                variant: 'error'
            }
        })
    }
}
```

-   [ ] **Step 3: Render the switch in the header JSX**

Place it left of the existing publish chip (around line 596):

```jsx
<Tooltip title={isActive ? 'Deactivate (will reject API requests with 403)' : 'Activate (start accepting API requests)'}>
    <FormControlLabel
        control={<Switch checked={isActive} onChange={handleToggleActive} size='small' />}
        label={isActive ? 'Active' : 'Inactive'}
        sx={{ mr: 1 }}
    />
</Tooltip>
```

Add the missing imports:

```jsx
import { Switch, FormControlLabel, Tooltip } from '@mui/material'
```

-   [ ] **Step 4: Add the inactive banner**

At the top of the canvas header's render output:

```jsx
{
    !isActive && (
        <Box
            sx={{
                bgcolor: theme.palette.warning.light,
                color: theme.palette.warning.contrastText,
                px: 2,
                py: 1,
                textAlign: 'center',
                fontSize: '0.875rem'
            }}
        >
            ⏸ This chatflow is deactivated. It will not respond to API requests.
        </Box>
    )
}
```

-   [ ] **Step 5: Manual UI verification**

Start the dev server:

```bash
pnpm dev
```

Open a chatflow in the canvas. Verify:

-   Switch labelled "Active" appears.
-   Toggling it off shows the banner immediately and a warning snackbar.
-   Toggling it back on hides the banner.

-   [ ] **Step 6: Commit**

```bash
git add packages/ui/src/views/canvas/CanvasHeader.jsx
git commit -m "feat(ui): active/inactive switch and warning banner in canvas header"
```

### Task 16: Status dot on chatflow list cards

**Files:**

-   Modify: `packages/ui/src/ui-component/cards/ItemCard.jsx`

-   [ ] **Step 1: Identify the title row in the card**

```bash
grep -n "Typography\|name" packages/ui/src/ui-component/cards/ItemCard.jsx | head -20
```

-   [ ] **Step 2: Render a small dot + label next to the chatflow name**

Inside the card title row:

```jsx
{
    typeof data.deployed !== 'undefined' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
            <Box
                sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: data.deployed === false ? 'grey.400' : 'success.main'
                }}
            />
            <Typography variant='caption' sx={{ color: data.deployed === false ? 'text.disabled' : 'success.main' }}>
                {data.deployed === false ? 'Inactive' : 'Active'}
            </Typography>
        </Box>
    )
}
```

(Adjust to existing layout — wrap in the appropriate container if the card uses a flexbox row.)

-   [ ] **Step 3: Manual UI verification**

In the chatflows list, verify:

-   Active chatflows show a green dot + "Active" label.
-   The chatflow toggled off in Task 15 shows a grey dot + "Inactive" label.

-   [ ] **Step 4: Commit**

```bash
git add packages/ui/src/ui-component/cards/ItemCard.jsx
git commit -m "feat(ui): active/inactive status dot on chatflow list cards"
```

---

## Phase 7 — Smoke test the full integration

### Task 17: Manual end-to-end verification

This task has no commits — it is a checklist to run before declaring success.

-   [ ] **Step 1: Start the server**

```bash
pnpm dev
```

-   [ ] **Step 2: Backward compat — UUID URL still works**

```bash
curl -X POST http://localhost:3000/api/v1/prediction/<existing-uuid> \
     -H "Content-Type: application/json" \
     -d '{"question": "hello"}'
```

Expected: same response as before this branch.

-   [ ] **Step 3: Name-based URL works**

```bash
curl -X POST http://localhost:3000/api/v1/prediction/<existing-name> \
     -H "Content-Type: application/json" \
     -d '{"question": "hello"}'
```

Expected: identical response.

-   [ ] **Step 4: Tag-based URL works**

In the UI, snapshot the current version and tag it as `v1.0.0`. Then:

```bash
curl -X POST "http://localhost:3000/api/v1/prediction/<name>@v1.0.0" \
     -H "Content-Type: application/json" \
     -d '{"question": "hello"}'
```

Expected: identical response.

-   [ ] **Step 5: Production promotion works**

In the UI, tag version A as `production`. Then tag version B as `production`. Verify version A's `production` tag is gone and `<name>@production` resolves to version B.

-   [ ] **Step 6: Active gate works**

Toggle the chatflow off in the UI. Then:

```bash
curl -X POST "http://localhost:3000/api/v1/prediction/<name>" \
     -H "Content-Type: application/json" \
     -d '{"question": "hello"}'
```

Expected: HTTP 403 with body containing "deactivated".

Toggle back on, verify the request succeeds.

-   [ ] **Step 7: Duplicate-name returns 409**

Try to rename a chatflow to match another existing chatflow's name in the same workspace.

Expected: 409 with message about name already existing.

---

## Phase 8 — Final review and merge

### Task 18: Pre-merge cleanup

-   [ ] **Step 1: Run all server tests**

```bash
cd packages/server && pnpm test
```

Expected: all green.

-   [ ] **Step 2: Run typecheck across the monorepo**

```bash
pnpm -r typecheck 2>/dev/null || pnpm -r tsc --noEmit
```

Expected: no errors.

-   [ ] **Step 3: Run any existing lint**

```bash
pnpm -r lint 2>/dev/null || true
```

Expected: clean (or no lint configured).

-   [ ] **Step 4: Confirm all commits are on the feature branch**

```bash
git log --oneline main..HEAD
```

Expected: a clean linear history of the tasks above.

-   [ ] **Step 5: Hand off to user for review**

Stop here. Do not push or open a PR until the user authorizes.
