import { substituteVariablesInString } from './variableSubstitution'

const sandbox = (vars: Record<string, string>) => ({ $vars: { ...vars } })

describe('CustomMCP substituteVariablesInString', () => {
    describe('unfiltered placeholders (regression)', () => {
        it('substitutes a string value unchanged', () => {
            const out = substituteVariablesInString('Bearer {{$vars.token}}', sandbox({ token: 'abc123' }))
            expect(out).toBe('Bearer abc123')
        })

        it('leaves the placeholder untouched when the variable is missing', () => {
            const out = substituteVariablesInString('Bearer {{$vars.missing}}', sandbox({ token: 'abc' }))
            expect(out).toBe('Bearer {{$vars.missing}}')
        })

        it('JSON.stringify non-string values (legacy behavior)', () => {
            const out = substituteVariablesInString('{{$vars.obj}}', { $vars: { obj: { a: 1 } } as any })
            expect(out).toBe('{"a":1}')
        })
    })

    describe('| json filter inside a JSON string slot', () => {
        it('escapes an object so it fits between surrounding quotes', () => {
            const template = '"X-metadata": "{{$vars.metadata | json}}"'
            const out = substituteVariablesInString(template, sandbox({ metadata: '{"tenant":"acme","role":"admin"}' }))
            expect(out).toBe('"X-metadata": "{\\"tenant\\":\\"acme\\",\\"role\\":\\"admin\\"}"')
            // the result is valid JSON and parses back to an object-valued string
            const parsed = JSON.parse(`{${out}}`)
            expect(JSON.parse(parsed['X-metadata'])).toEqual({ tenant: 'acme', role: 'admin' })
        })

        it('escapes an array value', () => {
            const template = '"list": "{{$vars.arr | json}}"'
            const out = substituteVariablesInString(template, sandbox({ arr: '[1,2,3]' }))
            expect(out).toBe('"list": "[1,2,3]"')
            const parsed = JSON.parse(`{${out}}`)
            expect(JSON.parse(parsed.list)).toEqual([1, 2, 3])
        })
    })

    describe('| json filter in a raw JSON slot', () => {
        it('emits an object literal when the placeholder is not quoted', () => {
            const template = '"headers": {{$vars.headers | json}}'
            const out = substituteVariablesInString(template, sandbox({ headers: '{"X-a":"1","X-b":"2"}' }))
            expect(out).toBe('"headers": {"X-a":"1","X-b":"2"}')
            expect(JSON.parse(`{${out}}`).headers).toEqual({ 'X-a': '1', 'X-b': '2' })
        })

        it('emits a number literal', () => {
            const out = substituteVariablesInString('"n": {{$vars.n | json}}', sandbox({ n: '42' }))
            expect(out).toBe('"n": 42')
        })

        it('emits a boolean literal', () => {
            const out = substituteVariablesInString('"b": {{$vars.b | json}}', sandbox({ b: 'true' }))
            expect(out).toBe('"b": true')
        })

        it('emits null', () => {
            const out = substituteVariablesInString('"x": {{$vars.x | json}}', sandbox({ x: 'null' }))
            expect(out).toBe('"x": null')
        })

        it('emits a JSON-quoted string literal', () => {
            const out = substituteVariablesInString('"s": {{$vars.s | json}}', sandbox({ s: '"hello"' }))
            expect(out).toBe('"s": "hello"')
        })
    })

    describe('parse-failure fallback', () => {
        it('warns with raw input and falls back to the raw string', () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            const out = substituteVariablesInString('X: "{{$vars.broken | json}}"', sandbox({ broken: 'not json' }))
            expect(out).toBe('X: "not json"')
            expect(warn).toHaveBeenCalledTimes(1)
            const msg = warn.mock.calls[0][0]
            expect(msg).toContain('broken')
            expect(msg).toContain('not json')
            warn.mockRestore()
        })
    })

    describe('whitespace and syntax variants', () => {
        it.each([
            ['{{$vars.m|json}}', 'no spaces'],
            ['{{$vars.m | json}}', 'standard'],
            ['{{ $vars.m | json }}', 'outer spaces'],
            ['{{  $vars.m  |  json  }}', 'double spaces']
        ])('accepts %s (%s)', (tpl) => {
            const out = substituteVariablesInString(`"x": ${tpl}`, sandbox({ m: '{"a":1}' }))
            expect(out).toBe('"x": {"a":1}')
        })
    })

    describe('multiple and nested placeholders', () => {
        it('handles mixed filtered and unfiltered placeholders in one template', () => {
            const template = '{"auth":"Bearer {{$vars.tok}}","meta":"{{$vars.meta | json}}","raw":{{$vars.raw | json}}}'
            const out = substituteVariablesInString(template, sandbox({ tok: 'xyz', meta: '{"id":1}', raw: '[1,2]' }))
            const obj = JSON.parse(out)
            expect(obj.auth).toBe('Bearer xyz')
            expect(JSON.parse(obj.meta)).toEqual({ id: 1 })
            expect(obj.raw).toEqual([1, 2])
        })

        it('walks nested paths inside sandbox', () => {
            const template = '"v": "{{$vars.a.b | json}}"'
            const nested = { $vars: { a: { b: '{"deep":true}' } as any } }
            const out = substituteVariablesInString(template, nested)
            expect(out).toBe('"v": "{\\"deep\\":true}"')
        })
    })

    describe('context detector edge cases', () => {
        it('treats an escaped quote as not closing the current string', () => {
            const template = '"prefix \\": {{$vars.m | json}}"'
            const out = substituteVariablesInString(template, sandbox({ m: '{"a":1}' }))
            // placeholder sits inside the open string that started at the leading ", so output is escaped
            expect(out).toBe('"prefix \\": {\\"a\\":1}"')
        })
    })
})
