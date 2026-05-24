/**
 * Active Knowledge RAG Pipeline
 * Executes the 8-stage RAG process for dynamic contextual retrieval,
 * live hook enrichment, data summarization, and LLM resolution.
 */

const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DB_SOURCE === 'cloud'
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'saas_ecommerce',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '343434',
    };
const pool = new Pool(poolConfig);

const stateManager = require('../state/stateManager');
const { queryAI } = require('./aiService');
const { executeLiveHooks } = require('./liveHooks');

/**
 * Stage 3: Resolving UI Hooks
 */
function resolveUiHooks(uiHooks, liveData, entityMeta) {
    const buttons = [];

    for (const hook of uiHooks) {
        switch (hook) {
            case 'ui.vendor_contact':
                if (liveData.phone && liveData.whatsapp_enabled) {
                    buttons.push({
                        id: `__wa:${liveData.phone}__`,
                        title: `Message ${entityMeta.entity_name || 'Vendor'}`
                    });
                }
                break;
            case 'ui.vendor_store':
                if (liveData.store_url) {
                    buttons.push({
                        id: `__web:${liveData.store_url}__`,
                        title: 'Visit Store',
                        type: 'cta_url',
                        url: liveData.store_url
                    });
                }
                break;
            case 'ui.shop_category':
                if (liveData.total > 0 || liveData.product_count > 0) {
                    buttons.push({
                        id: `__cat:browse:${entityMeta.entity_id}__`,
                        title: `Shop ${entityMeta.entity_name}`
                    });
                }
                break;
            case 'ui.shop_collection':
                if (liveData.product_count > 0) {
                    buttons.push({
                        id: `__cat:browse:${entityMeta.entity_id}__`, // Reusing category browse structure for now
                        title: `Browse ${entityMeta.entity_name}`
                    });
                }
                break;
            case 'ui.support_ticket':
                if (liveData.support_online) {
                    buttons.push({ id: `__support:open__`, title: 'Speak to Support' });
                }
                break;
        }
    }

    return buttons.slice(0, 3);
}

/**
 * Main RAG Processing function
 * 
 * @param {string} sessionId
 * @param {string} userQuery
 * @param {Object} extractedEntities - { vendor, category }
 * @param {Object} options
 * @param {boolean} [options.llmSummary=false] - When false (default), skips the internal LLM and returns
 *   raw contextNarrative + buttons as tool data for the DCO personality layer to handle (proper Be3
 *   identity grounding). Set to true ONLY for REPL/testing to exercise the internal LLM path directly.
 */
