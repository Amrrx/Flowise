import { JWT } from 'google-auth-library'
import { GoogleGenerativeAIEmbeddingsParams } from '@langchain/google-genai'
import { GoogleGenerativeAIEmbeddingsWithStripNewLines } from './GoogleGenerativeAIEmbedding'
import { parseServiceAccountJSON } from '../../chatmodels/ChatGoogleGenerativeAI/FlowiseChatGoogleGenerativeAIServiceAccount'

const SA_SCOPES = ['https://www.googleapis.com/auth/generative-language.retriever', 'https://www.googleapis.com/auth/cloud-platform']

const PLACEHOLDER_API_KEY = ' '

export type GoogleGenerativeAIEmbeddingsServiceAccountParams = GoogleGenerativeAIEmbeddingsParams & {
    stripNewLines?: boolean
    saJson: string
}

export class GoogleGenerativeAIEmbeddingsServiceAccount extends GoogleGenerativeAIEmbeddingsWithStripNewLines {
    private jwtClient: JWT
    private projectId: string

    constructor(params: GoogleGenerativeAIEmbeddingsServiceAccountParams) {
        const sa = parseServiceAccountJSON(params.saJson)
        const { saJson: _omit, ...rest } = params
        super({ ...rest, apiKey: PLACEHOLDER_API_KEY })
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

    async embedQuery(text: string): Promise<number[]> {
        await this.refreshAuthHeaders()
        return super.embedQuery(text)
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        await this.refreshAuthHeaders()
        return super.embedDocuments(texts)
    }
}
