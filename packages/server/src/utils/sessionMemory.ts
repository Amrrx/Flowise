import crypto from 'crypto'
import { DataSource } from 'typeorm'
import { IUsedTool, ICommonObject, summarizeText, SummarizerConfig, IServerSideEventStreamer } from 'flowise-components'
import { ChatMessage } from '../database/entities/ChatMessage'
import { utilAddChatMessage } from './addChatMesage'
import logger from './logger'
import { getErrorMessage } from '../errors/utils'

/**
 * Session Context Memory (SCM) — selective, durable tool-result retention across turns.
 *
 * Why this exists: AgentFlow rebuilds conversation history from the ChatMessage table,
 * mapping only `userMessage`/`apiMessage` rows; tool results live in the per-run scratchpad
 * and die at turn end, so agents re-call read-only tools (e.g. schema lookups) every turn.
 *
 * This module persists whitelisted tool results as extra `toolMessage` rows whose `content`
 * is a flattened observation ("[memory] Tool X returned: ..."). On load they map to plain
 * assistant messages (never a raw `tool` role → never orphans a tool_call), and they are
 * filtered out of the UI history. `role` is a free string at the DB level, so no migration
 * is needed; per-row metadata rides the existing `action` JSON column.
 *
 * Policy (which tools persist, dedup mode, TTL) is supplied by the caller via
 * `overrideConfig.vars.memoryPolicy` — i.e. owned by the upstream gateway, not hardcoded here.
 */

export const SCM_ROLE = 'toolMessage'
export const SCM_SUMMARY_ROLE = 'summaryMessage'

export interface ToolRetention {
    dedup?: 'replace' | 'accumulate'
    ttl_s?: number
    summarize?: boolean // compress the persisted copy via the summarizer model (#6)
    summarize_over_chars?: number // only summarize when the raw output exceeds this (default 2000)
}

export interface CompactionPolicy {
    threshold_tokens?: number // run full compaction once estimated context >= this
}

export interface MicroCompactionPolicy {
    keep_n?: number // max retained rows fed to context (newest first); 0/undefined = no cap
    max_age_s?: number // drop retained rows older than this; 0/undefined = no age limit
}

export interface MemoryPolicy {
    persistentTools?: Record<string, ToolRetention>
    micro?: MicroCompactionPolicy
    summarizer?: SummarizerConfig
    compaction?: CompactionPolicy
}

interface ScmMeta {
    block_type: 'retained'
    tool: string
    dedup_key: string
    expires_at: number | null
}

interface RetainBase {
    chatflowid: string
    chatId: string
    sessionId?: string
    chatType: string
    executionId?: string
}

/** Read the retention policy off the prediction's overrideConfig (empty when unset).
 *  Top-level key is canonical (Flowise strips object values from overrideConfig.vars);
 *  vars + JSON-string forms are accepted as fallbacks. */
export const getMemoryPolicy = (overrideConfig: any): MemoryPolicy => {
    let raw = overrideConfig?.memoryPolicy ?? overrideConfig?.vars?.memoryPolicy
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw)
        } catch {
            return {}
        }
    }
    return raw && typeof raw === 'object' ? (raw as MemoryPolicy) : {}
}

const dedupKey = (tool: string, toolInput: unknown): string => {
    const hash = crypto
        .createHash('sha1')
        .update(JSON.stringify(toolInput ?? null))
        .digest('hex')
        .slice(0, 12)
    return `${tool}:${hash}`
}

const flattenBody = (tool: string, output: unknown): string => {
    const text = typeof output === 'string' ? output : JSON.stringify(output)
    return `[memory] Tool \`${tool}\` previously returned:\n${text}`
}

const readMeta = (row: ChatMessage): ScmMeta | null => {
    if ((row.role as string) !== SCM_ROLE || !row.action) return null
    try {
        return (JSON.parse(row.action)?.scm as ScmMeta) ?? null
    } catch {
        return null
    }
}

/** True for a retained row whose TTL has elapsed — dropped at history load. */
export const isExpiredRetained = (row: ChatMessage): boolean => {
    const meta = readMeta(row)
    return !!meta?.expires_at && meta.expires_at < Date.now()
}

/** True for rows the UI should render (real turns) — excludes retained/summary rows. */
export const isConversationRole = (role: string): boolean => role !== SCM_ROLE && role !== SCM_SUMMARY_ROLE

const isRetained = (row: ChatMessage): boolean => (row.role as string) === SCM_ROLE

export interface ContextBreakdown {
    total: number
    byCategory: { user: number; assistant: number; retained: number; summary: number }
}

/** Cheap, dependency-free token estimate (~4 chars/token). Good enough for thresholds + observability. */
export const estimateTokens = (text: string | undefined | null): number => (text ? Math.ceil(text.length / 4) : 0)

