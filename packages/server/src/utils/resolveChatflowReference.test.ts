import { parseChatflowReference } from './resolveChatflowReference'

describe('parseChatflowReference', () => {
    it('parses a UUID', () => {
        const ref = parseChatflowReference('3f8a1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d')
        expect(ref).toEqual({ kind: 'uuid', id: '3f8a1c2d-4e5f-6a7b-8c9d-0e1f2a3b4c5d' })
    })

    it('parses a plain name', () => {
        const ref = parseChatflowReference('Avl_Agent')
        expect(ref).toEqual({ kind: 'name', name: 'Avl_Agent' })
    })

    it('parses name@tag', () => {
        const ref = parseChatflowReference('Avl_Agent@v2.2.1')
        expect(ref).toEqual({ kind: 'nameTag', name: 'Avl_Agent', tag: 'v2.2.1' })
    })

    it('parses name@production', () => {
        const ref = parseChatflowReference('Avl_Agent@production')
        expect(ref).toEqual({ kind: 'nameTag', name: 'Avl_Agent', tag: 'production' })
    })

    it('rejects empty string', () => {
        expect(() => parseChatflowReference('')).toThrow(/invalid/i)
    })

    it('rejects empty name (e.g. @tag)', () => {
        expect(() => parseChatflowReference('@v1')).toThrow(/invalid/i)
    })

    it('rejects empty tag (e.g. name@)', () => {
        expect(() => parseChatflowReference('Avl_Agent@')).toThrow(/invalid/i)
    })

    it('rejects multiple @ separators', () => {
        expect(() => parseChatflowReference('a@b@c')).toThrow(/invalid/i)
    })
})
