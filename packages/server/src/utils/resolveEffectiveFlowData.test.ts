import { resolveEffectiveFlowData } from './resolveEffectiveFlowData'

jest.mock('./getRunningExpressApp', () => ({ getRunningExpressApp: jest.fn() }))

describe('resolveEffectiveFlowData', () => {
    const setupRepo = (findOneResult: any) => {
        const { getRunningExpressApp } = require('./getRunningExpressApp')
        getRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: () => ({ findOne: jest.fn().mockResolvedValue(findOneResult) })
            }
        })
    }

    it('returns entity.flowData when publishedVersion is null', async () => {
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: null }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })

    it('returns entity.flowData when publishedVersion is undefined', async () => {
        const entity: any = { id: 'cf-1', flowData: 'LIVE' }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })

    it('returns snapshot flowData when publishedVersion is set', async () => {
        setupRepo({ snapshotData: JSON.stringify({ flowData: 'PUBLISHED' }) })
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: 3 }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('PUBLISHED')
    })

    it('falls back to entity.flowData when snapshot not found', async () => {
        setupRepo(null)
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: 99 }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })

    it('falls back to entity.flowData when snapshot JSON is malformed', async () => {
        setupRepo({ snapshotData: '{ not-json' })
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: 3 }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })

    it('falls back to entity.flowData when parsed snapshot has no flowData key', async () => {
        setupRepo({ snapshotData: JSON.stringify({ name: 'x' }) })
        const entity: any = { id: 'cf-1', flowData: 'LIVE', publishedVersion: 3 }
        const result = await resolveEffectiveFlowData('CHATFLOW', entity)
        expect(result).toBe('LIVE')
    })

    it('works with ASSISTANT entity type', async () => {
        setupRepo({ snapshotData: JSON.stringify({ flowData: 'ASSIST-PUB' }) })
        const entity: any = { id: 'a-1', flowData: 'ASSIST-LIVE', publishedVersion: 2 }
        const result = await resolveEffectiveFlowData('ASSISTANT', entity)
        expect(result).toBe('ASSIST-PUB')
    })
})
