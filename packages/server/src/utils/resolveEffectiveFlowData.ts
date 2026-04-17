import { EntityType } from '../Interface'
import { FlowHistory } from '../database/entities/FlowHistory'
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