/** Per-category token tally over the rows fed to the LLM — drives the compaction trigger and logging. */
export const accountContext = (messages: ChatMessage[]): ContextBreakdown => {
    const byCategory = { user: 0, assistant: 0, retained: 0, summary: 0 }
    for (const m of messages) {
        const t = estimateTokens(m.content)
        const role = m.role as string
        if (role === 'userMessage') byCategory.user += t
        else if (role === SCM_ROLE) byCategory.retained += t
        else if (role === SCM_SUMMARY_ROLE) byCategory.summary += t
        else byCategory.assistant += t
    }
    const total = byCategory.user + byCategory.assistant + byCategory.retained + byCategory.summary
    return { total, byCategory }
}

/**
 * Filter the raw session rows into what the LLM should see (history load).
 *
 * Conversation rows pass through untouched. Retained rows are pruned:
 *   - expired (TTL elapsed) are dropped;
 *   - micro-compaction caps the survivors by recency (`keep_n`) and age (`max_age_s`).
 *
 * Note: our retained blocks are flattened (no separable call/body), so micro-compaction
 * DROPS stale rows rather than blanking a body — a blanked flattened block carries no value.
 */
export const filterSessionMemory = (messages: ChatMessage[], policy: MemoryPolicy): ChatMessage[] => {
    const micro = policy?.micro ?? {}
    const now = Date.now()
    const maxAgeMs = micro.max_age_s && micro.max_age_s > 0 ? micro.max_age_s * 1000 : 0

    // Rank live retained rows newest-first; mark the ones to drop (beyond keep_n / too old / expired).
    const liveRetained = messages
        .filter((m) => isRetained(m) && !isExpiredRetained(m))
        .filter((m) => !maxAgeMs || now - new Date(m.createdDate).getTime() <= maxAgeMs)
        .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())

    const keep = micro.keep_n && micro.keep_n > 0 ? liveRetained.slice(0, micro.keep_n) : liveRetained
    const keepIds = new Set(keep.map((m) => m.id))

    // Compaction boundary: keep only the LATEST summary row; conversation rows that predate it
    // are represented by that summary (boundary-not-delete — the UI still shows the full history).
    // Retained rows survive the boundary by design — they are the restore layer.
    const latestSummary = messages
        .filter((m) => (m.role as string) === SCM_SUMMARY_ROLE)
        .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime())[0]
    const boundaryMs = latestSummary ? new Date(latestSummary.createdDate).getTime() : 0

    return messages.filter((m) => {
        const role = m.role as string
        if (role === SCM_SUMMARY_ROLE) return !!latestSummary && m.id === latestSummary.id
        if (role === SCM_ROLE) return keepIds.has(m.id)
        return !boundaryMs || new Date(m.createdDate).getTime() >= boundaryMs
    })
}

/**
 * Persist whitelisted tool results as durable, UI-hidden conversation blocks.
 * dedup='replace' (default) keeps only the latest copy per (session, tool, args).
 */
export const writeRetainedToolResults = async (
    appDataSource: DataSource,
    policy: MemoryPolicy,
    usedTools: IUsedTool[] | undefined,
    base: RetainBase,
    options: ICommonObject
): Promise<void> => {
    const persistent = policy?.persistentTools
    if (!persistent || !usedTools?.length) return
    const repo = appDataSource.getRepository(ChatMessage)

    for (const ut of usedTools) {
        if (!ut?.tool || ut.error) continue // never retain a failed call
        const rule = persistent[ut.tool]
        if (!rule) continue

        const key = dedupKey(ut.tool, ut.toolInput)

        if ((rule.dedup ?? 'replace') === 'replace') {
            const rows = await repo.find({
                where: { chatflowid: base.chatflowid, sessionId: base.sessionId, role: SCM_ROLE as any }
            })
            const stale = rows.filter((r) => readMeta(r)?.dedup_key === key)
            if (stale.length) await repo.remove(stale)
        }

        const rawText = typeof ut.toolOutput === 'string' ? ut.toolOutput : JSON.stringify(ut.toolOutput)
        const overChars = rule.summarize_over_chars ?? 2000
        const willSummarize = !!(rule.summarize && policy.summarizer && rawText.length > overChars)

        const ttl = rule.ttl_s ?? 0
        const meta: ScmMeta = {
            block_type: 'retained',
            tool: ut.tool,
            dedup_key: key,
            expires_at: ttl > 0 ? Date.now() + ttl * 1000 : null
        }

        // Write the RAW copy synchronously so the turn completes immediately. The agent already
        // saw the full raw output in-turn; this persisted copy is only for FUTURE turns.
        const saved = await utilAddChatMessage(
            {
                role: SCM_ROLE as any,
                content: flattenBody(ut.tool, rawText),
                chatflowid: base.chatflowid,
                chatType: base.chatType,
                chatId: base.chatId,
                sessionId: base.sessionId,
                executionId: base.executionId,
                action: JSON.stringify({ scm: meta })
            },
            appDataSource
        )

        // #6 Ingest summarization — OFF the critical path. Shrink the persisted copy in a detached
        // promise and UPDATE the row in place, so the turn never blocks on the summarizer call.
        // Next turn reads raw if this hasn't landed yet, the summary if it has — both valid.
        // Failure leaves the raw row untouched.
        if (willSummarize && policy.summarizer) {
            const instruction = policy.summarizer.toolInstruction || DEFAULT_TOOL_INSTRUCTION
            const summarizer = policy.summarizer
            const toolName = ut.tool
            void summarizeText(instruction, rawText, summarizer, options)
                .then((summary) => {
                    if (!summary || !saved?.id) return undefined
                    return repo.update(saved.id, {
                        content: flattenBody(toolName, summary),
                        action: JSON.stringify({ scm: { ...meta, summarized: true } })
                    })
                })
                .catch((e) => logger.warn(`[server]: [session-memory] background summarize skipped: ${getErrorMessage(e)}`))
        }
    }
}

