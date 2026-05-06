import { parseChatflowReference, resolveChatflowReference } from './resolveChatflowReference'

jest.mock('./getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))
jest.mock('./resolveEffectiveFlowData', () => ({ resolveEffectiveFlowData: jest.fn() }))

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
            ChatFlow: { findBy: jest.fn().mockResolvedValue([chatflow]) }
        })
        const { resolveEffectiveFlowData } = require('./resolveEffectiveFlowData')
        resolveEffectiveFlowData.mockResolvedValue('LIVE')

        const out = await resolveChatflowReference('Avl_Agent', 'ws-1')
        expect(out.chatflow).toBe(chatflow)
        expect(out.effectiveFlowData).toBe('LIVE')
    })

    it('throws 409 when name is ambiguous across workspaces', async () => {
        const a = { id: 'cf-1', name: 'Shared', workspaceId: 'ws-1' }
        const b = { id: 'cf-2', name: 'Shared', workspaceId: 'ws-2' }
        mockApp({
            ChatFlow: { findBy: jest.fn().mockResolvedValue([a, b]) }
        })
        await expect(resolveChatflowReference('Shared', 'ws-1')).rejects.toThrow(/ambiguous/i)
    })

    it('throws 403 when chatflow is deactivated, before tag lookup', async () => {
        const chatflow = { id: 'cf-1', name: 'Tee', flowData: 'LIVE', deployed: false, workspaceId: 'ws-1' }
        const tagRepo = { findOneBy: jest.fn() }
        mockApp({
            ChatFlow: { findBy: jest.fn().mockResolvedValue([chatflow]), findOneBy: jest.fn().mockResolvedValue(chatflow) },
            FlowVersionTag: tagRepo
        })
        await expect(resolveChatflowReference('Tee@nonexistent', 'ws-1')).rejects.toThrow(/deactivated/i)
        expect(tagRepo.findOneBy).not.toHaveBeenCalled()
    })

    it('resolves name@tag and clears publishedVersion in memory', async () => {
        const chatflow: any = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', publishedVersion: 5, workspaceId: 'ws-1' }
        const tag = { historyId: 'hist-1' }
        const history = { snapshotData: JSON.stringify({ flowData: 'TAGGED' }) }
        mockApp({
            ChatFlow: { findBy: jest.fn().mockResolvedValue([chatflow]) },
            FlowVersionTag: { findOneBy: jest.fn().mockResolvedValue(tag) },
            FlowHistory: { findOneBy: jest.fn().mockResolvedValue(history) }
        })

        const out = await resolveChatflowReference('Avl_Agent@v2.2.1', 'ws-1')
        expect(out.effectiveFlowData).toBe('TAGGED')
        expect(out.chatflow.flowData).toBe('TAGGED')
        expect(out.chatflow.publishedVersion).toBeNull()
    })

    it('throws 404 when chatflow name not found', async () => {
        mockApp({ ChatFlow: { findBy: jest.fn().mockResolvedValue([]) } })
        await expect(resolveChatflowReference('Nope', 'ws-1')).rejects.toThrow(/not found/i)
    })

    it('throws 404 when tag not found', async () => {
        const chatflow = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', workspaceId: 'ws-1' }
        mockApp({
            ChatFlow: { findBy: jest.fn().mockResolvedValue([chatflow]) },
            FlowVersionTag: { findOneBy: jest.fn().mockResolvedValue(null) }
        })
        await expect(resolveChatflowReference('Avl_Agent@v9.9.9', 'ws-1')).rejects.toThrow(/tag/i)
    })

    it('throws 500 when tag exists but snapshot is missing', async () => {
        const chatflow = { id: 'cf-1', name: 'Avl_Agent', flowData: 'LIVE', workspaceId: 'ws-1' }
        const tag = { historyId: 'hist-orphan' }
        mockApp({
            ChatFlow: { findBy: jest.fn().mockResolvedValue([chatflow]) },
            FlowVersionTag: { findOneBy: jest.fn().mockResolvedValue(tag) },
            FlowHistory: { findOneBy: jest.fn().mockResolvedValue(null) }
        })
        await expect(resolveChatflowReference('Avl_Agent@v2.2.1', 'ws-1')).rejects.toThrow(/missing snapshot/i)
    })
})
