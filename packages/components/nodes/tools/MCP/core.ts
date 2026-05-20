import {
    CallToolRequest,
    CallToolResultSchema,
    ListToolsResult,
    ListToolsResultSchema,
    LoggingMessageNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { BaseToolkit, tool, Tool } from '@langchain/core/tools'
import { z, type ZodTypeAny } from 'zod/v3'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { MCP_STREAMING_CONFIG } from './config.js'
import { checkDenyList, secureFetch } from '../../../src/httpSecurity'

export class MCPToolkit extends BaseToolkit {
    tools: Tool[] = []
    _tools: ListToolsResult | null = null
    model_config: any
    transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null
    client: Client | null = null
    serverParams: StdioServerParameters | any
    transportType: 'stdio' | 'sse'
    /** Per-invocation HTTP headers injected at tools/call time; overrides static toolkit headers for the same names. */
    getToolCallHeaders?: () => Promise<Record<string, string>>
    constructor(serverParams: StdioServerParameters | any, transportType: 'stdio' | 'sse') {
        super()
        this.serverParams = serverParams
        this.transportType = transportType
    }

    /**
     * Creates a new MCP client and connects it via the configured transport.
     * @param injectHeaders - Additional HTTP headers merged over static `serverParams.headers` for this connection.
     */
    async createClient(injectHeaders: Record<string, string> = {}): Promise<{ client: Client; hasStreaming: boolean }> {
        const client = new Client(
            {
                name: 'flowise-client',
                version: '1.0.0'
            },
            {
                capabilities: {}
            }
        )

        let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

        if (this.transportType === 'stdio') {
            // Compatible with overridden PATH configuration
            const params = {
                ...this.serverParams,
                env: {
                    ...(this.serverParams.env || {}),
                    PATH: process.env.PATH
                }
            }

            transport = new StdioClientTransport(params as StdioServerParameters)
            await client.connect(transport)
        } else {
            if (this.serverParams.url === undefined) {
                throw new Error('URL is required for SSE transport')
            }

            const baseUrl = new URL(this.serverParams.url)
            await checkDenyList(this.serverParams.url)
            const mergedHeaders = { ...this.serverParams?.headers, ...injectHeaders }
            const headers = Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined
            try {
                if (headers) {
                    transport = new StreamableHTTPClientTransport(baseUrl, {
                        requestInit: {
                            headers
                        }
                    })
                } else {
                    transport = new StreamableHTTPClientTransport(baseUrl)
                }
                await client.connect(transport)
            } catch (error) {
                if (headers) {
                    transport = new SSEClientTransport(baseUrl, {
                        requestInit: {
                            headers
                        },
                        eventSourceInit: {
                            fetch: async (url, init) => {
                                return secureFetch(url.toString(), {
                                    ...(init as any),
                                    headers
                                }) as any
                            }
                        }
                    })
                } else {
                    transport = new SSEClientTransport(baseUrl, {
                        eventSourceInit: {
                            fetch: async (url, init) => {
                                return secureFetch(url.toString(), init as any) as any
                            }
                        }
                    })
                }
                await client.connect(transport)
            }
        }

        // Check server capabilities for streaming support
        let hasStreaming = false
        try {
            const capabilities = client.getServerCapabilities()
            // Check for streaming capability in experimental or notifications section
            hasStreaming =
                (capabilities as any)?.notifications?.streaming === true ||
                (capabilities as any)?.experimental?.notifications?.streaming === true
        } catch (error) {
            console.error(`⚠️ [MCP Core] Could not detect streaming capabilities, falling back to non-streaming:`, error.message)
        }

        return { client, hasStreaming }
    }

    async initialize() {
        if (this._tools === null) {
            const { client } = await this.createClient()
            this.client = client

            this._tools = await this.client.request({ method: 'tools/list' }, ListToolsResultSchema)

            this.tools = await this.get_tools()

            // Close the initial client after initialization
            await this.client.close()
        }
    }

    async get_tools(): Promise<Tool[]> {
        if (this._tools === null || this.client === null) {
            throw new Error('Must initialize the toolkit first')
        }
        const toolsPromises = this._tools.tools.map(async (tool: any) => {
            if (this.client === null) {
                throw new Error('Client is not initialized')
            }

            return await MCPTool({
                toolkit: this,
                name: tool.name,
                description: tool.description || tool.name,
                argsSchema: createSchemaModel(tool.inputSchema),
                annotations: tool.annotations || {}
            })
        })
        const res = await Promise.allSettled(toolsPromises)
        const errors = res.filter((r) => r.status === 'rejected')
        if (errors.length !== 0) {
            console.error('MCP Tools failed to be resolved', errors)
        }
        const successes = res.filter((r) => r.status === 'fulfilled').map((r) => r.value)
        return successes
    }
}

export async function MCPTool({
    toolkit,
    name,
    description,
    argsSchema,
    annotations = {}
}: {
    toolkit: MCPToolkit
    name: string
    description: string
    argsSchema: any
    annotations?: any
}): Promise<Tool> {
    const { client, hasStreaming } = await toolkit.createClient()
    await client.close()

    const toolHasStreaming = annotations.streaming_enabled === true
    const shouldUseStreaming = hasStreaming && toolHasStreaming

    return tool(
        async (input, config): Promise<string> => {
            return await executeMCPTool(toolkit, name, input, config, annotations)
        },
        {
            name: name,
            description: shouldUseStreaming ? `${description} ${MCP_STREAMING_CONFIG.STREAMING_MARKER}` : description,
            schema: argsSchema
        }
    )
}

async function executeMCPTool(toolkit: MCPToolkit, name: string, input: any, config: any, annotations: any = {}): Promise<string> {
    const { chatId, sseStreamer } = extractConfig(config, input)
    const toolCallHeaders = await toolkit.getToolCallHeaders?.()
    const { client, hasStreaming } = await toolkit.createClient(toolCallHeaders)
    const notifications: string[] = []

    // Only use streaming if both server and tool support it
    const toolHasStreaming = annotations.streaming_enabled === true
    const shouldUseStreaming = hasStreaming && toolHasStreaming

    try {
        setupStreamingIfSupported(shouldUseStreaming, sseStreamer, chatId, name)
        setupNotificationHandlers(client, sseStreamer, chatId, name, shouldUseStreaming, notifications, annotations)

        const toolResponse = await callMCPTool(client, name, input)

        return await handleToolResponse(toolResponse, shouldUseStreaming, sseStreamer, chatId, name, notifications)
    } finally {
        if (!shouldUseStreaming) {
            await client.close()
        }
    }
}

function extractConfig(config: any, input?: any): { chatId: string; sseStreamer: any } {
    const configChatId = config?.configurable?.flowise_chatId
    const configSseStreamer = config?.configurable?.sseStreamer
    const inputChatId = input?.flowise_chatId

    return {
        chatId: configChatId || inputChatId,
        sseStreamer: configSseStreamer
    }
}

function setupStreamingIfSupported(hasStreaming: boolean, sseStreamer: any, chatId: string, name: string): void {
    if (hasStreaming && sseStreamer && chatId) {
        sseStreamer.addMcpConnection(chatId, name)
    }
}

async function callMCPTool(client: Client, name: string, input: any): Promise<string> {
    const progressToken = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const req: CallToolRequest = {
        method: 'tools/call',
        params: {
            name: name,
            arguments: input as any,
            _meta: { progressToken }
        }
    }

    const res = await client.request(req, CallToolResultSchema)
    console.log(`🟢 [FLOWISE MCP] Tool ${name} response:`, JSON.stringify(res, null, 2))
    return JSON.stringify(res.content)
}

async function handleToolResponse(
    contentString: string,
    hasStreaming: boolean,
    sseStreamer: any,
    chatId: string,
    name: string,
    notifications: string[]
): Promise<string> {
    // Check if response is an error - always return immediately for errors
    if (isErrorResponse(contentString)) {
        console.log(`⚠️ [FLOWISE MCP] Error response detected, stopping streaming and returning immediately`)
        if (sseStreamer && chatId) {
            sseStreamer.removeMcpConnection(chatId, name)
        }
        return contentString
    }

    // Non-streaming tools return immediately
    if (!hasStreaming || !sseStreamer || !chatId) {
        if (sseStreamer && chatId) {
            sseStreamer.removeMcpConnection(chatId, name)
        }
        return contentString
    }

    // Streaming tools wait for completion
    return waitForStreamingCompletion(contentString, sseStreamer, chatId, name, notifications)
}

function waitForStreamingCompletion(
    contentString: string,
    sseStreamer: any,
    chatId: string,
    name: string,
    notifications: string[]
): Promise<string> {
    return new Promise<string>((resolve) => {
        let completed = false

        const completeExecution = (_reason: string) => {
            if (completed) return
            completed = true

            const fullResponse = buildFullResponse(contentString, notifications)
            resolve(fullResponse)
        }

        // Poll for completion
        const pollInterval = setInterval(() => {
            if (!sseStreamer.hasMcpConnections(chatId)) {
                clearInterval(pollInterval)
                completeExecution('✅')
            }
        }, 500)

        // Fallback timeout
        setTimeout(() => {
            clearInterval(pollInterval)
            sseStreamer.removeMcpConnection(chatId, name)
            completeExecution('⏰')
        }, MCP_STREAMING_CONFIG.DEFAULT_COMPLETION_TIMEOUT)
    })
}

function buildFullResponse(contentString: string, notifications: string[]): string {
    return notifications.length > 0 ? `${contentString}\n\n--- Execution Log ---\n${notifications.join('\n')}` : contentString
}

function isErrorResponse(contentString: string): boolean {
    try {
        const parsedContent = JSON.parse(contentString)

        // Case 1: Array format with text content containing errors
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
            const firstItem = parsedContent[0]
            if (firstItem?.type === 'text' && typeof firstItem.text === 'string') {
                const text = firstItem.text
                // Check for validation errors or other error patterns
                if (
                    text.includes('validation error') ||
                    text.includes('error') ||
                    text.includes('Error') ||
                    text.includes('exception') ||
                    text.includes('Exception')
                ) {
                    return true
                }

                // Check for structured error responses in text
                try {
                    const innerParsed = JSON.parse(text)
                    if (isStructuredError(innerParsed)) {
                        return true
                    }
                } catch (e) {
                    // Not a JSON string within the text, continue checking
                }
            }
        }

        // Case 2: Direct structured error response
        if (isStructuredError(parsedContent)) {
            return true
        }

        // Case 3: MCP error responses with isError flag
        if (parsedContent.isError === true) {
            return true
        }
    } catch (e) {
        // If parsing fails, check for error strings in raw content
        const content = contentString.toLowerCase()
        if (content.includes('error') || content.includes('exception') || content.includes('failed')) {
            return true
        }
    }

    return false
}