async function processRAGQuery(sessionId, userQuery, extractedEntities = {}, options = {}) {
    const { llmSummary = false } = options;
    const tenantId = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000000';

    // =========================================================================
    // Stage 1a: Ambient Context Read
    // =========================================================================
    const activeTopic = (await stateManager.getActiveTopic(sessionId)) || {};
    let pinType = null;
    let pinEntityId = null;
    let enrichedQuery = userQuery;
    let isAmbientPin = false;

    // Entity Extractors (Stage 5 priority)
    if (extractedEntities.vendor) {
        pinType = 'vendor';
        pinEntityId = extractedEntities.vendor;
    } else if (extractedEntities.category) {
        pinType = 'category';
        pinEntityId = extractedEntities.category;
    }
    // Fallback to Ambient Context
    else if (activeTopic.type === 'vendor' && activeTopic.vendor) {
        isAmbientPin = true;
        pinType = 'vendor';
        pinEntityId = activeTopic.vendor;
    } else if (activeTopic.type === 'product' && activeTopic.category_id) {
        isAmbientPin = true;
        pinType = 'category';
        pinEntityId = activeTopic.category_id;
    }

    // =========================================================================
    // Stage 1b: Vector Search (with Transformer)
    // =========================================================================
    console.log(`[RAG] Searching for: "${enrichedQuery}" (Pin: ${pinType} | ${pinEntityId})`);

    // 1. Get query embedding
    let queryEmbedding = null;
    try {
        const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://localhost:3009';
        const { default: axios } = await import('axios');
        const res = await axios.post(`${TRANSFORMER_URL}/embed`, {
            text: enrichedQuery,
            purpose: 'query'
        });
        if (res.data?.embeddings?.length > 0) {
            queryEmbedding = res.data.embeddings[0];
        }
    } catch (e) {
        console.warn("[RAG] Failed to embed query:", e.message);
    }

    let chunks = [];
    if (queryEmbedding) {
        const vectorStr = `[${queryEmbedding.join(',')}]`;

        let ambientChunk = null;
        if (isAmbientPin && pinType && pinEntityId) {
            try {
                const ambRes = await pool.query(`SELECT id, type, entity_id, entity_name, content, 1 - (embedding <=> $1::vector) AS similarity FROM ai_knowledge_chunks WHERE tenant_id = $2 AND type = $3 AND (id = $4 OR entity_id::text = $4) LIMIT 1`, [vectorStr, tenantId, pinType, pinEntityId]);
                if (ambRes.rows.length > 0) ambientChunk = ambRes.rows[0];
            } catch (e) {
                console.error("[RAG] Failed to evaluate ambient pin similarity:", e.message);
            }
        }

        let sql = `
            SELECT id, type, entity_id, entity_name, content, 
                   1 - (embedding <=> $1::vector) AS similarity 
            FROM ai_knowledge_chunks 
            WHERE tenant_id = $2
        `;
        let params = [vectorStr, tenantId];

        if (pinType && pinEntityId && !isAmbientPin) {
            // Explicit Pin (via NLU Tool Extraction) — definitively constrain search
            sql += ` AND type = $3 AND (id = $4 OR entity_id::text = $4 OR entity_name ILIKE $4)`;
            params.push(pinType, pinEntityId);
        } else {
            // Unpinned OR Ambient Pin — open search (broad fetch, filtered later)
            sql += ` AND 1 - (embedding <=> $1::vector) > 0.50`;
        }

        sql += ` ORDER BY similarity DESC LIMIT 8`; // Fetch more candidates for smart selection

        try {
            const result = await pool.query(sql, params);
            let allRows = result.rows;

            // --- SMART CONTEXT SWITCH EVALUATION ---
            if (isAmbientPin && ambientChunk) {
                if (allRows.length === 0) {
                    allRows = [ambientChunk];
                    console.log(`[RAG] No organic hits. Sourcing ambient pinned anchor: ${ambientChunk.id}`);
                } else {
                    const topOrganic = allRows[0];
                    const margin = topOrganic.similarity - ambientChunk.similarity;
                    if (margin > 0.08) {
                        console.log(`[RAG] Context switch matched! Organic hit (${topOrganic.id}) beat ambient pin (${ambientChunk.id}) by ${margin.toFixed(3)}`);
                    } else {
                        console.log(`[RAG] Maintaining ambient pin. Margin was only ${margin.toFixed(3)} (Organic: ${topOrganic.similarity.toFixed(3)}, Pin: ${ambientChunk.similarity.toFixed(3)})`);
                        allRows = [ambientChunk, ...allRows.filter(r => r.id !== ambientChunk.id)];
                    }
                }
            }

            if (allRows.length === 0) {
                chunks = [];
            } else {
                const anchor = allRows[0];
                const anchorType = anchor.type;
                const CROSS_TYPE_MARGIN = 0.12;

                const selected = [anchor];
                let crossTypeCount = 0;

                for (let i = 1; i < allRows.length; i++) {
                    const row = allRows[i];
                    if (selected.length >= 3) break;

                    if (row.type === anchorType) {
                        // Same type: skip — anchor already represents this group
                        continue;
                    }

                    // Cross-type: include if within margin of anchor
                    if (anchor.similarity - row.similarity <= CROSS_TYPE_MARGIN && crossTypeCount < 2) {
                        selected.push(row);
                        crossTypeCount++;
                    }
                }

                chunks = selected;
            }
        } catch (dbErr) {
            console.error("[RAG] Vector DB search failed:", dbErr.message);
        }
    }

    if (chunks.length === 0) {
        // Fallback: If Vector fails, or no chunks found, act as a standard AI fallback.
        console.log("[RAG] No chunks matched above threshold. Proceeding without context.");
        return null;
    }

    const topChunk = chunks[0];

    // Gate: For unpinned queries, wait, the SQL already filters > 0.78, so this is mostly a sanity check
    const MIN_SIMILARITY = (pinType && !isAmbientPin) ? 0.45 : 0.78;
    if (topChunk.similarity < MIN_SIMILARITY && !isAmbientPin) {
        console.log(`[RAG] Top hit similarity ${topChunk.similarity.toFixed(3)} below threshold (${MIN_SIMILARITY}). Skipping hooks.`);
        return null;
    }

    console.log(`[RAG] Top hit: ${topChunk.id} (sim: ${topChunk.similarity.toFixed(4)})`);

    // =========================================================================
    // Stage 2: Live Hook Execution
    // =========================================================================
    // (Map types to mock hooks)
    const liveHooks = [];
    const uiHooks = [];
    if (topChunk.type === 'vendor') {
        liveHooks.push('fetch_vendor_stats');
        uiHooks.push('ui.vendor_store', 'ui.vendor_contact');
    } else if (topChunk.type === 'category') {
        liveHooks.push('fetch_category_stats');
        uiHooks.push('ui.shop_category');
    } else if (topChunk.type === 'collection') {
        liveHooks.push('fetch_collection_stats');
        uiHooks.push('ui.shop_collection');
    } else if (topChunk.type === 'store_policy') {
        liveHooks.push('fetch_store_status');
        uiHooks.push('ui.support_ticket');
    }

    const liveData = await executeLiveHooks(liveHooks, topChunk);

    // =========================================================================
    // Stage 3: UI Hook Engine
    // =========================================================================
    const resolvedButtons = resolveUiHooks(uiHooks, liveData, topChunk);

    // =========================================================================
    // Stage 4: Summarizer Layer
    // =========================================================================
    const staticProse = chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c.content}`).join('\n\n');
    let liveProse = "";
    const inlineNotices = [];

    if (liveData.rating) {
        liveProse += `[LIVE] ${topChunk.entity_name}'s current rating is ${liveData.rating} stars with ${liveData.total_sold} total sales.\n`;
    }
    if (liveData.support_online !== undefined) {
        liveProse += `[LIVE] Store operations are normal. Support is online: ${liveData.support_online}.\n`;
        if (liveData.carrier_delays) {
            inlineNotices.push("Note: Inform the customer there are current carrier delays.");
        }
    }

    const contextNarrative = `What I know from our knowledge base:\n${staticProse}\n\n${liveProse}`.trim();
    const systemPrompt = `You are a helpful e-commerce store assistant. Read the provided store knowledge and answer the user's query playfully and concisely (1-3 sentences max).
    
    ${contextNarrative}
    
    ${inlineNotices.join('\n')}`;

    // =========================================================================
    // Stage 5 (conditional): Ambient Context Write
    // =========================================================================
    // Always write ambient context — regardless of llmSummary mode
    if (topChunk.type === 'vendor') {
        await stateManager.setActiveTopic(sessionId, {
            type: 'vendor',
            vendor: topChunk.entity_id,
            vendor_name: topChunk.entity_name,
            vendor_id: topChunk.entity_id
        });
    } else if (topChunk.type === 'category' || topChunk.type === 'collection') {
        await stateManager.setActiveTopic(sessionId, {
            type: 'product',
            category_id: topChunk.entity_id,
            category_label: topChunk.entity_name
        });
    }

    // =========================================================================
    // Stage 6 (optional): LLM Generation
    // When llmSummary is false, skip internal LLM. Return raw context so DCO
    // personality layer handles the final output with proper Be3 grounding.
    // =========================================================================
    if (!llmSummary) {
        console.log('[RAG] llmSummary=false — passing context narrative to DCO personality layer.');
        const payload = {
            rag_context: contextNarrative,
            rag_entity: {
                type: topChunk.type,
                name: topChunk.entity_name,
                id: topChunk.entity_id
            },
            // directResponse deliberately omitted — goes through DCO
        };
        if (resolvedButtons.length > 0) {
            payload.whatsapp = { type: 'button', buttons: resolvedButtons };
        }
        return payload;
    }

    // llmSummary=true path (default) — internal LLM generates the response
    console.log('[RAG] Engaging LLM...');
    const aiResponse = await queryAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userQuery }
    ], 300, 0.7);

    // =========================================================================
    // Stage 7: Response Assembly (directResponse path)
    // =========================================================================
    const finalPayload = {
        message: aiResponse,
        directResponse: true // Flags that this goes straight to the user
    };

    if (resolvedButtons.length > 0) {
        finalPayload.whatsapp = {
            type: 'button',
            message: aiResponse,
            buttons: resolvedButtons
        };
    }

    return finalPayload;
}

