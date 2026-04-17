import express from 'express'
import flowTagsController from '../../controllers/flow-tags'
import { checkAnyPermission } from '../../enterprise/rbac/PermissionCheck'

const router = express.Router()

router.post('/history/:historyId', checkAnyPermission('chatflows:update,assistants:update'), flowTagsController.createTag)
router.get('/entity/:entityType/:entityId', checkAnyPermission('chatflows:view,assistants:view'), flowTagsController.listTags)
router.delete('/:tagId', checkAnyPermission('chatflows:update,assistants:update'), flowTagsController.deleteTag)

export default router