function isStructuredError(obj: any): boolean {
    if (typeof obj !== 'object' || obj === null) {
        return false
    }

    // Check for common error indicators
    if (obj.success === false || obj.success === 'false' || obj.error !== undefined || obj.Error !== undefined) {
        return true
    }

    // Check for exception patterns
    if (obj.exception !== undefined || obj.Exception !== undefined) {
        return true
    }

    return false
}

function setupNotificationHandlers(
    client: Client,
    sseStreamer: any,
    chatId: string,
    toolName: string,
    shouldUseStreaming: boolean,
    notifications?: string[],
    annotations: any = {}
) {
    if (!shouldUseStreaming || !sseStreamer || !chatId) {
        return
    }

    // Get completion signals from annotations, fallback to default
    const completionSignals = annotations.notification_types || ['task_completion']

    /**
     * Handles MCP notification messages by parsing the data, extracting message/icon/tool name,
     * and streaming clean user-friendly notifications instead of raw JSON objects.
     *
     * Supports multiple message formats:
     * - { message: "text", icon: "🔍", tool_name: "Tool Name" }
     * - { msg: "text", extra: { tool: "Tool Name" } }
     * - Plain string messages
     */
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
        const data = notification.params.data
        let parsedData = data

        // Try to parse if it's a JSON string
        if (typeof data === 'string') {
            try {
                parsedData = JSON.parse(data)
            } catch {
                parsedData = data
            }
        }

        const baseMessage =
            typeof parsedData === 'object' && parsedData !== null && ('message' in parsedData || 'msg' in parsedData)
                ? String((parsedData as any).message || (parsedData as any).msg)
                : typeof data === 'string'
                ? data
                : JSON.stringify(data, null, 2)

        const icon = typeof parsedData === 'object' && parsedData !== null && 'icon' in parsedData ? (parsedData as any).icon + ' ' : ''

        const message = icon + baseMessage
        const notificationToolName =
            typeof parsedData === 'object' && parsedData !== null && 'tool_name' in parsedData
                ? (parsedData as any).tool_name
                : typeof parsedData === 'object' &&
                  parsedData !== null &&
                  'extra' in parsedData &&
                  parsedData.extra &&
                  typeof parsedData.extra === 'object' &&
                  'tool' in parsedData.extra
                ? (parsedData.extra as any).tool
                : toolName

        // Stream to UI
        sseStreamer.streamTokenEvent(chatId, `\n🔔 ${notificationToolName}: ${message}\n`)

        // Collect for final response
        if (notifications) {
            const fullData = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
            notifications.push(fullData)
        }

        const { logger } = notification.params

        // Detect completion based on tool's annotation signals
        if (completionSignals.includes(logger)) {
            // Add visual separation before LLM response
            sseStreamer.streamTokenEvent(chatId, '\n\n')

            // Trigger cleanup after brief delay
            setTimeout(() => {
                sseStreamer.removeMcpConnection(chatId, toolName)
            }, MCP_STREAMING_CONFIG.NOTIFICATION_DELAY)
        }
    })
}

