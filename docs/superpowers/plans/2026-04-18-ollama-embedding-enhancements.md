# Ollama Embedding Enhancements Implementation Plan

> **For agentic workers:** This is a single-file, single-commit enhancement. Steps use checkbox (`- [ ]`) for tracking. No TDD needed (pure config forwarding, no logic branching).

**Goal:** Add credential-based Bearer auth and two commonly-useful Ollama runtime parameters to the OllamaEmbedding node, matching the pattern used by ChatOllama.

**Architecture:** Extend the existing node with one credential field and two new inputs. No new files, no new abstractions. The `@langchain/ollama` SDK's `OllamaEmbeddingsParams` already exposes `headers` (top-level) and `keepAlive` (top-level); `numCtx` goes into the existing `requestOptions` object. Authentication is standard HTTP Bearer — same `ollamaApi` credential that ChatOllama reuses.

**Tech Stack:** TypeScript, `@langchain/ollama`. The credential `ollamaApi` already exists at `packages/components/credentials/Ollama.credential.ts` with a single `ollamaApiKey` password field — reused as-is.

**Scope decisions (explicit non-goals):**

-   NO generation-only params (temperature, topP, topK, mirostat, streaming, think, jsonMode, stop). These only make sense for chat/completion, not embeddings. Exposing them would mislead users.
-   NO new credential type. The existing `ollamaApi` credential is sufficient.
-   NO `truncate` or `dimensions` fields. Useful but not requested; add later if needed.

---

## File Structure

**New files:** none.

**Modified files:**

-   `packages/components/nodes/embeddings/OllamaEmbedding/OllamaEmbedding.ts` — the only file touched.

---

## Task 1: Extend OllamaEmbedding with credential + keepAlive + numCtx

**Files:**

-   Modify: `packages/components/nodes/embeddings/OllamaEmbedding/OllamaEmbedding.ts`

**Reference:** `packages/components/nodes/chatmodels/ChatOllama/ChatOllama.ts:29-35` (credential field), `:286-292` (auth header construction). The pattern is copied verbatim.

-   [ ] **Step 1: Read the current node**

```bash
cat packages/components/nodes/embeddings/OllamaEmbedding/OllamaEmbedding.ts
```

Confirm it currently has: `baseUrl`, `modelName`, `numGpu`, `numThread`, `useMMap`, and `version: 2.0`.

-   [ ] **Step 2: Add imports for credential helpers**

File: `packages/components/nodes/embeddings/OllamaEmbedding/OllamaEmbedding.ts`

Change line 3 from:

```ts
import { getBaseClasses } from '../../../src/utils'
```

to:

```ts
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
```

-   [ ] **Step 3: Bump version**

Line 20: change `this.version = 2.0` to `this.version = 2.1`.

-   [ ] **Step 4: Add `credential` field**

Inside the constructor, **immediately after** `this.baseClasses = [...]` line (line 25) and **before** `this.inputs = [`, add:

```ts
this.credential = {
    label: 'Connect Credential',
    name: 'credential',
    type: 'credential',
    credentialNames: ['ollamaApi'],
    optional: true
}
```

Also declare the `credential` property at the top of the class alongside the existing declarations. Find the block:

```ts
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams    // <-- ALREADY present in original; leave it
    inputs: INodeParams[]
```

Confirm `credential: INodeParams` is already in the class declaration block (it is — line 14 of the original). If not, add it.

-   [ ] **Step 5: Add `keepAlive` input**

Inside `this.inputs = [...]`, **after** the existing `useMMap` block (which ends around line 66), append:

```ts
            ,
            {
                label: 'Keep Alive',
                name: 'keepAlive',
                type: 'string',
                description: 'How long to keep the model loaded. A duration string (such as "10m" or "24h"). Default: 5m.',
                default: '5m',
                optional: true,
                additionalParams: true
            }
```

**Important:** watch the comma placement — the array may end with `}` (no trailing comma). Add a comma before your new entry if needed.

-   [ ] **Step 6: Add `numCtx` input**

Immediately after the `keepAlive` block:

```ts
            ,
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
```

-   [ ] **Step 7: Update `init()` to read credential + keepAlive + numCtx**

Change the `init()` method signature from:

```ts
    async init(nodeData: INodeData): Promise<any> {
```

to:

```ts
    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
```

Also add `ICommonObject` to the imports on line 2. Change:

```ts
import { INode, INodeData, INodeParams } from '../../../src/Interface'
```

to:

```ts
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
```

Inside `init()`, after the existing input reads (around line 75, after `const useMMap = ...`), add:

```ts
const keepAlive = nodeData.inputs?.keepAlive as string
const numCtx = nodeData.inputs?.numCtx as string
```

Then after the existing `if (numThread) requestOptions.numThread = ...` line, add:

```ts
if (numCtx) requestOptions.numCtx = parseFloat(numCtx)
```

After `if (Object.keys(requestOptions).length) obj.requestOptions = requestOptions` line, and BEFORE `const model = new OllamaEmbeddings(obj)`, add:

