const { ATTRIBUTES, CATEGORIES } = require('../../../context/storeContext');
const stateManager = require('../../../state/stateManager');
const { resolveFacetAttribute } = require('../../../utils/semanticFacetResolver');
const { normalizeVendor } = require('../../../utils/normalization');
const { callBackendAPI } = require('../../../utils/apiClient');

function encodeBase64Url(str) {
    return Buffer.from(String(str || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

const facetsTool = {
    description: 'Discover available options (facets) for product attributes like storage, brand, or color. Runs the same search as product.search but focuses on facet aggregation.',
    params: {
        facet_target: { type: 'string', description: 'The attribute to list (e.g., storage, brand, color)' },
        query: { type: 'string', description: 'Product name/query to scope the facet search' },
        category: { type: 'string', description: 'Category to scope the facet search (ID or slug)' },
        vendor: { type: 'string', description: 'Vendor to scope the facet search' },
        attributes: { type: 'object', description: 'Dynamic attribute filters (e.g., { "b:i": "infinix" })' },
        product_id: { type: 'string', description: 'Specific product ID to scope the facet search' },
        _resolved_product_id: { type: 'string', description: 'Internal resolved product ID' }
    },
    handler: async (params, context) => {
        const { facet_target, query, category, vendor, attributes = {}, product_id, _resolved_product_id } = params;
        const targetId = _resolved_product_id || product_id;

        // ── 1. Resolve facet_target (plural → canonical) ──
        let canonicalCode = facet_target ? facet_target.toLowerCase().trim() : null;
        if (canonicalCode && !ATTRIBUTES[canonicalCode]) {
            const singular = canonicalCode.replace(/s$/, '');
            if (ATTRIBUTES[singular]) {
                canonicalCode = singular;
            } else {
                for (const [code, attr] of Object.entries(ATTRIBUTES)) {
                    if (attr.label?.toLowerCase() === canonicalCode || attr.label?.toLowerCase() === singular) {
                        canonicalCode = code;
                        break;
                    }
                }
                if (!ATTRIBUTES[canonicalCode]) {
                    try {
                        const resolved = resolveFacetAttribute(canonicalCode);
                        if (resolved) canonicalCode = resolved;
                    } catch (_) { }
                }
            }
        }
        const attrDef = ATTRIBUTES[canonicalCode];
        const attrCode = attrDef ? attrDef.code : canonicalCode;
        const resolvedLabel = attrDef ? attrDef.label : (canonicalCode || 'attribute');

        // ── 1.2. Short-circuit: Check State Cache first ──
        if (targetId && context?.sessionId) {
            try {
                const state = await stateManager.getState(context.sessionId);

                // Strategy A: Check search_context.product_attributes_map (explicitly populated during search)
                const sc = state?.search_context;
                if (sc?.product_attributes_map && sc.product_attributes_map[targetId]) {
                    const pAttrs = sc.product_attributes_map[targetId];
                    const val = pAttrs[attrCode] || pAttrs[canonicalCode] || pAttrs[resolvedLabel.toLowerCase()];
                    if (val) {
                        const isVendor = attrCode === 'vendor' || canonicalCode === 'vendor' || resolvedLabel.toLowerCase() === 'vendor';
                        const btnId = isVendor ? `__vendor:products:${encodeBase64Url(val)}__` : '__nav:results__';
                        const btnTitle = isVendor ? `See ${val}'s products` : 'See products';

                        return {
                            message: `The **${resolvedLabel}** for this product is **${val}**.`,
                            facet_target: resolvedLabel,
                            options: [{ value: val, count: 1 }],
                            scope: 'product',
                            scope_label: targetId,
                            source: 'state_cache',
                            whatsapp: {
                                type: 'button',
                                buttons: [{ id: btnId, title: btnTitle }]
                            }
                        };
                    }
                }

                // Strategy B: Check last_search results
                const lastResults = state?.product_context?.last_search?.results;
                if (Array.isArray(lastResults)) {
                    const product = lastResults.find(p => (p.id === targetId || p.handle === targetId || p.product_id === targetId));
                    if (product) {
                        const pAttrs = product.attributes || product.metadata?.attributes || {};
                        const val = pAttrs[attrCode] || pAttrs[canonicalCode] || pAttrs[resolvedLabel.toLowerCase()];
                        if (val) {
                            const isVendor = attrCode === 'vendor' || canonicalCode === 'vendor' || resolvedLabel.toLowerCase() === 'vendor';
                            const btnId = isVendor ? `__vendor:products:${encodeBase64Url(val)}__` : '__nav:results__';
                            const btnTitle = isVendor ? `See ${val}'s products` : 'See products';

                            return {
                                message: `The **${resolvedLabel}** for **${product.name || product.title}** is **${val}**.`,
                                facet_target: resolvedLabel,
                                options: [{ value: val, count: 1 }],
                                scope: 'product',
                                scope_label: product.name || targetId,
                                source: 'state_cache',
                                whatsapp: {
                                    type: 'button',
                                    buttons: [{ id: btnId, title: btnTitle }]
                                }
                            };
                        }
                    }
                }
            } catch (e) {
                console.error('[product.facets] Cache check failed:', e.message);
            }
        }

        // ── 2. Build search params — category is already resolved by pipeline ──
        const CATS = context.CATEGORIES || CATEGORIES || {};
        const catKey = category ? Object.keys(CATS).find(k => CATS[k].id === category || CATS[k].slug === category) : null;
        const cat = catKey ? CATS[catKey] : null;
        const catLabel = cat ? cat.label : null;

        const queryStr = Array.isArray(query) ? query[0] : query;

        const searchParams = new URLSearchParams();
        searchParams.append('per_page', '1'); // We only need facets, not products
        searchParams.append('type', 'product');
        if (queryStr) searchParams.append('q', queryStr);
        if (category) searchParams.append('category_id', cat?.slug || category);
        if (targetId) searchParams.append('product_id', targetId);

        if (vendor) {
            const resolvedVendor = normalizeVendor(vendor);
            if (resolvedVendor) searchParams.append('tag', resolvedVendor);
        }
        const safeAttributes = attributes || {};
        Object.entries(safeAttributes).forEach(([key, val]) => {
            const finalVal = key === 'vendor' ? normalizeVendor(val) : String(val);
            searchParams.append(`attribute.${key}`, finalVal);
        });

        // ── 3. Call /search (same endpoint product.search uses for facets) ──
        let facetData = null;
        try {
            const result = await callBackendAPI(`/search?${searchParams.toString()}`);
            if (result?.success) {
                facetData = result.data?.facets || null;
            }
        } catch (err) {
            console.error(`[product.facets] Search API error:`, err.message);
        }

        if (!facetData || !Array.isArray(facetData.attributes) || facetData.attributes.length === 0) {
            if (attrDef && attrDef.predefined_values && attrDef.predefined_values.length > 0) {
                const predefined = attrDef.predefined_values.map(pv => pv.label || pv.value || pv);
                const scopeDesc = catLabel ? ` in **${catLabel}**` : queryStr ? ` for "${queryStr}"` : '';
                return {
                    message: `We have these **${resolvedLabel}** options${scopeDesc}: ${predefined.join(', ')}.`,
                    facet_target: resolvedLabel,
                    options: predefined.map(v => ({ value: v })),
                    scope: catLabel ? 'category' : queryStr ? 'query' : 'global',
                    scope_label: catLabel || queryStr || null,
                    source: 'predefined',
                    whatsapp: {
                        type: 'button',
                        buttons: [{ id: '__nav:results__', title: 'See products' }]
                    }
                };
            }
            return {
                message: `I couldn't find any specific **${resolvedLabel}** options${catLabel ? ` in ${catLabel}` : ''}${queryStr ? ` for "${queryStr}"` : ''} at the moment.`,
                whatsapp: {
                    type: 'button',
                    buttons: [{ id: '__nav:results__', title: 'See products' }]
                }
            };
        }

        // ── 4. Find the target attribute in backend facet response ──
        let targetFacet = facetData.attributes.find(
            a => a.code === attrCode || a.code === canonicalCode || a.label?.toLowerCase() === resolvedLabel
        );
        if (!targetFacet) {
            targetFacet = facetData.attributes.find(
                a => a.label?.toLowerCase()?.includes(canonicalCode) || canonicalCode?.includes(a.label?.toLowerCase())
            );
        }

        if (!targetFacet || (!targetFacet.options?.length && !targetFacet.clauses?.length)) {
            const scopeDesc = catLabel ? ` in **${catLabel}**` : queryStr ? ` for "${queryStr}"` : '';
            return {
                message: `There are no specific **${resolvedLabel}** options${scopeDesc} at the moment.`,
                facet_target: resolvedLabel,
                options: [],
                whatsapp: {
                    type: 'button',
                    buttons: [{ id: '__nav:results__', title: 'See products' }]
                }
            };
        }

        // ── 5. Build the response with values + counts ──
        const options = (targetFacet.options || []).filter(o => o.count > 0);
        const clauses = (targetFacet.clauses || []).filter(c => c.count > 0);
        const formattedOptions = options.map(o => `${o.value} (${o.count})`).slice(0, 15);

        let scopePhrase = '';
        if (catLabel && queryStr) {
            scopePhrase = ` for "${queryStr}" in **${catLabel}**`;
        } else if (queryStr) {
            scopePhrase = ` for "${queryStr}"`;
        } else if (catLabel) {
            scopePhrase = ` in **${catLabel}**`;
        } else {
            scopePhrase = ' across all our products';
        }

        const message = `Here are the available **${targetFacet.label || resolvedLabel}** options${scopePhrase}: ${formattedOptions.join(', ')}.`;

        const topOptions = options.slice(0, 3);
        const resolvedAttrCode = targetFacet.code || canonicalCode || attrCode;
        const isVendorFacet = resolvedAttrCode === 'vendor' || canonicalCode === 'vendor' || attrCode === 'vendor';
        const whatsappButtons = topOptions.map(o => {
            const encodedValue = encodeURIComponent(String(o.value));
            if (isVendorFacet) {
                const vendorKey = encodeBase64Url(o.value);
                return { id: `__vendor:products:${vendorKey}__`, title: `See ${o.value}'s products` };
            }
            const tokenId = category
                ? `__facet:select:${resolvedAttrCode}:${encodedValue}:${category}__`
                : `__facet:select:${resolvedAttrCode}:${encodedValue}__`;
            return { id: tokenId, title: `${o.value} (${o.count})` };
        });

        return {
            message,
            facet_target: targetFacet.label || resolvedLabel,
            attribute_code: resolvedAttrCode,
            options: options.map(o => ({ value: o.value, count: o.count })),
            clauses: clauses.length > 0 ? clauses.map(c => ({ label: c.label || c.name, count: c.count })) : undefined,
            scope: catLabel ? 'category' : queryStr ? 'query' : 'global',
            scope_label: catLabel || queryStr || null,
            source: 'backend_aggregation',
            whatsapp: whatsappButtons.length > 0 ? {
                type: 'button',
                buttons: whatsappButtons
            } : {
                type: 'button',
                buttons: [{ id: '__nav:results__', title: 'See products' }]
            }
        };
    }
};

module.exports = {
    'product.facets': facetsTool
};