function createSchemaModel(
    inputSchema: {
        type: 'object'
        properties?: Record<string, unknown>
    } & { [k: string]: unknown }
): z.ZodObject<Record<string, ZodTypeAny>> {
    if (inputSchema.type !== 'object' || !inputSchema.properties) {
        throw new Error('Invalid schema type or missing properties')
    }

    const schemaProperties = Object.entries(inputSchema.properties).reduce((acc, [key]) => {
        acc[key] = z.any()
        return acc
    }, {} as Record<string, ZodTypeAny>)

    // Add Flowise context fields to allow them through schema validation
    // schemaProperties['flowise_chatId'] = z.string().optional()

    return z.object(schemaProperties)
}

export const validateArgsForLocalFileAccess = (args: string[]): void => {
    const dangerousPatterns = [
        // Absolute paths
        /^\//, // Unix absolute paths starting with /
        /^[a-zA-Z]:\\/, // Windows absolute paths like C:\

        // Relative paths that could escape current directory
        /\.\.\//, // Parent directory traversal with ../
        /\.\.\\/, // Parent directory traversal with ..\
        /^\.\./, // Starting with ..

        // Local file access patterns
        /^\.\//, // Current directory with ./
        /^~\//, // Home directory with ~/
        /^file:\/\//, // File protocol

        // Common file extensions that shouldn't be accessed
        /\.(exe|bat|cmd|sh|ps1|vbs|scr|com|pif|dll|sys)$/i,

        // File flags and options that could access local files
        /^--?(?:file|input|output|config|load|save|import|export|read|write)=/i,
        /^--?(?:file|input|output|config|load|save|import|export|read|write)$/i
    ]

    for (const arg of args) {
        if (typeof arg !== 'string') continue

        // Check for dangerous patterns
        for (const pattern of dangerousPatterns) {
            if (pattern.test(arg)) {
                throw new Error(`Argument contains potential local file access: "${arg}"`)
            }
        }

        // Check for null bytes
        if (arg.includes('\0')) {
            throw new Error(`Argument contains null byte: "${arg}"`)
        }

        // Check for very long paths that might be used for buffer overflow attacks
        if (arg.length > 1000) {
            throw new Error(`Argument is suspiciously long (${arg.length} characters): "${arg.substring(0, 100)}..."`)
        }
    }
}

