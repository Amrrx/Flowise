import chatflowsService from './index'

// Mock typeorm decorators before any entity import
jest.mock(
    'typeorm',
    () => ({
        Entity: () => (_target: any) => _target,
        Column: () => () => {},
        CreateDateColumn: () => () => {},
        UpdateDateColumn: () => () => {},
        PrimaryGeneratedColumn: () => () => {},
        PrimaryColumn: () => () => {},
        Index: () => (_target: any) => _target,
        Unique: () => (_target: any) => _target,
        ManyToOne: () => () => {},
        OneToMany: () => () => {},
        ManyToMany: () => () => {},
        OneToOne: () => () => {},
        JoinColumn: () => () => {},
        JoinTable: () => () => {},
        Brackets: class {},
        In: jest.fn(),
        BeforeInsert: () => () => {},
        BeforeUpdate: () => () => {}
    }),
    { virtual: true }
)

jest.mock(
    'flowise-components',
    () => ({
        removeFolderFromStorage: jest.fn(),
        extractResponseContent: jest.fn(),
        ICommonObject: {}
    }),
    { virtual: true }
)

jest.mock('../../utils/getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))
jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() }
}))

describe('chatflowsService.publish / unpublish', () => {
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
                getRepository: (entity: any) => {
                    const name = entity?.name ?? entity
                    return String(name).includes('FlowHistory') ? historyRepo : chatflowRepo
                }
            }
        })
    })

    it('publishes the explicit version when provided', async () => {
        await chatflowsService.publish('cf-1', 3, 'ws-1')
        expect(chatflowRepo.update).toHaveBeenCalledWith('cf-1', { publishedVersion: 3 })
    })

    it('defaults to currentHistoryVersion when version omitted', async () => {
        historyRepo.findOne.mockResolvedValue({ version: 5 })
        await chatflowsService.publish('cf-1', undefined, 'ws-1')
        expect(chatflowRepo.update).toHaveBeenCalledWith('cf-1', { publishedVersion: 5 })
    })

    it('rejects non-existent version', async () => {
        historyRepo.findOne.mockResolvedValue(null)
        await expect(chatflowsService.publish('cf-1', 99, 'ws-1')).rejects.toThrow(/version/i)
    })

    it('rejects when chatflow not found', async () => {
        chatflowRepo.findOne.mockResolvedValue(null)
        await expect(chatflowsService.publish('cf-missing', 1, 'ws-1')).rejects.toThrow(/not found/i)
    })

    it('rejects on workspace mismatch', async () => {
        chatflowRepo.findOne.mockResolvedValue({ id: 'cf-1', workspaceId: 'other-ws', currentHistoryVersion: 5 })
        await expect(chatflowsService.publish('cf-1', 3, 'ws-1')).rejects.toThrow(/workspace/i)
    })

    it('rejects when no version to publish (null currentHistoryVersion, no explicit version)', async () => {
        chatflowRepo.findOne.mockResolvedValue({ id: 'cf-1', workspaceId: 'ws-1', currentHistoryVersion: null })
        await expect(chatflowsService.publish('cf-1', undefined, 'ws-1')).rejects.toThrow(/no version/i)
    })

    it('unpublish clears the pointer', async () => {
        await chatflowsService.unpublish('cf-1', 'ws-1')
        expect(chatflowRepo.update).toHaveBeenCalledWith('cf-1', { publishedVersion: null })
    })

    it('unpublish rejects workspace mismatch', async () => {
        chatflowRepo.findOne.mockResolvedValue({ id: 'cf-1', workspaceId: 'other-ws', currentHistoryVersion: 5 })
        await expect(chatflowsService.unpublish('cf-1', 'ws-1')).rejects.toThrow(/workspace/i)
    })
})
