import { ICommonObject, removeFolderFromStorage } from 'flowise-components'
import { StatusCodes } from 'http-status-codes'
import { Brackets, DataSource, In } from 'typeorm'
import { validate as isValidUUID } from 'uuid'
import { ChatflowType, IReactFlowObject } from '../../Interface'
import { FLOWISE_COUNTER_STATUS, FLOWISE_METRIC_COUNTERS } from '../../Interface.Metrics'
import { UsageCacheManager } from '../../UsageCacheManager'
import { ChatFlow, EnumChatflowType } from '../../database/entities/ChatFlow'
import { ChatMessage } from '../../database/entities/ChatMessage'
import { ChatMessageFeedback } from '../../database/entities/ChatMessageFeedback'
import { FlowHistory } from '../../database/entities/FlowHistory'
import { FlowVersionTag } from '../../database/entities/FlowVersionTag'
import { UpsertHistory } from '../../database/entities/UpsertHistory'
import { Workspace } from '../../enterprise/database/entities/workspace.entity'
import { getWorkspaceSearchOptions } from '../../enterprise/utils/ControllerServiceUtils'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import documentStoreService from '../../services/documentstore'
import { constructGraphs, getAppVersion, getEndingNodes, getTelemetryFlowObj, isFlowValidForStream } from '../../utils'
import { sanitizeAllowedUploadMimeTypesFromConfig } from '../../utils/fileValidation'
import { containsBase64File, updateFlowDataWithFilePaths } from '../../utils/fileRepository'
import { sanitizeFlowDataForPublicEndpoint } from '../../utils/sanitizeFlowData'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { utilGetUploadsConfig } from '../../utils/getUploadsConfig'
import logger from '../../utils/logger'
import { updateStorageUsage } from '../../utils/quotaUsage'
import historyService from '../history'

interface SnapshotOptions {
    author?: { id: string; name: string }
    commitMessage?: string
}

export const enum ChatflowErrorMessage {
    INVALID_CHATFLOW_TYPE = 'Invalid Chatflow Type',
    INVALID_CHATFLOW_ID = 'Invalid Chatflow ID'
}

export function validateChatflowType(type: ChatflowType | undefined) {
    if (!Object.values(EnumChatflowType).includes(type as EnumChatflowType))
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, ChatflowErrorMessage.INVALID_CHATFLOW_TYPE)
}

const isChatflowNameWorkspaceUniqueViolation = (error: any): boolean => {
    const code = error?.code
    const message = String(error?.message || '')
    const isUniqueViolation = code === 'SQLITE_CONSTRAINT' || code === '23505' /* postgres */ || code === 'ER_DUP_ENTRY' /* mysql/mariadb */
    if (!isUniqueViolation) return false
    // Postgres/MySQL/MariaDB include the index name; SQLite's message format is
    // "UNIQUE constraint failed: chat_flow.name, chat_flow.workspaceId" — so we
    // also accept the column-pair fingerprint to cover sqlite.
    return (
        message.includes('idx_chat_flow_name_workspace') ||
        (message.includes('chat_flow.name') && message.includes('chat_flow.workspaceId'))
    )
}