```ts
if (keepAlive) obj.keepAlive = keepAlive

const credentialData = await getCredentialData(nodeData.credential ?? '', options)
const ollamaApiKey = getCredentialParam('ollamaApiKey', credentialData, nodeData)
if (ollamaApiKey) {
    obj.headers = new Headers({
        Authorization: `Bearer ${ollamaApiKey}`
    })
}
```

Full expected structure inside `init()` after changes (pseudo-code):

```
const modelName = ...
const baseUrl = ...
const numThread = ...
const numGpu = ...
const useMMap = ...
const keepAlive = ...            <- NEW
const numCtx = ...               <- NEW

const obj: OllamaEmbeddingsParams = { model: modelName, baseUrl }

const requestOptions = {}
if (numThread) requestOptions.numThread = ...
if (numGpu) requestOptions.numGpu = ...
if (numCtx) requestOptions.numCtx = ...     <- NEW
requestOptions.useMmap = useMMap ?? true

if (Object.keys(requestOptions).length) obj.requestOptions = requestOptions

if (keepAlive) obj.keepAlive = keepAlive                              <- NEW

const credentialData = await getCredentialData(...)                   <- NEW
const ollamaApiKey = getCredentialParam('ollamaApiKey', ...)          <- NEW
if (ollamaApiKey) obj.headers = new Headers({ Authorization: ... })   <- NEW

const model = new OllamaEmbeddings(obj)
return model
```

-   [ ] **Step 8: TypeScript check**

```bash
pnpm --filter flowise-components exec tsc --noEmit 2>&1 | grep "OllamaEmbedding" || echo "no errors in OllamaEmbedding"
```

Ignore unrelated pre-existing errors; verify nothing in `OllamaEmbedding.ts` reports.

-   [ ] **Step 9: Rebuild components (required so server picks up the change)**

```bash
pnpm --filter flowise-components build
```

Expected: completes in 30-60 s with no errors. If faiss-node emits warnings, ignore (pre-existing CMake issue, unrelated).

-   [ ] **Step 10: Commit**

```bash
git add packages/components/nodes/embeddings/OllamaEmbedding/OllamaEmbedding.ts
git commit -m "feat(ollama-embed): add credential + keepAlive + numCtx options

Reuses the existing ollamaApi credential to set an Authorization: Bearer
header, matching how ChatOllama already handles auth. Adds keepAlive
(model retention duration) and numCtx (context window size) as optional
advanced params. Generation-only params (temperature, topP, topK, etc.)
are deliberately excluded — embeddings compute one-shot vectors, so
they do not apply."
```

---

## Task 2: Smoke test in UI (manual)

-   [ ] **Step 1: Restart the server**

```bash
cd ~/Flowise && pnpm start
```

-   [ ] **Step 2: Open canvas, add Ollama Embedding node**

Verify the node shows:

-   New "Connect Credential" dropdown at top (optional)
-   "Keep Alive" under Additional Parameters (default `5m`)
-   "Context Window Size" under Additional Parameters (empty, optional)

-   [ ] **Step 3: With a flow using the node, set baseUrl to a protected Ollama endpoint**

Create an `ollamaApi` credential with a test token, connect it to the node, save the flow, and check the server log for a successful connection. If unauthenticated requests would have failed at the endpoint, the Bearer header is now being sent.

Alternative quick check (no remote Ollama needed): add a `console.log(obj)` inside `init()`, save the flow, and inspect the server log — `obj.headers` should be a `Headers` instance containing the `Authorization` key when a credential is attached.

-   [ ] **Step 4: Verify keepAlive and numCtx propagate**

Set `keepAlive: "1m"` and `numCtx: 4096` in the node UI, save, and inspect that the Ollama request body (server log or network tab) reflects both values.

---

## Risks & watch-outs

-   **Version bump:** bumping `2.0 → 2.1` signals to Flowise's node-upgrade machinery that existing flows with older node data might need migration. In practice, adding optional fields is backward-compatible — existing flows continue to work with new fields as `undefined`. But confirm by loading a pre-existing chatflow that uses the old `OllamaEmbedding` and ensure it still runs.
-   **`ICommonObject` import:** if the import path changes in a future refactor, this pattern breaks across many nodes. ChatOllama uses the same pattern (`import { ICommonObject, ... } from '../../../src/Interface'`); stay consistent.
-   **Rebuild required:** the UI reads node metadata at server boot time. Without `pnpm --filter flowise-components build`, the new fields won't appear in the UI palette. This is the single most common "why don't my changes show up" gotcha in Flowise node development.
-   **Tests:** none added in this plan. The change is pure input forwarding with no new logic branches. Value-for-effort of a test is low. If the user wants test coverage, a simple integration test that mocks `OllamaEmbeddings` constructor and asserts it received the expected `obj` shape would suffice.

---

## Success Criteria

-   Credential dropdown appears on the Ollama Embedding node in the UI.
-   "Keep Alive" and "Context Window Size" fields appear under Additional Parameters.
-   Attaching an `ollamaApi` credential results in `Authorization: Bearer <token>` being sent to the Ollama endpoint.
-   Setting `keepAlive` and `numCtx` propagates into the corresponding Ollama request fields.
-   Existing chatflows that use the node without these new fields continue to work unchanged.