/**
 * rawSearch — returns the top matched chunks without hooks or LLM.
 * Used by the REPL /raw mode.
 */
async function rawSearch(sessionId, userQuery, extractedEntities = {}) {
    const tenantId = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000000';

    const activeTopic = (await stateManager.getActiveTopic(sessionId)) || {};
    let pinType = null;
    let pinEntityId = null;
    let enrichedQuery = userQuery;
    let isAmbientPin = false;

    if (extractedEntities.vendor) {
        pinType = 'vendor';
        pinEntityId = extractedEntities.vendor;
    } else if (extractedEntities.category) {
        pinType = 'category';
        pinEntityId = extractedEntities.category;
    } else if (activeTopic.type === 'vendor' && activeTopic.vendor) {
        isAmbientPin = true;
        pinType = 'vendor';
        pinEntityId = activeTopic.vendor;
    } else if (activeTopic.type === 'product' && activeTopic.category_id) {
        isAmbientPin = true;
        pinType = 'category';
        pinEntityId = activeTopic.category_id;
    }

    let queryEmbedding = null;
    try {
        const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://localhost:3009';
        const { default: axios } = await import('axios');
        const res = await axios.post(`${TRANSFORMER_URL}/embed`, { text: enrichedQuery, purpose: 'query' });
        if (res.data?.embeddings?.length > 0) queryEmbedding = res.data.embeddings[0];
    } catch (e) {
        return { error: `Embedding failed: ${e.message}` };
    }

    if (!queryEmbedding) return { chunks: [], message: 'No embedding generated.' };

    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // Pre-fetch ambient pin's similarity against THIS query (two-lookup context switch)
    let ambientChunk = null;
    if (isAmbientPin && pinType && pinEntityId) {
        try {
            const ambRes = await pool.query(`SELECT id, type, entity_id, entity_name, content, 1 - (embedding <=> $1::vector) AS similarity FROM ai_knowledge_chunks WHERE tenant_id = $2 AND type = $3 AND (id = $4 OR entity_id::text = $4) LIMIT 1`, [vectorStr, tenantId, pinType, pinEntityId]);
            if (ambRes.rows.length > 0) ambientChunk = ambRes.rows[0];
        } catch (e) { }
    }

    let sql = `SELECT id, type, entity_id, entity_name, content, 1 - (embedding <=> $1::vector) AS similarity FROM ai_knowledge_chunks WHERE tenant_id = $2`;
    let params = [vectorStr, tenantId];

    if (pinType && pinEntityId && !isAmbientPin) {
        sql += ` AND type = $3 AND (id = $4 OR entity_id::text = $4 OR entity_name ILIKE $4)`;
        params.push(pinType, pinEntityId);
    } else {
        sql += ` AND 1 - (embedding <=> $1::vector) > 0.50`;
    }

    sql += ` ORDER BY similarity DESC LIMIT 8`;

    try {
        const result = await pool.query(sql, params);

        let allRows = result.rows;

        // --- SMART CONTEXT SWITCH EVALUATION ---
        if (isAmbientPin && ambientChunk) {
            if (allRows.length === 0) {
                ambientChunk.id += ' (AMBIENT FALLBACK)';
                allRows = [ambientChunk];
            } else {
                const topOrganic = allRows[0];
                const margin = topOrganic.similarity - ambientChunk.similarity;
                if (margin <= 0.08) {
                    ambientChunk.id += ' (AMBIENT RETAINED)';
                    allRows = [ambientChunk, ...allRows.filter(r => r.id !== ambientChunk.id)];
                }
            }
        }

        let selected = [];
        let dropped = [];

        if (allRows.length > 0) {
            const anchor = allRows[0];
            const anchorType = anchor.type;
            const CROSS_TYPE_MARGIN = 0.12;

            selected.push(anchor);
            let crossTypeCount = 0;

            for (let i = 1; i < allRows.length; i++) {
                const row = allRows[i];
                if (selected.length >= 3) {
                    dropped.push(row);
                    continue;
                }

                if (row.type === anchorType) {
                    dropped.push(row);
                    continue;
                }

                if (anchor.similarity - row.similarity <= CROSS_TYPE_MARGIN && crossTypeCount < 2) {
                    selected.push(row);
                    crossTypeCount++;
                } else {
                    dropped.push(row);
                }
            }
        }

        return {
            query: enrichedQuery,
            pin: pinType ? `${pinType}:${pinEntityId}${isAmbientPin ? ' (ambient)' : ''}` : null,
            selected: selected,
            dropped: dropped
        };
    } catch (e) {
        return { error: e.message };
    }
}

module.exports = {
    processRAGQuery,
    rawSearch
};