// Check if chatflow valid for streaming
const checkIfChatflowIsValidForStreaming = async (chatflowId: string): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        //**
        const chatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({
            id: chatflowId
        })
        if (!chatflow) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found`)
        }

        /* Check for post-processing settings, if available isStreamValid is always false */
        let chatflowConfig: ICommonObject = {}
        if (chatflow.chatbotConfig) {
            chatflowConfig = JSON.parse(chatflow.chatbotConfig)
            if (chatflowConfig?.postProcessing?.enabled === true) {
                return { isStreaming: false }
            }
        }

        if (chatflow.type === 'AGENTFLOW') {
            return { isStreaming: true }
        }

        /*** Get Ending Node with Directed Graph  ***/
        const flowData = chatflow.flowData
        const parsedFlowData: IReactFlowObject = JSON.parse(flowData)
        const nodes = parsedFlowData.nodes
        const edges = parsedFlowData.edges
        const { graph, nodeDependencies } = constructGraphs(nodes, edges)

        const endingNodes = getEndingNodes(nodeDependencies, graph, nodes)

        let isStreaming = false
        for (const endingNode of endingNodes) {
            const endingNodeData = endingNode.data
            const isEndingNode = endingNodeData?.outputs?.output === 'EndingNode'
            // Once custom function ending node exists, flow is always unavailable to stream
            if (isEndingNode) {
                return { isStreaming: false }
            }
            isStreaming = isFlowValidForStream(nodes, endingNodeData)
        }

        // If it is a Multi/Sequential Agents, always enable streaming
        if (endingNodes.filter((node) => node.data.category === 'Multi Agents' || node.data.category === 'Sequential Agents').length > 0) {
            return { isStreaming: true }
        }

        const dbResponse = { isStreaming: isStreaming }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.checkIfChatflowIsValidForStreaming - ${getErrorMessage(error)}`
        )
    }
}

// Check if chatflow valid for uploads
const checkIfChatflowIsValidForUploads = async (chatflowId: string): Promise<any> => {
    try {
        const dbResponse = await utilGetUploadsConfig(chatflowId)
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.checkIfChatflowIsValidForUploads - ${getErrorMessage(error)}`
        )
    }
}

const deleteChatflow = async (chatflowId: string, orgId: string, workspaceId: string): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()

        await getChatflowById(chatflowId, workspaceId)

        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).delete({ id: chatflowId })

        // Update document store usage
        await documentStoreService.updateDocumentStoreUsage(chatflowId, undefined, workspaceId)

        // Delete all chat messages
        await appServer.AppDataSource.getRepository(ChatMessage).delete({ chatflowid: chatflowId })

        // Delete all chat feedback
        await appServer.AppDataSource.getRepository(ChatMessageFeedback).delete({ chatflowid: chatflowId })

        // Delete all upsert history
        await appServer.AppDataSource.getRepository(UpsertHistory).delete({ chatflowid: chatflowId })

        try {
            // Delete all uploads corresponding to this chatflow
            const { totalSize } = await removeFolderFromStorage(orgId, chatflowId)
            await updateStorageUsage(orgId, workspaceId, totalSize, appServer.usageCacheManager)
        } catch (e) {
            logger.error(`[server]: Error deleting file storage for chatflow ${chatflowId}`)
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.deleteChatflow - ${getErrorMessage(error)}`
        )
    }
}

type EnrichedChatflow = ChatFlow & { latestAuthor: string | null; tags: string[] }

const enrichChatflowsWithVersionMetadata = async (chatflows: ChatFlow[], dataSource: DataSource) => {
    if (!chatflows.length) return
    const ids = chatflows.map((c) => c.id)
    const versioned = chatflows.filter((c) => c.currentHistoryVersion != null)

    const authorByChatflow = new Map<string, string>()
    if (versioned.length) {
        const historyQuery = dataSource.getRepository(FlowHistory).createQueryBuilder('h').where('h.entityType = :t', { t: 'CHATFLOW' })
        historyQuery.andWhere(
            new Brackets((bb) => {
                versioned.forEach((c, i) => {
                    bb.orWhere(`(h.entityId = :id${i} AND h.version = :v${i})`, {
                        [`id${i}`]: c.id,
                        [`v${i}`]: c.currentHistoryVersion
                    })
                })
            })
        )
        const latestHistories = await historyQuery.getMany()
        for (const h of latestHistories) {
            if (h.authorName) authorByChatflow.set(h.entityId, h.authorName)
        }
    }

    const tags = await dataSource.getRepository(FlowVersionTag).find({ where: { entityType: 'CHATFLOW', entityId: In(ids) } })
    const tagsByChatflow = new Map<string, string[]>()
    for (const t of tags) {
        const existing = tagsByChatflow.get(t.entityId) ?? []
        existing.push(t.tagName)
        tagsByChatflow.set(t.entityId, existing)
    }

    for (const c of chatflows as EnrichedChatflow[]) {
        c.latestAuthor = authorByChatflow.get(c.id) ?? null
        c.tags = tagsByChatflow.get(c.id) ?? []
    }
}

