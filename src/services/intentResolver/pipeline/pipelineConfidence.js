/**
 * Pipeline Confidence Calculator
 * 
 * Computes a multi-directional confidence score (0–100) from pipeline outputs.
 * Called ONCE at the end of the pipeline — no per-stage instrumentation needed.
 * 
 * Reads all available pipeline artifacts (resolved statements, transformer context,
 * IntelliSense results, fuzzy corrections, etc.) and applies penalty/bonus rules.
 * 
 * Score meaning:
 *   45+ = Confident (sentinel can skip)
 *   <45 = Low confidence (sentinel should evaluate)
 * 
 * Currently: background-only (logged, not used for sentinel toggling).
 */

/**
 * Calculate pipeline confidence from all pipeline outputs.
 * 
 * @param {Object} pd - All pipeline artifacts collected by resolveAndMap
 * @returns {{ score: number, verdict: string, signalCount: number, signals: Array }}
 */
function calculatePipelineConfidence(pd) {
    const {
        userMessage,
        afterFuzzy,
        senseResult,
        batchedSemanticContext,
        resolvedStatements,
        normalizedStatements,
        portedStatements,
        bledStatements,
        storeContext,
        isEngineered
    } = pd;

    let score = 0;
    const signals = [];

    const record = (stage, delta, reason) => {
        score += delta;
        signals.push({ stage, delta, reason, scoreAfter: Math.round(score) });
    };

    // ─── ENGINEERED TOKEN (Button Click) ───
    if (isEngineered) {
        return {
            score: 100,
            verdict: 'CONFIDENT',
            signalCount: 1,
            signals: [{ stage: 'Engineered Token', delta: '+0', reason: 'Button click — absolute confidence' }]
        };
    }

    // ═══════════════════════════════════════════════
    // PHASE A: Pre-Processing Quality
    // ═══════════════════════════════════════════════

    // A1. Fuzzy correction applied — user had typos
    if (afterFuzzy && userMessage && afterFuzzy !== userMessage) {
        record('Fuzzy', -5, `Typo corrections applied: "${userMessage}" → "${afterFuzzy}"`);
    }

    // A2. IntelliSense analysis
    if (senseResult && Array.isArray(senseResult.statements)) {
        const stmts = senseResult.statements;
        const totalProducts = stmts.reduce((acc, s) => acc + (s.products?.length || 0), 0);

        // A2a. Multi-statement split — increases complexity
        if (stmts.length > 1) {
            record('IntelliSense', -3, `Multi-statement split (${stmts.length} statements) — complex query`);
        }

        // A2b. No products extracted when text has content
        if (totalProducts === 0 && userMessage && userMessage.length > 10) {
            record('IntelliSense', -3, 'IntelliSense found 0 products — entity detection relies on deterministic only');
        }
    } else if (!senseResult) {
        // IntelliSense didn't run at all
        record('IntelliSense', -5, 'IntelliSense unavailable — no LLM pre-processing');
    }

    // A3. Transformer availability & confidence
    if (!batchedSemanticContext || !batchedSemanticContext.available) {
        record('Transformer', -10, 'Transformer service unreachable — no semantic classification');
    } else if (batchedSemanticContext.results && batchedSemanticContext.results.length > 0) {
        const firstResult = batchedSemanticContext.results[0];
        if (firstResult && Array.isArray(firstResult.classification) && firstResult.classification.length >= 2) {
            const topScore = firstResult.classification[0]?.score || 0;
            const secondScore = firstResult.classification[1]?.score || 0;
            const gap = topScore - secondScore;

            if (gap < 0.04) {
                record('Transformer', -5, `Low confidence gap (${gap.toFixed(4)}) — transformer is uncertain between top intents`);
            } else if (gap > 0.10) {
                record('Transformer', +5, `High confidence gap (${gap.toFixed(4)}) — transformer is decisive`);
            }

            // A3b. Transformer top score itself is weak
            if (topScore < 0.3) {
                record('Transformer', -5, `Weak top score (${topScore.toFixed(4)}) — transformer has no strong match`);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // PHASE B: Entity & Intent Resolution
    // ═══════════════════════════════════════════════

    if (resolvedStatements && resolvedStatements.length > 0) {
        const primary = resolvedStatements[0];
        const candidates = primary.candidates || [];
        const entities = primary.pipelineEntities || [];
        const breakdown = candidates[0]?.breakdown;

        // B1. Entity count — too few entities means sparse understanding
        const meaningfulEntities = entities.filter(e =>
            ['category', 'vendor', 'resolved_product', 'brand', 'action', 'clause'].includes(e.type)
        );
        if (meaningfulEntities.length === 0) {
            record('Entity Extraction', -10, 'Zero meaningful entities — pipeline has nothing to work with');
        } else if (meaningfulEntities.length === 1) {
            record('Entity Extraction', -5, `Only 1 meaningful entity (${meaningfulEntities[0].type}: "${meaningfulEntities[0].value || meaningfulEntities[0].verb}") — sparse signal`);
        } else if (meaningfulEntities.length >= 3) {
            record('Entity Extraction', +3, `Rich entity extraction (${meaningfulEntities.length} entities) — strong signal`);
        }

        // B2. Category quality / tier / source
        const categoryEntity = entities.find(e => e.type === 'category');
        if (categoryEntity) {
            const quality = Number(categoryEntity.quality);
            const source = categoryEntity.source;
            const catMeta = categoryEntity.matchMeta;
            
            // Helper to get true backend category name
            const getCatLabel = (id, fallback) => {
                let trueName = fallback?.toLowerCase() || '';
                if (id && storeContext?.CATEGORIES) {
                    const catObj = storeContext.CATEGORIES[id] || Object.values(storeContext.CATEGORIES).find(c => c.id === id);
                    if (catObj) trueName = (catObj.label || catObj.slug || trueName).toLowerCase();
                }
                return trueName;
            };

            const winnerLabel = getCatLabel(categoryEntity.id, categoryEntity.value);

            if (source === 'SEMANTIC_KICKSTART') {
                // Category came entirely from transformer — no deterministic confirmation
                record('Category', -10, `Category from Semantic Kickstart — no deterministic match, transformer-only`);
            } else if (Number.isFinite(quality) && quality < 0.5) {
                // Low quality = fuzzy Tier 2+ match
                const tier = catMeta?.lexTier || 'unknown';
                const layer = catMeta?.layer || 'unknown';
                record('Category', -5, `Category quality ${quality.toFixed(2)} (${layer}, tier ${tier}) — fuzzy match`);
            } else if (Number.isFinite(quality) && quality >= 1.0) {
                record('Category', +5, 'Category matched via Tier 1 (exact) — high precision');
            }

            // B2b. Category's own score strength
            if (catMeta && typeof catMeta.score === 'number') {
                if (catMeta.score < 3.0) {
                    record('Category', -3, `Category match score weak (${catMeta.score.toFixed(2)}) — borderline detection`);
                }
            }

            // B2c. High-scoring category lost to tier
            if (Array.isArray(categoryEntity._tierRejects) && categoryEntity._tierRejects.length > 0) {
                const worst = categoryEntity._tierRejects.reduce((a, b) => b.score > a.score ? b : a);
                const worstLabel = getCatLabel(worst.catId, worst.phrase);
                record('Category Tier', -8, `"${worstLabel}" had score ${worst.score.toFixed(2)} (tier ${worst.tier}) but lost to "${winnerLabel}" (tier ${categoryEntity.matchMeta?.lexTier || '?'}) — tier dominated`);
            }
        }

        // B3. Residual words — orphan product signals
        const residualCount = (primary.extractedParams?.product_name || '').split(/\s+/).filter(Boolean).length;
        const hasResidualProduct = entities.length > 0 && !entities.some(e => e.type === 'resolved_product');

        // B4. Signal density gate
        if (primary.metrics) {
            const sd = primary.metrics.signalDensity;
            if (sd !== undefined && sd === 0) {
                record('Signal Density', -10, 'Signal density = 0 — no action verbs, no keyword hits (entity noise only)');
            } else if (sd !== undefined && sd < 0.3 && primary.metrics.entityCount > 0) {
                record('Signal Density', -5, `Low signal density (${sd.toFixed(2)}) — few intentional signals relative to entities`);
            }
        }

        // B5. Winner score gap — is the winner clearly ahead?
        if (candidates.length >= 2) {
            const winnerScore = candidates[0]?.score || 0;
            const secondScore = candidates[1]?.score || 0;
            const gap = winnerScore - secondScore;

            if (gap < 1.0) {
                record('Intent Competition', -15, `Near-tie — winner "${candidates[0]?.intentName}" beat "${candidates[1]?.intentName}" by only ${gap.toFixed(2)}`);
            } else if (gap < 2.0) {
                record('Intent Competition', -10, `Tight race — winner beat 2nd place by ${gap.toFixed(2)} points`);
            } else if (gap > 8.0) {
                record('Intent Competition', +5, `Clear winner — beat 2nd by ${gap.toFixed(2)} points`);
            }
        } else if (candidates.length === 1) {
            // Only one candidate — no competition at all
            record('Intent Competition', +3, 'Single candidate — no competition (decisive)');
        }

        // B6. Orphan product fallback
        const matchedKw = primary.matchedKeywords || [];
        if (matchedKw.includes('orphan_product') || matchedKw.includes('implicit')) {
            record('Orphan Fallback', -15, 'Intent won via orphan fallback — no direct keyword/action match');
        }

        // B7. Semantic-only winner (no deterministic evidence)
        if (breakdown) {
            if (breakdown.deterministic === 0 && breakdown.semantic > 0) {
                record('Semantic-Only', -20, `Winner has 0 deterministic score (semantic: ${breakdown.semantic.toFixed(2)}) — entirely ML-driven`);
            } else if (breakdown.deterministic > 0 && breakdown.semantic > 0) {
                // Both contributed — that's a good sign
                record('Dual Scoring', +5, `Winner has both deterministic (${breakdown.deterministic.toFixed(2)}) and semantic (${breakdown.semantic.toFixed(2)}) support`);
            }
        }

        // B8. Deterministic breakdown audit — check if winner relied on suppression rules
        if (breakdown?.deterministicAudit && Array.isArray(breakdown.deterministicAudit)) {
            const hasNegativePenalty = breakdown.deterministicAudit.some(a => a.value < -3.0);
            const hasSlotMatch = breakdown.deterministicAudit.some(a => a.reason && a.reason.includes('slot match'));
            
            if (hasSlotMatch) {
                record('Schema Fit', +3, 'Winner matched required/optional parameter slots — schema alignment');
            }
            if (hasNegativePenalty) {
                record('Schema Fit', -3, 'Winner\'s scoring involved heavy penalties — contested win');
            }
        }

        // B9. Winner total score strength
        const winnerTotalScore = primary.score || 0;
        if (winnerTotalScore > 15) {
            record('Strong Signal', +5, `Winner score is very high (${winnerTotalScore.toFixed(2)}) — strong conviction`);
        } else if (winnerTotalScore < 3) {
            record('Weak Signal', -8, `Winner score is very low (${winnerTotalScore.toFixed(2)}) — weak conviction`);
        }

        // ═══════════════════════════════════════════════
        // PHASE C: Cross-System Agreement Checks
        // ═══════════════════════════════════════════════

        // C1. Transformer ↔ Schema agreement on winning intent
        if (batchedSemanticContext?.results?.[0]?.classification?.length > 0) {
            const transformerWinner = batchedSemanticContext.results[0].classification[0]?.intentName;
            const schemaWinner = primary.intentName;

            if (transformerWinner && schemaWinner) {
                if (transformerWinner === schemaWinner) {
                    record('Transformer↔Schema', +15, `Both agree on "${schemaWinner}"`);
                } else {
                    // Check if transformer's winner is at least in our top 3
                    const inTop3 = candidates.slice(0, 3).some(c => c.intentName === transformerWinner);
                    if (inTop3) {
                        record('Transformer↔Schema', -5, `Partial disagreement — Transformer: "${transformerWinner}" (in top 3), Schema: "${schemaWinner}"`);
                    } else {
                        record('Transformer↔Schema', -10, `Full disagreement — Transformer: "${transformerWinner}", Schema: "${schemaWinner}"`);
                    }
                }
            }
        }

        // C2. PIE ↔ IntelliSense product agreement
        // PIE discovers a product name independently from residual words.
        // IntelliSense (LLM) extracts a product name from the user message.
        // If PIE defers to IntelliSense, they always agree — but PIE's
        // _pie_product_name is captured BEFORE the override, so this is
        // a genuine cross-system signal.
        const pieProductName = primary.extractedParams?._pie_product_name;
        const intelliProducts = senseResult?.statements?.[0]?.products || [];
        const intelliProductName = intelliProducts[0]?.name?.toLowerCase();

        if (pieProductName && intelliProductName) {
            const pieLower = pieProductName.toLowerCase();
            const overlap = pieLower.includes(intelliProductName) || intelliProductName.includes(pieLower);
            if (overlap) {
                record('PIE↔IntelliSense', +10, `Product agreement: PIE found "${pieProductName}", IntelliSense found "${intelliProducts[0].name}"`);
            } else {
                record('PIE↔IntelliSense', -5, `Product disagreement — PIE: "${pieProductName}", IntelliSense: "${intelliProducts[0].name}"`);
            }
        } else if (pieProductName && !intelliProductName) {
            record('PIE↔IntelliSense', -3, `PIE found "${pieProductName}" but IntelliSense found no product`);
        } else if (!pieProductName && intelliProductName) {
            // PIE had nothing but IntelliSense did — IntelliSense is the only source
            record('PIE↔IntelliSense', -3, `PIE found no product but IntelliSense found "${intelliProducts[0].name}" — single-source dependency`);
        }

        // C3. Transformer ↔ Entity Extractor category agreement
        const transformerCategories = batchedSemanticContext?.results?.[0]?.entities?.category || [];
        if (categoryEntity && transformerCategories.length > 0) {
            const extractorCatId = categoryEntity.id;
            
            // Resolve the true canonical category name from the store context (in-memory lookup, no API call)
            // Helper defined in B2, but just safely doing inline lookup if categoryEntity exists
            let trueCategoryName = categoryEntity.value?.toLowerCase() || '';
            if (extractorCatId && storeContext?.CATEGORIES) {
                const catObj = storeContext.CATEGORIES[extractorCatId] || Object.values(storeContext.CATEGORIES).find(c => c.id === extractorCatId);
                if (catObj) {
                    trueCategoryName = (catObj.label || catObj.slug || trueCategoryName).toLowerCase();
                }
            }

            const transformerCat = transformerCategories[0]?.toLowerCase();

            if (trueCategoryName && transformerCat) {
                const catMatches = trueCategoryName.includes(transformerCat) || transformerCat.includes(trueCategoryName) || 
                                   (trueCategoryName.replace(/s$/, '') === transformerCat.replace(/s$/, ''));
                if (catMatches) {
                    record('Category Agreement', +5, `Entity Extractor and Transformer agree on category: "${trueCategoryName}"`);
                } else {
                    record('Category Agreement', -5, `Category disagreement — Extractor matched "${trueCategoryName}" (via phrase "${categoryEntity.value}"), Transformer guessed "${transformerCat}"`);
                }
            }
        }
    } else {
        // No statements resolved at all
        record('No Resolution', -30, 'Pipeline resolved zero statements — no intent matched');
    }

    // ═══════════════════════════════════════════════
    // PHASE D: Post-Resolution Signals
    // ═══════════════════════════════════════════════

    if (normalizedStatements && normalizedStatements.length > 0) {
        const primary = normalizedStatements[0];
        const params = primary.parameters || {};

        // D1. Parental pivot (empty category)
        if (params._pivoted_from) {
            record('Inventory', -8, `Parental pivot — "${params._pivoted_from}" was empty, broadened to "${params._pivoted_to}"`);
        }

        // D3. Empty category detected
        if (params._empty_category) {
            record('Inventory', -5, `Category "${params._empty_category_label}" has 0 products`);
        }

        // D4. Ambient context injected
        const entities = primary.pipelineEntities || [];
        const ambientCount = entities.filter(e => e.source === 'AMBIENT_CONTEXT').length;
        if (ambientCount > 0) {
            record('Ambient Context', -5, `${ambientCount} phantom entities injected from ambient context — implicit topic`);
        }

        // D5. Clause words present — refining signal
        if (params.clause_words && Array.isArray(params.clause_words) && params.clause_words.length > 0) {
            record('Clause Refinement', +2, `${params.clause_words.length} clause(s) detected — refined search`);
        }
    }

    // D6. Intent porting (search→cart pivot)
    if (portedStatements && resolvedStatements) {
        for (let i = 0; i < Math.min(portedStatements.length, resolvedStatements.length); i++) {
            if (portedStatements[i].intentName !== resolvedStatements[i].intentName) {
                record('Intent Porting', -3, `Intent ported: "${resolvedStatements[i].intentName}" → "${portedStatements[i].intentName}"`);
                break;
            }
        }
    }

    // D7. Parameter bleeding
    if (bledStatements) {
        const bled = bledStatements.filter(s => s.bledParams && s.bledParams.length > 0);
        if (bled.length > 0) {
            const params = bled[0].bledParams;
            record('Param Bleeding', -3, `${params.length} param(s) bled from another statement: ${params.join(', ')}`);
        }
    }

    // ─── FINAL ───
    const finalScore = Math.round(score);
    return {
        score: finalScore,
        verdict: finalScore >= 0 ? 'CONFIDENT' : 'LOW_CONFIDENCE',
        signalCount: signals.length,
        signals: signals
            .filter(s => s.reason)
            .map(s => ({
                stage: s.stage,
                delta: s.delta > 0 ? `+${s.delta}` : `${s.delta}`,
                reason: s.reason,
                scoreAfter: s.scoreAfter
            }))
    };
}

module.exports = { calculatePipelineConfidence };
