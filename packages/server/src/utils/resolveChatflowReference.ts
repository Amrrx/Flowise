import { StatusCodes } from 'http-status-codes'
import { ChatFlow } from '../database/entities/ChatFlow'
import { FlowHistory } from '../database/entities/FlowHistory'
import { FlowVersionTag } from '../database/entities/FlowVersionTag'
import { InternalFlowiseError } from '../errors/internalFlowiseError'
import { resolveEffectiveFlowData } from './resolveEffectiveFlowData'
import { getRunningExpressApp } from './getRunningExpressApp'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ChatflowReference =
    | { kind: 'uuid'; id: string }
    | { kind: 'name'; name: string }
    | { kind: 'nameTag'; name: string; tag: string }

export function parseChatflowReference(input: string): ChatflowReference {
    if (!input) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid chatflow reference: empty')
    }
    if (UUID_REGEX.test(input)) {
        return { kind: 'uuid', id: input }
    }
    const atCount = (input.match(/@/g) || []).length
    if (atCount > 1) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid chatflow reference: '${input}' has multiple '@' separators`)
    }
    if (atCount === 1) {
        const [name, tag] = input.split('@')
        if (!name || !tag) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid chatflow reference: '${input}'`)
        }
        return { kind: 'nameTag', name, tag }
    }
    return { kind: 'name', name: input }
}

export async function resolveChatflowReference(
    input: string,
    // Reserved for future use — see TODO(multi-workspace) below. Kept on the
    // signature so callers (predictions controller) don't change when scoping
    // is restored.
    _workspaceId: string
): Promise<{ chatflow: ChatFlow; effectiveFlowData: string }> {
    void _workspaceId
    const ref = parseChatflowReference(input)
    const dataSource = getRunningExpressApp().AppDataSource
    const chatflowRepo = dataSource.getRepository(ChatFlow)

    let chatflow: ChatFlow | null
    if (ref.kind === 'uuid') {
        chatflow = await chatflowRepo.findOneBy({ id: ref.id })
    } else {
        // TODO(multi-workspace): Name lookup ignores `workspaceId` because the
        // prediction route is whitelisted from the API-key middleware (see
        // WHITELIST_URLS in utils/constants.ts) and `req.user` is therefore
        // never populated. The unique index `idx_chat_flow_name_workspace`
        // only enforces uniqueness *within* a workspace, so a name shared
        // across workspaces would be ambiguous. We accept that trade-off for
        // single-workspace operation today and surface a 409 if the
        // ambiguity is ever realized. To restore strict scoping, derive
        // `workspaceId` from the chatflow's bound API key (see Option B/C in
        // docs/superpowers/specs/2026-05-05-chatflow-references-and-active-toggle-design.md).
        const matches = await chatflowRepo.findBy({ name: ref.name })
        if (matches.length > 1) {
            throw new InternalFlowiseError(
                StatusCodes.CONFLICT,
                `Chatflow name '${ref.name}' is ambiguous (${matches.length} matches across workspaces). Use UUID to disambiguate.`
            )
        }
        chatflow = matches[0] ?? null
    }

    if (!chatflow) {
        const identifier = ref.kind === 'uuid' ? ref.id : ref.name
        throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow '${identifier}' not found`)
    }

    // Active gate fires before tag/version resolution so a deactivated chatflow
    // returns a clear 403 regardless of which reference shape was used. The
    // controller also performs this check as a defense-in-depth safety net.
    if (chatflow.deployed === false) {
        throw new InternalFlowiseError(StatusCodes.FORBIDDEN, 'Chatflow is deactivated')
    }

    if (ref.kind === 'nameTag') {
        const historyRepo = dataSource.getRepository(FlowHistory)
        const tagRepo = dataSource.getRepository(FlowVersionTag)

        // 1. Try as a named tag first — user-defined tags win over version shortcuts.
        const tag = await tagRepo.findOneBy({
            entityType: 'CHATFLOW',
            entityId: chatflow.id,
            tagName: ref.tag,
            workspaceId: chatflow.workspaceId
        })

        let snapshot: FlowHistory | null = null
        if (tag) {
            snapshot = await historyRepo.findOneBy({ id: tag.historyId })
            if (!snapshot) {
                throw new InternalFlowiseError(StatusCodes.INTERNAL_SERVER_ERROR, `Tag '${ref.tag}' references a missing snapshot`)
            }
        } else {
            // 2. Numeric-version shortcut: `name@v<digits>` resolves directly to FlowHistory.version
            //    so callers don't need to create a tag for one-off pinning.
            const versionMatch = ref.tag.match(/^v(\d+)$/)
            if (versionMatch) {
                const version = Number(versionMatch[1])
                snapshot = await historyRepo.findOneBy({ entityType: 'CHATFLOW', entityId: chatflow.id, version })
            }
        }

        if (!snapshot) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Tag '${ref.tag}' not found on chatflow '${ref.name}'`)
        }

        const parsed = JSON.parse(snapshot.snapshotData)
        const effectiveFlowData = parsed.flowData ?? chatflow.flowData
        chatflow.flowData = effectiveFlowData
        ;(chatflow as any).publishedVersion = null // prevent downstream resolveEffectiveFlowData from overriding our tag/version choice
        return { chatflow, effectiveFlowData }
    }

    const effectiveFlowData = (await resolveEffectiveFlowData('CHATFLOW', chatflow)) ?? chatflow.flowData
    chatflow.flowData = effectiveFlowData
    return { chatflow, effectiveFlowData }
}