const getAllChatflows = async (type?: ChatflowType, workspaceId?: string, page: number = -1, limit: number = -1) => {
    try {
        const appServer = getRunningExpressApp()

        const queryBuilder = appServer.AppDataSource.getRepository(ChatFlow)
            .createQueryBuilder('chat_flow')
            .orderBy('chat_flow.updatedDate', 'DESC')

        if (page > 0 && limit > 0) {
            queryBuilder.skip((page - 1) * limit)
            queryBuilder.take(limit)
        }
        if (type === 'MULTIAGENT') {
            queryBuilder.andWhere('chat_flow.type = :type', { type: 'MULTIAGENT' })
        } else if (type === 'AGENTFLOW') {
            queryBuilder.andWhere('chat_flow.type = :type', { type: 'AGENTFLOW' })
        } else if (type === 'ASSISTANT') {
            queryBuilder.andWhere('chat_flow.type = :type', { type: 'ASSISTANT' })
        } else if (type === 'CHATFLOW') {
            // fetch all chatflows that are not agentflow
            queryBuilder.andWhere('chat_flow.type = :type', { type: 'CHATFLOW' })
        }
        if (workspaceId) queryBuilder.andWhere('chat_flow.workspaceId = :workspaceId', { workspaceId })
        const [data, total] = await queryBuilder.getManyAndCount()

        await enrichChatflowsWithVersionMetadata(data, appServer.AppDataSource)

        if (page > 0 && limit > 0) {
            return { data, total }
        } else {
            return data
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.getAllChatflows - ${getErrorMessage(error)}`
        )
    }
}

async function getAllChatflowsCountByOrganization(type: ChatflowType, organizationId: string): Promise<number> {
    try {
        const appServer = getRunningExpressApp()

        const workspaces = await appServer.AppDataSource.getRepository(Workspace).findBy({ organizationId })
        const workspaceIds = workspaces.map((workspace) => workspace.id)
        const chatflowsCount = await appServer.AppDataSource.getRepository(ChatFlow).countBy({
            type,
            workspaceId: In(workspaceIds)
        })

        return chatflowsCount
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.getAllChatflowsCountByOrganization - ${getErrorMessage(error)}`
        )
    }
}

