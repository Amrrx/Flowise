import { JWT } from 'google-auth-library'
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { ChatResult, ChatGenerationChunk } from '@langchain/core/outputs'
import { BaseMessage } from '@langchain/core/messages'
import { GoogleGenerativeAIChatInput } from '@langchain/google-genai'
import { ChatGoogleGenerativeAI } from './FlowiseChatGoogleGenerativeAI'

const SA_SCOPES = ['https://www.googleapis.com/auth/generative-language.retriever', 'https://www.googleapis.com/auth/cloud-platform']

// The langchain wrapper rejects an empty apiKey. Send a non-empty placeholder;
// the Authorization header set per-call wins over the ?key= query param at the API gateway.
const PLACEHOLDER_API_KEY = ' '

interface ParsedServiceAccount {
    clientEmail: string
    privateKey: string
    projectId: string
}

export function parseServiceAccountJSON(raw: string): ParsedServiceAccount {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Service account JSON is empty')
    }
    let parsed: any
    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        throw new Error(`Service account JSON parse failed: ${(err as Error).message}`)
    }
    const missing: string[] = []
    if (!parsed?.client_email) missing.push('client_email')
    if (!parsed?.private_key) missing.push('private_key')
    if (!parsed?.project_id) missing.push('project_id')
    if (missing.length) {
        throw new Error(`Service account JSON is missing required field(s): ${missing.join(', ')}`)
    }
    return {
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
        projectId: parsed.project_id
    }
}

export class ChatGoogleGenerativeAIServiceAccount extends ChatGoogleGenerativeAI {
    private jwtClient: JWT
    private projectId: string

    constructor(id: string, fields: GoogleGenerativeAIChatInput, saJson: string) {
        const sa = parseServiceAccountJSON(saJson)
        super(id, { ...fields, apiKey: PLACEHOLDER_API_KEY })
        this.jwtClient = new JWT({
            email: sa.clientEmail,
            key: sa.privateKey,
            scopes: SA_SCOPES
        })
        this.projectId = sa.projectId
    }

    private async refreshAuthHeaders(): Promise<void> {
        const tokenResp = await this.jwtClient.getAccessToken()
        const token = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token
        if (!token) {
            throw new Error('Failed to mint Google access token from service account: empty token returned')
        }
        const sdkClient: any = (this as any).client
        if (!sdkClient) {
            throw new Error('Underlying Google Generative AI SDK client is not initialized')
        }
        if (!sdkClient._requestOptions) sdkClient._requestOptions = {}
        sdkClient._requestOptions.customHeaders = {
            Authorization: `Bearer ${token}`,
            'x-goog-user-project': this.projectId
        }
    }

    async _generate(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {
        await this.refreshAuthHeaders()
        return super._generate(messages, options, runManager)
    }

    async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this['ParsedCallOptions'],
        runManager?: CallbackManagerForLLMRun
    ): AsyncGenerator<ChatGenerationChunk> {
        await this.refreshAuthHeaders()
        yield* super._streamResponseChunks(messages, options, runManager)
    }
}
