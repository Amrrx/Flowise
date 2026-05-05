import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../errors/internalFlowiseError'

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
