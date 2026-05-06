import { StatusCodes } from 'http-status-codes'
import { EntityType } from '../../Interface'
import { FlowHistory } from '../../database/entities/FlowHistory'
import { FlowVersionTag } from '../../database/entities/FlowVersionTag'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

const TAG_NAME_REGEX = /^[A-Za-z0-9._:-]{1,100}$/

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
