import { OllamaEmbeddings, OllamaEmbeddingsParams } from '@langchain/ollama'
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'

class OllamaEmbedding_Embeddings implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Ollama Embedding'
        this.name = 'ollamaEmbedding'
        this.version = 2.1
        this.type = 'OllamaEmbeddings'
        this.icon = 'Ollama.svg'
        this.category = 'Embeddings'
        this.description = 'Generate embeddings for a given text using open source model on Ollama'
        this.baseClasses = [this.type, ...getBaseClasses(OllamaEmbeddings)]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['ollamaApi'],
            optional: true
        }
        this.inputs = [
            {
                label: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                default: 'http://localhost:11434'
            },
            {
                label: 'Model Name',
                name: 'modelName',
                type: 'string',
                placeholder: 'llama2'
            },
            {
                label: 'Number of GPU',
                name: 'numGpu',
                type: 'number',
                description:
                    'The number of layers to send to the GPU(s). On macOS it defaults to 1 to enable metal support, 0 to disable. Refer to <a target="_blank" href="https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values">docs</a> for more details',
                step: 1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Number of Thread',
                name: 'numThread',
                type: 'number',
                description:
                    'Sets the number of threads to use during computation. By default, Ollama will detect this for optimal performance. It is recommended to set this value to the number of physical CPU cores your system has (as opposed to the logical number of cores). Refer to <a target="_blank" href="https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values">docs</a> for more details',
                step: 1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Use MMap',
                name: 'useMMap',
                type: 'boolean',
                default: true,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Keep Alive',
                name: 'keepAlive',
                type: 'string',
                description: 'How long to keep the model loaded. A duration string (such as "10m" or "24h"). Default: 5m.',
                default: '5m',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Context Window Size',
                name: 'numCtx',
                type: 'number',
                description:
                    'Size of the context window used for the embedding. (Default: 2048). Refer to <a target="_blank" href="https://github.com/jmorganca/ollama/blob/main/docs/modelfile.md#valid-parameters-and-values">docs</a> for more details.',
                step: 1,
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const modelName = nodeData.inputs?.modelName as string
        const baseUrl = nodeData.inputs?.baseUrl as string
        const numThread = nodeData.inputs?.numThread as string
        const numGpu = nodeData.inputs?.numGpu as string
        const useMMap = nodeData.inputs?.useMMap as boolean
        const keepAlive = nodeData.inputs?.keepAlive as string
        const numCtx = nodeData.inputs?.numCtx as string

        const obj: OllamaEmbeddingsParams = {
            model: modelName,
            baseUrl
        }

        const requestOptions: NonNullable<OllamaEmbeddingsParams['requestOptions']> = {}
        if (numThread) requestOptions.numThread = parseFloat(numThread)
        if (numGpu) requestOptions.numGpu = parseFloat(numGpu)
        if (numCtx) requestOptions.numCtx = parseFloat(numCtx)

        // default useMMap to true
        // Note: @langchain/ollama uses `useMmap` (not `useMMap`) in requestOptions
        requestOptions.useMmap = useMMap ?? true

        if (Object.keys(requestOptions).length) obj.requestOptions = requestOptions

        if (keepAlive) obj.keepAlive = keepAlive

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const ollamaApiKey = getCredentialParam('ollamaApiKey', credentialData, nodeData)
        if (ollamaApiKey) {
            obj.headers = new Headers({
                Authorization: `Bearer ${ollamaApiKey}`
            })
        }

        const model = new OllamaEmbeddings(obj)
        return model
    }
}

module.exports = { nodeClass: OllamaEmbedding_Embeddings }