export const validateCommandInjection = (args: string[]): void => {
    const dangerousPatterns = [
        // Shell metacharacters
        /[;&|`$(){}[\]<>]/,
        // Command chaining
        /&&|\|\||;;/,
        // Redirections
        />>|<<|>/,
        // Backticks and command substitution
        /`|\$\(/,
        // Process substitution
        /<\(|>\(/
    ]

    for (const arg of args) {
        if (typeof arg !== 'string') continue

        for (const pattern of dangerousPatterns) {
            if (pattern.test(arg)) {
                throw new Error(`Argument contains potentially dangerous characters: "${arg}"`)
            }
        }
    }
}

export const validateEnvironmentVariables = (env: Record<string, any>): void => {
    const dangerousEnvVars = ['PATH', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'NODE_OPTIONS']

    for (const [key, value] of Object.entries(env)) {
        if (dangerousEnvVars.includes(key)) {
            throw new Error(`Environment variable '${key}' modification is not allowed`)
        }

        if (typeof value === 'string' && value.includes('\0')) {
            throw new Error(`Environment variable '${key}' contains null byte`)
        }
    }
}

/**
 * Validates that command arguments don't contain flags that enable arbitrary code execution
 * This prevents attacks where whitelisted commands are used with dangerous flags
 * (e.g., "npx -c malicious-command" or "python -c malicious-code")
 * @param command The command to validate
 * @param args The arguments to validate
 */
export const validateCommandFlags = (command: string, args: string[]): void => {
    // Define dangerous flags for each command that enable code execution
    const dangerousFlagsByCommand: Record<string, string[]> = {
        npx: [
            '-c', // Execute shell commands
            '--call', // Execute shell commands
            '--shell-auto-fallback', // Shell execution fallback
            '-y', // Auto-confirms installation prompts
            '--yes', // Auto-confirms installation prompts
            '--node-options' // Passes arbitrary Node flags to underlying process, bypassing node flag blocklist
        ],
        node: [
            '-e', // Execute JavaScript code
            '--eval', // Execute JavaScript code
            '-p', // Evaluate and print JavaScript code
            '--print', // Evaluate and print JavaScript code
            '--inspect', // Enable remote debugging (security risk)
            '--inspect-brk', // Enable remote debugging with breakpoint (security risk)
            '--experimental-policy', // Could load malicious policies
            '-r', // Short alias for --require
            '--require', // Preload a CommonJS module before script runs
            '--loader', // Custom ES module loader hook (code execution)
            '--experimental-loader', // Same as --loader, older Node alias
            '--import', // Preload ESM module before entry script (Node 18+)
            '--env-file' // Read env vars from a local file (Node 20+, local file access)
        ],
        python: [
            '-c', // Execute Python code
            '-m' // Run library modules (could run malicious modules)
        ],
        python3: [
            '-c', // Execute Python code
            '-m' // Run library modules (could run malicious modules)
        ],
        docker: [
            'run', // Run containers (too powerful)
            'build', // Pulls a container and executes the run instructions
            'exec', // Execute in containers
            'compose', // Subcommand that starts containers (same risk as run)
            '-v', // Mount host filesystems
            '--volume', // Mount host filesystems
            '--mount', // Alternative to -v/--volume for mounting host paths
            '--volumes-from', // Mount volumes from another container (filesystem access)
            '--privileged', // Privileged mode
            '--cap-add', // Add capabilities
            '--security-opt', // Modify security options
            '--device', // Add host device files to container (privilege escalation)
            '--entrypoint', // Override container entrypoint (arbitrary code execution)
            '--network', // Host network access (catches --network=host and --network host)
            '--pid', // Host PID namespace (catches --pid=host and --pid host)
            '--ipc', // Host IPC namespace (catches --ipc=host and --ipc host)
            '--env-file' // Read env vars from a local host file (local file access)
        ]
    }

    const dangerousFlags = dangerousFlagsByCommand[command] || []

    // Collect single-char dangerous flags (e.g. '-c' -> 'c') for combined flag detection
    const dangerousShortChars = new Set(dangerousFlags.filter((f) => /^-[a-zA-Z]$/.test(f)).map((f) => f[1].toLowerCase()))

    for (const arg of args) {
        if (typeof arg !== 'string') continue

        const normalizedArg = arg.toLowerCase().trim()

        // Check for dangerous flags in various forms (exact, =value, space-separated value)
        for (const flag of dangerousFlags) {
            const lowerCaseFlag = flag.toLowerCase()
            if (normalizedArg === lowerCaseFlag) {
                throw new Error(`Argument '${arg}' is not allowed for command '${command}'.`)
            }
            if (normalizedArg.startsWith(lowerCaseFlag + '=')) {
                throw new Error(`Argument '${arg}' contains flag '${flag}' that is not allowed for command '${command}'.`)
            }
            if (flag.startsWith('-') && normalizedArg.startsWith(lowerCaseFlag + ' ')) {
                throw new Error(`Argument '${arg}' contains flag '${flag}' that is not allowed for command '${command}'.`)
            }
        }

        // Check for combined short flags (e.g. "-yc" = "-y" + "-c")
        // A combined flag starts with a single '-', is not a long flag '--', and has multiple characters after '-'
        if (/^-[a-zA-Z]{2,}/.test(normalizedArg)) {
            const flagChars = normalizedArg.slice(1) // strip leading '-'
            for (const ch of flagChars) {
                if (dangerousShortChars.has(ch)) {
                    throw new Error(`Argument '${arg}' contains dangerous flag '-${ch}' for command '${command}'.`)
                }
            }
        }
    }
}

export const validateMCPServerConfig = (serverParams: any): void => {
    // Validate the entire server configuration
    if (!serverParams || typeof serverParams !== 'object') {
        throw new Error('Invalid server configuration')
    }

    // Command allowlist - only allow specific safe commands
    const allowedCommands = ['node', 'npx', 'python', 'python3', 'docker']

    if (serverParams.command && !allowedCommands.includes(serverParams.command)) {
        throw new Error(`Command '${serverParams.command}' is not allowed. Allowed commands: ${allowedCommands.join(', ')}`)
    }

    // Validate arguments if present
    if (serverParams.args && Array.isArray(serverParams.args)) {
        validateArgsForLocalFileAccess(serverParams.args)
        validateCommandInjection(serverParams.args)

        // Validate command-specific dangerous flags
        if (serverParams.command) {
            validateCommandFlags(serverParams.command, serverParams.args)
        }
    }

    // Validate environment variables
    if (serverParams.env) {
        validateEnvironmentVariables(serverParams.env)
    }
}
