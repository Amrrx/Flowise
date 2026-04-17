import client from './client'

const createTag = (historyId, tagName, description) => client.post(`/flow-tags/history/${historyId}`, { tagName, description })

const listTags = (entityType, entityId) => client.get(`/flow-tags/entity/${entityType}/${entityId}`)

const deleteTag = (tagId) => client.delete(`/flow-tags/${tagId}`)

export default { createTag, listTags, deleteTag }
