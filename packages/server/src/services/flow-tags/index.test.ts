import flowTagsService from './index'

// Mock typeorm decorators before any entity import
jest.mock(
    'typeorm',
    () => ({
        Entity: () => (_target: any) => _target,
        Column: () => () => {},
        CreateDateColumn: () => () => {},
        UpdateDateColumn: () => () => {},
        PrimaryGeneratedColumn: () => () => {},
        Index: () => (_target: any) => _target
    }),
    { virtual: true }
)

jest.mock('../../utils/getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))
jest.mock('../../utils/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() }
}))

describe('flowTagsService', () => {
    let tagRepo: any
    let historyRepo: any

    beforeEach(() => {
        tagRepo = {
            save: jest.fn(async (r: any) => ({ ...r, id: 'tag-1' })),
            create: jest.fn((r: any) => r),
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
                getRepository: (entity: any) => {
                    const name = entity?.name ?? entity
                    return String(name).includes('FlowVersionTag') ? tagRepo : historyRepo
                }
            }
        })
    })

    it('createTag derives entityType and entityId from history row', async () => {
        const result = await flowTagsService.createTag({
            historyId: 'hist-1',
            tagName: 'release-1',
            description: 'first release',
            user: { id: 'u-42', name: 'Alice' },
            workspaceId: 'ws-1'
        })
        expect(tagRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({
                entityType: 'CHATFLOW',
                entityId: 'cf-1',
                historyId: 'hist-1',
                tagName: 'release-1',
                description: 'first release',
                createdById: 'u-42',
                createdByName: 'Alice',
                workspaceId: 'ws-1'
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
                user: { id: 'u', name: 'U' },
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
                user: { id: 'u', name: 'U' },
                workspaceId: 'ws-1'
            })
        ).rejects.toThrow(/workspace/i)
    })

    it('listTags filters by entityType, entityId, workspaceId and returns desc by date', async () => {
        tagRepo.find.mockResolvedValue([{ id: 'tag-1' }, { id: 'tag-2' }])
        const result = await flowTagsService.listTags({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            workspaceId: 'ws-1'
        })
        expect(tagRepo.find).toHaveBeenCalledWith({
            where: { entityType: 'CHATFLOW', entityId: 'cf-1', workspaceId: 'ws-1' },
            order: { createdDate: 'DESC' }
        })
        expect(result).toHaveLength(2)
    })

    it('deleteTag removes by id after workspace check', async () => {
        tagRepo.findOne.mockResolvedValue({ id: 'tag-1', workspaceId: 'ws-1' })
        await flowTagsService.deleteTag('tag-1', 'ws-1')
        expect(tagRepo.delete).toHaveBeenCalledWith('tag-1')
    })

    it('deleteTag rejects missing tag', async () => {
        tagRepo.findOne.mockResolvedValue(null)
        await expect(flowTagsService.deleteTag('missing', 'ws-1')).rejects.toThrow(/not found/i)
    })

    it('deleteTag rejects workspace mismatch', async () => {
        tagRepo.findOne.mockResolvedValue({ id: 'tag-1', workspaceId: 'other-ws' })
        await expect(flowTagsService.deleteTag('tag-1', 'ws-1')).rejects.toThrow(/workspace/i)
    })
})