const getAllChatflowsCount = async (type?: ChatflowType, workspaceId?: string): Promise<number> => {
    try {
        const appServer = getRunningExpressApp()
        if (type) {
            const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).countBy({
                type,
                ...getWorkspaceSearchOptions(workspaceId)
            })
            return dbResponse
        }
        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).countBy(getWorkspaceSearchOptions(workspaceId))
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.getAllChatflowsCount - ${getErrorMessage(error)}`
        )
    }
}

const getChatflowByApiKey = async (apiKeyId: string, workspaceId: string, keyonly?: unknown): Promise<any> => {
    try {
        // Here we only get chatflows that are bounded by the apikeyid and chatflows that are not bounded by any apikey
        const appServer = getRunningExpressApp()
        let query = appServer.AppDataSource.getRepository(ChatFlow)
            .createQueryBuilder('cf')
            .where('cf.workspaceId = :workspaceId', { workspaceId })
            .andWhere(
                new Brackets((qb) => {
                    qb.where('cf.apikeyid = :apikeyid', { apikeyid: apiKeyId })
                    if (keyonly === undefined) {
                        qb.orWhere('cf.apikeyid IS NULL').orWhere('cf.apikeyid = ""')
                    }
                })
            )

        const dbResponse = await query.orderBy('cf.name', 'ASC').getMany()
        if (dbResponse.length < 1) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow not found in the database!`)
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.getChatflowByApiKey - ${getErrorMessage(error)}`
        )
    }
}

const getChatflowById = async (chatflowId: string, workspaceId?: string): Promise<any> => {
    try {
        if (!isValidUUID(chatflowId)) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, ChatflowErrorMessage.INVALID_CHATFLOW_ID)
        }
        const appServer = getRunningExpressApp()
        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).findOne({
            where: {
                id: chatflowId,
                ...(workspaceId ? { workspaceId } : {})
            }
        })
        if (!dbResponse) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found in the database!`)
        }
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) {
            throw error
        }
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.getChatflowById - ${getErrorMessage(error)}`
        )
    }
}

const saveChatflow = async (
    newChatFlow: ChatFlow,
    orgId: string,
    workspaceId: string,
    subscriptionId: string,
    usageCacheManager: UsageCacheManager,
    options?: SnapshotOptions
): Promise<any> => {
    try {
        validateChatflowType(newChatFlow.type)
        const appServer = getRunningExpressApp()

        let dbResponse: ChatFlow
        if (containsBase64File(newChatFlow)) {
            // we need a 2-step process, as we need to save the chatflow first and then update the file paths
            // this is because we need the chatflow id to create the file paths

            // step 1 - save with empty flowData
            const incomingFlowData = newChatFlow.flowData
            newChatFlow.flowData = JSON.stringify({})
            const chatflow = appServer.AppDataSource.getRepository(ChatFlow).create(newChatFlow)
            const step1Results = await appServer.AppDataSource.getRepository(ChatFlow).save(chatflow)

            // step 2 - convert base64 to file paths and update the chatflow
            step1Results.flowData = await updateFlowDataWithFilePaths(
                step1Results.id,
                incomingFlowData,
                orgId,
                workspaceId,
                subscriptionId,
                usageCacheManager
            )
            await _checkAndUpdateDocumentStoreUsage(step1Results, newChatFlow.workspaceId)
            dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).save(step1Results)
        } else {
            const chatflow = appServer.AppDataSource.getRepository(ChatFlow).create(newChatFlow)
            dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).save(chatflow)
        }

        const subscriptionDetails = await usageCacheManager.getSubscriptionDataFromCache(subscriptionId)
        const productId = subscriptionDetails?.productId || ''

        await appServer.telemetry.sendTelemetry(
            'chatflow_created',
            {
                version: await getAppVersion(),
                chatflowId: dbResponse.id,
                flowGraph: getTelemetryFlowObj(JSON.parse(dbResponse.flowData)?.nodes, JSON.parse(dbResponse.flowData)?.edges),
                productId,
                subscriptionId
            },
            orgId
        )

        appServer.metricsProvider?.incrementCounter(
            dbResponse?.type === 'MULTIAGENT' ? FLOWISE_METRIC_COUNTERS.AGENTFLOW_CREATED : FLOWISE_METRIC_COUNTERS.CHATFLOW_CREATED,
            { status: FLOWISE_COUNTER_STATUS.SUCCESS }
        )

        // Create initial history snapshot
        const snapshot = await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: dbResponse.id,
            entityData: dbResponse,
            changeDescription: 'Initial creation',
            workspaceId: dbResponse.workspaceId,
            author: options?.author,
            commitMessage: options?.commitMessage
        })
        if (snapshot) {
            // Re-fetch the chatflow to get the updated currentHistoryVersion
            const updatedChatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOne({
                where: { id: dbResponse.id }
            })
            return updatedChatflow || dbResponse
        }

        return dbResponse
    } catch (error: any) {
        if (isChatflowNameWorkspaceUniqueViolation(error)) {
            throw new InternalFlowiseError(StatusCodes.CONFLICT, `A chatflow named '${newChatFlow.name}' already exists in this workspace.`)
        }
        if (error instanceof InternalFlowiseError) {
            throw error
        }
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.saveChatflow - ${getErrorMessage(error)}`
        )
    }
}

