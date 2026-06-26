import { ICommonObject } from './Interface'
import { getCredentialData } from './utils'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatMistralAI } from '@langchain/mistralai'
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai'
import { ChatGroq } from '@langchain/groq'
import { Ollama } from 'ollama'

/**
 * Session-memory summarizer — a small/secondary LLM used to compress content.
 *
 * Two callers (both in the server's sessionMemory module):
 *   - ingest summarization (#6): compress a long tool result's PERSISTED copy;
 *   - full conversation compaction (#7): produce the structured running summary.
 *
 * Mirrors `followUpPrompts.ts`: build a model from a provider + Flowise credentialId
 * (the secret stays in the Flowise vault — only the id reference travels via policy),
 * then invoke for free text. Returns '' on any failure so callers degrade gracefully.
 */

export interface SummarizerConfig {
    provider?: string // 'openai' | 'anthropic' | 'azure' | 'google' | 'mistral' | 'groq' | 'ollama'
    model?: string
    credentialId?: string
    temperature?: number
    baseUrl?: string // ollama
    toolInstruction?: string // #6 instruction text (relayed from mosaad prompts/); '' → built-in default
    compactInstruction?: string // #7 instruction text (relayed from mosaad prompts/); '' → built-in default
}

const extractText = (content: unknown): string => {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content.map((part: any) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
    }
    return content ? JSON.stringify(content) : ''
}

/**
 * Summarize `text` under `instruction` using the configured small model.
 * Returns '' when unconfigured or on error (caller keeps the raw content).
 */
export const summarizeText = async (
    instruction: string,
    text: string,
    config: SummarizerConfig | undefined,
    options: ICommonObject
): Promise<string> => {
    if (!config || !config.provider || !config.model) return ''
    const prompt = `${instruction}\n\n---\n${text}\n---`
    const temperature = config.temperature != null ? parseFloat(`${config.temperature}`) : 0
    try {
        const cred = config.credentialId ? await getCredentialData(config.credentialId, options) : ({} as ICommonObject)
        switch ((config.provider || '').toLowerCase()) {
            case 'anthropic': {
                const llm = new ChatAnthropic({ apiKey: cred.anthropicApiKey, model: config.model, temperature })
                return extractText((await llm.invoke(prompt)).content)
            }
            case 'openai': {
                const llm = new ChatOpenAI({ apiKey: cred.openAIApiKey, model: config.model, temperature })
                return extractText((await llm.invoke(prompt)).content)
            }
            case 'azure': {
                const llm = new AzureChatOpenAI({
                    azureOpenAIApiKey: cred['azureOpenAIApiKey'],
                    azureOpenAIApiInstanceName: cred['azureOpenAIApiInstanceName'],
                    azureOpenAIApiDeploymentName: cred['azureOpenAIApiDeploymentName'],
                    azureOpenAIApiVersion: cred['azureOpenAIApiVersion'],
                    model: config.model,
                    temperature
                })
                return extractText((await llm.invoke(prompt)).content)
            }
            case 'google': {
                const llm = new ChatGoogleGenerativeAI({ apiKey: cred.googleGenerativeAPIKey, model: config.model, temperature })
                return extractText((await llm.invoke(prompt)).content)
            }
            case 'mistral': {
                const llm = new ChatMistralAI({ apiKey: cred.mistralAIAPIKey, model: config.model, temperature })
                return extractText((await llm.invoke(prompt)).content)
            }
            case 'groq': {
                const llm = new ChatGroq({ apiKey: cred.groqApiKey, model: config.model, temperature })
                return extractText((await llm.invoke(prompt)).content)
            }
            case 'ollama': {
                const client = new Ollama({ host: config.baseUrl || 'http://127.0.0.1:11434' })
                const res = await client.chat({
                    model: config.model,
                    messages: [{ role: 'user', content: prompt }],
                    options: { temperature }
                })
                return res.message?.content ?? ''
            }
            default:
                return ''
        }
    } catch (e) {
        console.error('[session-memory] summarizer failed:', e)
        return ''
    }
}
