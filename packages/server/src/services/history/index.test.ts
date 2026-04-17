import historyService from './index'

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

describe('historyService.createSnapshot', () => {
    let saveMock: jest.Mock
    let findOneMock: jest.Mock
    let updateMock: jest.Mock
    let createMock: jest.Mock

    beforeEach(() => {
        saveMock = jest.fn(async (row: any) => ({ ...row, id: 'hist-1', createdDate: new Date() }))
        findOneMock = jest.fn().mockResolvedValue(null)
        updateMock = jest.fn().mockResolvedValue({})
        createMock = jest.fn((x: any) => x)

        const { getRunningExpressApp } = require('../../utils/getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: () => ({
                    save: saveMock,
                    findOne: findOneMock,
                    update: updateMock,
                    create: createMock,
                    find: jest.fn().mockResolvedValue([]),
                    delete: jest.fn().mockResolvedValue({})
                })
            }
        })
    })

    it('persists authorId, authorName, and commitMessage when provided', async () => {
        await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            entityData: { id: 'cf-1', flowData: '{}' },
            changeDescription: 'saved by user',
            workspaceId: 'ws-1',
            author: { id: 'u-42', name: 'Alice' },
            commitMessage: 'fixed greeting'
        })

        expect(saveMock).toHaveBeenCalledWith(
            expect.objectContaining({ authorId: 'u-42', authorName: 'Alice', commitMessage: 'fixed greeting' })
        )
    })

    it('accepts snapshot without author and commitMessage (nullable)', async () => {
        await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            entityData: { id: 'cf-1', flowData: '{}' },
            workspaceId: 'ws-1'
        })

        const call = saveMock.mock.calls[0][0]
        expect(call.authorId).toBeUndefined()
        expect(call.authorName).toBeUndefined()
        expect(call.commitMessage).toBeUndefined()
    })

    it('keeps changeDescription independent from commitMessage', async () => {
        await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: 'cf-1',
            entityData: { id: 'cf-1', flowData: '{}' },
            changeDescription: 'system-generated',
            workspaceId: 'ws-1'
        })

        expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ changeDescription: 'system-generated' }))
    })
})
