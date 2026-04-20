import { getVariableValue } from './index'
import logger from './logger'

const makeVar = (name: string, value: string) => ({
    id: `${name}-id`,
    name,
    value,
    type: 'static' as const,
    workspaceId: '',
    createdDate: new Date(),
    updatedDate: new Date()
})

const invoke = async (template: string, vars: Record<string, string>, flowConfig: Record<string, string> = {}) =>
    getVariableValue(
        template,
        [],
        '',
        [],
        false,
        flowConfig,
        undefined,
        Object.entries(vars).map(([k, v]) => makeVar(k, v))
    )

describe('getVariableValue', () => {
    describe('unfiltered placeholders (regression)', () => {
        it('substitutes $vars string value', async () => {
            const out = await invoke('Bearer {{$vars.token}}', { token: 'abc' })
            expect(out).toBe('Bearer abc')
        })

        it('substitutes $flow value', async () => {
            const out = await invoke('Id: {{$flow.chatId}}', {}, { chatId: 'c-1' })
            expect(out).toBe('Id: c-1')
        })

        it('leaves unknown variable placeholder untouched', async () => {
            const out = await invoke('X: {{$vars.missing}}', { token: 'abc' })
            expect(out).toBe('X: {{$vars.missing}}')
        })
    })

    describe('| json filter inside a JSON string slot', () => {
        it('escapes a $vars object to embed in a JSON string', async () => {
            const out = await invoke('"m": "{{$vars.m | json}}"', { m: '{"tenant":"acme"}' })
            expect(out).toBe('"m": "{\\"tenant\\":\\"acme\\"}"')
            const parsed = JSON.parse(`{${out}}`)
            expect(JSON.parse(parsed.m)).toEqual({ tenant: 'acme' })
        })

        it('escapes a $flow object to embed in a JSON string', async () => {
            const out = await invoke('"m": "{{$flow.meta | json}}"', {}, { meta: '{"a":1}' })
            expect(out).toBe('"m": "{\\"a\\":1}"')
        })
    })

    describe('| json filter in a raw JSON slot', () => {
        it('emits a $vars object literal when not quoted', async () => {
            const out = await invoke('"headers": {{$vars.h | json}}', { h: '{"X-a":"1"}' })
            expect(out).toBe('"headers": {"X-a":"1"}')
        })

        it('emits numbers / booleans / null as literals', async () => {
            const out = await invoke('n:{{$vars.n | json}} b:{{$vars.b | json}} x:{{$vars.x | json}}', {
                n: '42',
                b: 'true',
                x: 'null'
            })
            expect(out).toBe('n:42 b:true x:null')
        })
    })

    describe('parse-failure fallback', () => {
        it('warns and falls back to raw value', async () => {
            const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger)
            const out = await invoke('"m": "{{$vars.broken | json}}"', { broken: 'not json' })
            expect(out).toBe('"m": "not json"')
            expect(warn).toHaveBeenCalledTimes(1)
            const msg = String(warn.mock.calls[0][0])
            expect(msg).toContain('$vars.broken')
            expect(msg).toContain('not json')
            warn.mockRestore()
        })
    })

    describe('whitespace tolerance', () => {
        it.each(['{{$vars.m|json}}', '{{$vars.m | json}}', '{{ $vars.m | json }}', '{{  $vars.m  |  json  }}'])(
            'accepts %s',
            async (tpl) => {
                const out = await invoke(`"x": ${tpl}`, { m: '{"a":1}' })
                expect(out).toBe('"x": {"a":1}')
            }
        )
    })
})