const updateChatflow = async (
    chatflow: ChatFlow,
    updateChatFlow: ChatFlow,
    orgId: string,
    workspaceId: string,
    subscriptionId: string,
    options?: SnapshotOptions
): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        if (updateChatFlow.flowData && containsBase64File(updateChatFlow)) {
            updateChatFlow.flowData = await updateFlowDataWithFilePaths(
                chatflow.id,
                updateChatFlow.flowData,
                orgId,
                workspaceId,
                subscriptionId,
                appServer.usageCacheManager
            )
        }
        if (updateChatFlow.type || updateChatFlow.type === '') {
            validateChatflowType(updateChatFlow.type)
        } else {
            updateChatFlow.type = chatflow.type
        }
        if (updateChatFlow.chatbotConfig) {
            try {
                const parsed = JSON.parse(updateChatFlow.chatbotConfig) as ICommonObject
                if (parsed?.fullFileUpload?.allowedUploadFileTypes !== undefined) {
                    const current = parsed.fullFileUpload.allowedUploadFileTypes
                    const sanitized = sanitizeAllowedUploadMimeTypesFromConfig(
                        typeof current === 'string' ? current : String(current ?? '')
                    )
                    parsed.fullFileUpload.allowedUploadFileTypes = sanitized
                    updateChatFlow.chatbotConfig = JSON.stringify(parsed)
                }
            } catch (error) {
                const message = getErrorMessage(error)
                logger.error(`[server]: Invalid chatbotConfig JSON in updateChatflow: ${message}`)
                throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid chatbotConfig: ${message}`)
            }
        }

        const newDbChatflow = appServer.AppDataSource.getRepository(ChatFlow).merge(chatflow, updateChatFlow)
        newDbChatflow.workspaceId = workspaceId
        await _checkAndUpdateDocumentStoreUsage(newDbChatflow, workspaceId)
        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).save(newDbChatflow)

        // Create history snapshot for update
        const snapshot = await historyService.createSnapshot({
            entityType: 'CHATFLOW',
            entityId: dbResponse.id,
            entityData: dbResponse,
            changeDescription: 'Updated',
            workspaceId: dbResponse.workspaceId,
            author: options?.author,
            commitMessage: options?.commitMessage
        })
        if (snapshot) {
            // Re-fetch the chatflow to get the updated currentHistoryVersion
            const updatedChatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOne({
                where: { id: dbResponse.id }
            })
            return updatedChatflow || dbResponse
        }

        return dbResponse
    } catch (error: any) {
        if (isChatflowNameWorkspaceUniqueViolation(error)) {
            const attemptedName = updateChatFlow?.name ?? chatflow?.name
            throw new InternalFlowiseError(StatusCodes.CONFLICT, `A chatflow named '${attemptedName}' already exists in this workspace.`)
        }
        if (error instanceof InternalFlowiseError) {
            throw error
        }
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.updateChatflow - ${getErrorMessage(error)}`
        )
    }
}

// Get specific chatflow via id (PUBLIC endpoint, used when sharing chatbot link)
const getSinglePublicChatflow = async (chatflowId: string): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({
            id: chatflowId
        })
        if (dbResponse && dbResponse.isPublic) {
            return dbResponse
        } else if (dbResponse && !dbResponse.isPublic) {
            throw new InternalFlowiseError(StatusCodes.UNAUTHORIZED, `Unauthorized`)
        }
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found`)
    } catch (error) {
        if (error instanceof InternalFlowiseError && error.statusCode === StatusCodes.UNAUTHORIZED) {
            throw error
        } else {
            throw new InternalFlowiseError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                `Error: chatflowsService.getSinglePublicChatflow - ${getErrorMessage(error)}`
            )
        }
    }
}

// Get specific chatflow chatbotConfig via id (PUBLIC endpoint, used to retrieve config for embedded chat)
// flowData is sanitized before returning — password, file, folder inputs and credential references are stripped
const getSinglePublicChatbotConfig = async (chatflowId: string): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({
            id: chatflowId
        })
        if (!dbResponse) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found`)
        }
        const uploadsConfig = await utilGetUploadsConfig(chatflowId)
        // even if chatbotConfig is not set but uploads are enabled
        // send uploadsConfig to the chatbot
        if (dbResponse.chatbotConfig || uploadsConfig) {
            try {
                const parsedConfig = dbResponse.chatbotConfig ? JSON.parse(dbResponse.chatbotConfig) : {}
                const ttsConfig =
                    typeof dbResponse.textToSpeech === 'string' ? JSON.parse(dbResponse.textToSpeech) : dbResponse.textToSpeech

                let isTTSEnabled = false
                if (ttsConfig) {
                    Object.keys(ttsConfig).forEach((provider) => {
                        if (provider !== 'none' && ttsConfig?.[provider]?.status) {
                            isTTSEnabled = true
                        }
                    })
                }
                delete parsedConfig.allowedOrigins
                delete parsedConfig.allowedOriginsError
                return {
                    ...parsedConfig,
                    uploads: uploadsConfig,
                    flowData: sanitizeFlowDataForPublicEndpoint(dbResponse.flowData),
                    isTTSEnabled
                }
            } catch (e) {
                throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Error parsing Chatbot Config for Chatflow ${chatflowId}`)
            }
        }
        return 'OK'
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.getSinglePublicChatbotConfig - ${getErrorMessage(error)}`
        )
    }
}

