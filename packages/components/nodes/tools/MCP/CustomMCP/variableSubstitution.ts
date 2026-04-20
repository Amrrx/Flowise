const PLACEHOLDER_REGEX = /\{\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*(?:\|\s*(json))?\s*\}\}/g

export function substituteVariablesInString(str: string, sandbox: any): string {
    return str.replace(PLACEHOLDER_REGEX, (match, variablePath, filter, offset: number, fullStr: string) => {
        try {
            const value = resolveVariablePath(variablePath, sandbox)
            if (value === undefined) return match

            if (filter === 'json') {
                return applyJsonFilter(variablePath, value, offset, fullStr)
            }
            return typeof value === 'string' ? value : JSON.stringify(value)
        } catch (error) {
            console.warn(`Error resolving variable ${match}:`, error)
            return match
        }
    })
}

export function substituteVariablesInObject(obj: any, sandbox: any): any {
    if (typeof obj === 'string') {
        return substituteVariablesInString(obj, sandbox)
    }
    if (Array.isArray(obj)) {
        return obj.map((item) => substituteVariablesInObject(item, sandbox))
    }
    if (obj !== null && typeof obj === 'object') {
        const result: any = {}
        for (const [key, value] of Object.entries(obj)) {
            result[key] = substituteVariablesInObject(value, sandbox)
        }
        return result
    }
    return obj
}

function resolveVariablePath(path: string, sandbox: any): any {
    const pathParts = path.split('.')
    let current = sandbox

    for (const part of pathParts) {
        if (current === sandbox) {
            const sandboxKey = `$${part}`
            if (!Object.keys(current).includes(sandboxKey)) return undefined
            current = current[sandboxKey]
        } else if (current && typeof current === 'object' && part in current) {
            current = current[part]
        } else {
            return undefined
        }
    }
    return current
}

function applyJsonFilter(variablePath: string, rawValue: any, offset: number, fullStr: string): string {
    let parsed: any
    try {
        parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue
    } catch (error) {
        console.warn(
            `[CustomMCP] "| json" filter could not parse $${variablePath}. Falling back to raw value. Input: ${JSON.stringify(
                rawValue
            )} | Error: ${(error as Error).message}`
        )
        return typeof rawValue === 'string' ? rawValue : String(rawValue)
    }

    const literal = JSON.stringify(parsed)
    return isInsideJsonString(fullStr, offset) ? JSON.stringify(literal).slice(1, -1) : literal
}

function isInsideJsonString(fullStr: string, offset: number): boolean {
    let count = 0
    let i = 0
    while (i < offset) {
        const ch = fullStr[i]
        if (ch === '\\') {
            i += 2
            continue
        }
        if (ch === '"') count++
        i++
    }
    return count % 2 === 1
}