// Built-in fallbacks — used when mosaad relays no prompt text for a job.
const DEFAULT_TOOL_INSTRUCTION =
    'Summarize this tool result concisely. Preserve every fact, id, number, name, and structural detail an assistant would need to answer follow-ups without re-running the tool.'

const NINE_SECTION_INSTRUCTION = `You are compacting a conversation to free context while preserving continuity.
This summary REPLACES the raw conversation, so be faithful and specific. Produce these sections:
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and Fixes
5. Problem Solving
6. All User Messages (list every user message verbatim-ish, excluding tool results)
7. Pending Tasks
8. Current Work
9. Optional Next Step`

/**
 * #7 Full conversation compaction (boundary-not-delete).
 *
 * When the estimated context crosses `compaction.threshold_tokens`, summarize the
 * post-boundary conversation into a structured running summary and write it as a
 * `summaryMessage` row. `filterSessionMemory` then feeds only [latest summary +
 * post-boundary turns + retained rows]; the raw rows stay in the DB (UI unaffected).
 * No-op when unconfigured, under threshold, or if the summarizer returns nothing.
 *
 * Runs pre-turn (before history is assembled), so the current turn benefits immediately.
 */
export const maybeCompactConversation = async (
    appDataSource: DataSource,
    policy: MemoryPolicy,
    base: RetainBase,
    options: ICommonObject,
    sseStreamer?: IServerSideEventStreamer
): Promise<void> => {
    const threshold = policy?.compaction?.threshold_tokens
    if (!threshold || threshold <= 0 || !policy.summarizer) return

    const repo = appDataSource.getRepository(ChatMessage)
    const all = await repo.find({
        where: { chatflowid: base.chatflowid, sessionId: base.sessionId },
        order: { createdDate: 'ASC' }
    })

    const fed = filterSessionMemory(all, policy)
    if (accountContext(fed).total < threshold) return

    const convo = fed.filter((m) => {
        const r = m.role as string
        return r === 'userMessage' || r === 'apiMessage'
    })
    if (!convo.length) return

    const priorSummary = fed.find((m) => (m.role as string) === SCM_SUMMARY_ROLE)
    const transcript = convo.map((m) => `${(m.role as string) === 'userMessage' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')
    const body = (priorSummary ? `Previous summary:\n${priorSummary.content}\n\n---\n\n` : '') + transcript

    const instruction = policy.summarizer.compactInstruction || NINE_SECTION_INSTRUCTION
    // Indicator (#7): we are committed to compacting — signal the client before the blocking summarizer call.
    sseStreamer?.streamCustomEvent(base.chatId, 'compaction', { phase: 'start' })
    const summary = await summarizeText(instruction, body, policy.summarizer, options)
    if (!summary) {
        // graceful: failed/empty summarizer → skip compaction this turn, clear the indicator (no divider)
        sseStreamer?.streamCustomEvent(base.chatId, 'compaction', { phase: 'done', ok: false })
        return
    }

    await utilAddChatMessage(
        {
            role: SCM_SUMMARY_ROLE as any,
            content: summary,
            chatflowid: base.chatflowid,
            chatType: base.chatType,
            chatId: base.chatId,
            sessionId: base.sessionId,
            executionId: base.executionId,
            action: JSON.stringify({ scm: { block_type: 'summary' } })
        },
        appDataSource
    )
    // Compaction committed — clear the indicator and drop the persistent "Compacted" divider.
    sseStreamer?.streamCustomEvent(base.chatId, 'compaction', { phase: 'done', ok: true })
}