const _checkAndUpdateDocumentStoreUsage = async (chatflow: ChatFlow, workspaceId?: string) => {
    const parsedFlowData: IReactFlowObject = JSON.parse(chatflow.flowData)
    const nodes = parsedFlowData.nodes
    // from the nodes array find if there is a node with name == documentStore)
    const node = nodes.length > 0 && nodes.find((node) => node.data.name === 'documentStore')
    if (!node || !node.data || !node.data.inputs || node.data.inputs['selectedStore'] === undefined) {
        await documentStoreService.updateDocumentStoreUsage(chatflow.id, undefined, workspaceId)
    } else {
        await documentStoreService.updateDocumentStoreUsage(chatflow.id, node.data.inputs['selectedStore'], workspaceId)
    }
}

const checkIfChatflowHasChanged = async (chatflowId: string, lastUpdatedDateTime: string): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        //**
        const chatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOneBy({
            id: chatflowId
        })
        if (!chatflow) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found`)
        }
        // parse the lastUpdatedDateTime as a date and
        //check if the updatedDate is the same as the lastUpdatedDateTime
        return { hasChanged: chatflow.updatedDate.toISOString() !== lastUpdatedDateTime }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowsService.checkIfChatflowHasChanged - ${getErrorMessage(error)}`
        )
    }
}

const publish = async (id: string, version: number | undefined, workspaceId: string): Promise<void> => {
    const appServer = getRunningExpressApp()
    const cfRepo = appServer.AppDataSource.getRepository(ChatFlow)
    const historyRepo = appServer.AppDataSource.getRepository(FlowHistory)

    const chatflow = await cfRepo.findOne({ where: { id } })
    if (!chatflow) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${id} not found`)
    }
    if (chatflow.workspaceId !== workspaceId) {
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'Chatflow belongs to a different workspace')
    }

    const targetVersion = version ?? chatflow.currentHistoryVersion
    if (!targetVersion) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'No version available to publish')
    }

    const snapshot = await historyRepo.findOne({
        where: { entityType: 'CHATFLOW', entityId: id, version: targetVersion }
    })
    if (!snapshot) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `History version ${targetVersion} not found`)
    }

    await cfRepo.update(id, { publishedVersion: targetVersion })
}

const unpublish = async (id: string, workspaceId: string): Promise<void> => {
    const appServer = getRunningExpressApp()
    const cfRepo = appServer.AppDataSource.getRepository(ChatFlow)

    const chatflow = await cfRepo.findOne({ where: { id } })
    if (!chatflow) {
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${id} not found`)
    }
    if (chatflow.workspaceId !== workspaceId) {
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'Chatflow belongs to a different workspace')
    }

    await cfRepo.update(id, { publishedVersion: null as unknown as undefined })
}

export default {
    checkIfChatflowIsValidForStreaming,
    checkIfChatflowIsValidForUploads,
    deleteChatflow,
    getAllChatflows,
    getAllChatflowsCount,
    getChatflowByApiKey,
    getChatflowById,
    saveChatflow,
    updateChatflow,
    getSinglePublicChatflow,
    getSinglePublicChatbotConfig,
    checkIfChatflowHasChanged,
    getAllChatflowsCountByOrganization,
    publish,
    unpublish
}
