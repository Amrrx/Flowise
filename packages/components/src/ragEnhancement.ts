/**
 * RAG Enhancement Utility
 *
 * Enhances vector search results with BM25 keyword search and reranking.
 * Calls external document processor service for hybrid retrieval.
 */

import { Document } from '@langchain/core/documents'

interface VectorDocument {
    page_content: string
    metadata: Record<string, any>
}

interface EnhancedDocument {
    page_content: string
    metadata: Record<string, any>
    score: number
}

interface EnhanceResponse {
    documents: EnhancedDocument[]
    trace: {
        bm25_count: number
        vector_count: number
        fusion_count: number
        rerank_ms: number
    }
}

/**
 * Check if RAG enhancement is enabled via environment variables.
 */
export function isRagEnhancementEnabled(): boolean {
    return !!process.env.DOCUMENT_PROCESSOR_URL && process.env.RAG_ENHANCEMENT_ENABLED === 'true'
}

/**
 * Log RAG enhancement configuration status at startup.
 */
export function logRagEnhancementStatus(): void {
    const url = process.env.DOCUMENT_PROCESSOR_URL
    const enabled = process.env.RAG_ENHANCEMENT_ENABLED

    if (isRagEnhancementEnabled()) {
        console.log(`[RAG Enhancement] ✓ ENABLED - URL: ${url}`)
    } else {
        console.log(
            `[RAG Enhancement] ✗ DISABLED - DOCUMENT_PROCESSOR_URL=${url || 'not set'}, RAG_ENHANCEMENT_ENABLED=${enabled || 'not set'}`
        )
    }
}

// Log status on module load
logRagEnhancementStatus()

/**
 * Enhance vector search results with BM25 and reranking.
 *
 * @param docs - Documents from vector search
 * @param query - The search query
 * @param storeId - Flowise document store ID
 * @param topK - Number of results to return (default: 5)
 * @returns Enhanced documents, or original docs if enhancement fails
 */
export async function enhanceRetrievalResults(docs: Document[], query: string, storeId: string, topK: number = 5): Promise<Document[]> {
    console.log(`[RAG Enhancement] Called: storeId=${storeId}, docs=${docs.length}, query="${query.substring(0, 50)}..."`)
    console.log(`[RAG Enhancement] Env check: URL=${process.env.DOCUMENT_PROCESSOR_URL}, ENABLED=${process.env.RAG_ENHANCEMENT_ENABLED}`)

    if (!isRagEnhancementEnabled()) {
        console.log('[RAG Enhancement] Disabled or not configured, skipping')
        return docs
    }

    if (!storeId) {
        console.warn('[RAG Enhancement] No store ID provided, skipping enhancement')
        return docs
    }

    if (docs.length === 0) {
        return docs
    }

    const documentProcessorUrl = process.env.DOCUMENT_PROCESSOR_URL

    try {
        const vectorDocs: VectorDocument[] = docs.map((doc) => ({
            page_content: doc.pageContent,
            metadata: doc.metadata || {}
        }))

        const response = await fetch(`${documentProcessorUrl}/enhance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                vector_docs: vectorDocs,
                store_id: storeId,
                top_k: topK
            })
        })

        if (!response.ok) {
            console.warn(`[RAG Enhancement] Service returned ${response.status}, using original results`)
            return docs
        }

        const enhanced: EnhanceResponse = await response.json()

        // Log trace info for debugging
        console.log(
            `[RAG Enhancement] Enhanced results: vector=${enhanced.trace.vector_count}, ` +
                `bm25=${enhanced.trace.bm25_count}, fused=${enhanced.trace.fusion_count}, ` +
                `rerank_ms=${enhanced.trace.rerank_ms}`
        )

        // Convert back to Document format
        return enhanced.documents.map(
            (doc) =>
                new Document({
                    pageContent: doc.page_content,
                    metadata: {
                        ...doc.metadata,
                        _enhancementScore: doc.score
                    }
                })
        )
    } catch (error) {
        // Graceful degradation: log error and return original docs
        console.warn('[RAG Enhancement] Failed to enhance results, using original:', error)
        return docs
    }
}
