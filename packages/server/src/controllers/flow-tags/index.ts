import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { EntityType } from '../../Interface'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import flowTagsService from '../../services/flow-tags'

const validateEntityType = (entityType: string): EntityType => {
    const upperType = entityType.toUpperCase()
    if (!['CHATFLOW', 'ASSISTANT'].includes(upperType)) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'entityType must be CHATFLOW or ASSISTANT')
    }
    return upperType as EntityType
}

const createTag = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { historyId } = req.params
        const { tagName, description } = req.body
        if (!tagName) throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'tagName is required')
        if (!req.user) throw new InternalFlowiseError(StatusCodes.UNAUTHORIZED, 'Not authenticated')
        const result = await flowTagsService.createTag({
            historyId,
            tagName,
            description,
            user: { id: req.user.id, name: req.user.name },
            workspaceId: req.user.activeWorkspaceId
        })
        return res.json(result)
    } catch (error) {
        next(error)
    }
}

const listTags = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const entityType = validateEntityType(req.params.entityType)
        const result = await flowTagsService.listTags({
            entityType,
            entityId: req.params.entityId,
            workspaceId: req.user?.activeWorkspaceId ?? ''
        })
        return res.json(result)
    } catch (error) {
        next(error)
    }
}

const deleteTag = async (req: Request, res: Response, next: NextFunction) => {
    try {
        await flowTagsService.deleteTag(req.params.tagId, req.user?.activeWorkspaceId ?? '')
        return res.json({ success: true })
    } catch (error) {
        next(error)
    }
}

export default { createTag, listTags, deleteTag }
