const crypto = require('crypto');

function buildProductCards(products) {
    const ordinalSuffix = (n) => {
        if (n === 1) return 'st';
        if (n === 2) return 'nd';
        if (n === 3) return 'rd';
        return 'th';
    };

    const pickedForCards = Array.isArray(products) ? products.filter(Boolean) : [];
    const buildCardText = (p) => {
        const priceText = (p.price !== undefined && p.price !== null) ? `₦${p.price}` : 'Price unavailable';
        return `*${p.name || p.title || 'Product'}*\n💰 ${priceText}`;
    };

    const cards = pickedForCards.map((p, idx) => {
        const n = idx + 1;
        const suffix = ordinalSuffix(n);
        const imageUrl = p.image_url || p.metadata?.image_url || null;
        return {
            id: p.id,
            content_type: 'product',
            sponsor: {
                type: 'product',
                product_id: p.id,
                name: p.name || p.title || null,
                ordinal: n
            },
            image_url: imageUrl,
            text: buildCardText(p),
            buttons: [
                { id: `__cart:add:${p.id}__`, title: 'Add to cart' },
                { id: `__product:details:${p.id}__`, title: 'More info' }
            ]
        };
    });

    return {
        type: 'button',
        transaction: 'product_card',
        cards
    };
}

function deriveClauseNameFromAttributes(attributes) {
    let clauseName = null;
    try {
        for (const [k, v] of Object.entries(attributes || {})) {
            if (typeof k === 'string' && k.includes(':')) {
                clauseName = k.split(':')[1] || null;
                break;
            }
            if (typeof v === 'string' && v.includes(':')) {
                clauseName = v.split(':')[0] || null;
                break;
            }
        }
    } catch (_) { }
    return clauseName;
}

function buildFacetRefinerButtons({ facets, attributes, snapshotId }) {
    const clauseButtons = [];
    const valueButtons = [];

    try {
        const activeClauseByAttr = {};
        try {
            for (const [k, v] of Object.entries(attributes || {})) {
                if (!k || typeof k !== 'string') continue;
                if (!k.includes(':')) continue;
                const [attrCode, clauseName] = k.split(':');
                const finalAttr = String(attrCode || '').trim();
                const finalClause = String(clauseName || '').trim();
                if (!finalAttr || !finalClause) continue;
                activeClauseByAttr[finalAttr] = finalClause.toLowerCase();
            }
        } catch (_) { }

        const activeValueByAttr = {};
        try {
            for (const [k, v] of Object.entries(attributes || {})) {
                if (!k || typeof k !== 'string') continue;
                if (k.includes(':')) continue;
                if (typeof v === 'string' && v.includes(':')) continue;
                if (v === undefined || v === null) continue;
                activeValueByAttr[k] = String(v).trim().toLowerCase();
            }
        } catch (_) { }

        const facetsAttrs = Array.isArray(facets?.attributes) ? facets.attributes : [];
        const clauseCandidates = [];
        const valueCandidates = [];
        for (const attr of facetsAttrs) {
            const attrCode = attr?.code;
            if (!attrCode) continue;

            const clauses = Array.isArray(attr?.clauses) ? attr.clauses : [];
            if (activeClauseByAttr[attrCode]) {
                continue;
            }
            for (const c of clauses) {
                const clauseName = c?.name;
                const title = String(c?.label || c?.name || '').trim();
                const count = Number.isFinite(c?.count) ? Number(c.count) : 0;
                if (!clauseName || !title || count <= 0) continue;
                clauseCandidates.push({ attrCode, clauseName, title, count });
            }

            const options = Array.isArray(attr?.options) ? attr.options : [];
            for (const o of options) {
                const value = o?.value;
                const count = Number.isFinite(o?.count) ? Number(o.count) : 0;
                if (value === undefined || value === null || count <= 0) continue;
                const valueStr = String(value).trim();
                if (!valueStr) continue;
                if (activeValueByAttr[attrCode] && activeValueByAttr[attrCode] === valueStr.toLowerCase()) continue;
                valueCandidates.push({ attrCode, value: valueStr, title: valueStr, count });
            }
        }

        const combinedCandidates = [
            ...clauseCandidates.map(c => ({
                type: 'clause',
                attrCode: c.attrCode,
                clauseName: c.clauseName,
                title: c.title,
                count: c.count
            })),
            ...valueCandidates.map(v => ({
                type: 'value',
                attrCode: v.attrCode,
                value: v.value,
                title: v.title,
                count: v.count
            }))
        ];

        combinedCandidates
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                if (a.type !== b.type) return a.type === 'clause' ? -1 : 1;
                return 0;
            })
            .slice(0, 3)
            .forEach(item => {
                if (item.type === 'clause') {
                    const encoded = encodeURIComponent(String(item.clauseName));
                    clauseButtons.push({
                        id: `__filter:clause:${snapshotId}:${item.attrCode}:${encoded}__`,
                        title: item.title,
                        priority: 10
                    });
                } else {
                    const encoded = encodeURIComponent(String(item.value));
                    valueButtons.push({
                        id: `__filter:value:${snapshotId}:${item.attrCode}:${encoded}__`,
                        title: item.title,
                        priority: 10
                    });
                }
            });
    } catch (_) { }

    return { clauseButtons, valueButtons };
}

function buildDefaultSeeMoreTitle({ labelBase, clauseName }) {
    const base = String(labelBase || '').trim() || 'results';
    const clause = String(clauseName || '').trim();

    if (clause && base && base.toLowerCase() !== clause.toLowerCase()) {
        return `See more ${base} (${clause})`;
    }
    return `See more ${base}`;
}

function pickVendorSeeMoreTitle(vendorName) {
    const name = String(vendorName || '').trim();
    if (!name) return 'See more';

    const truncate = (title, maxLen = 20) => {
        const t = String(title || '');
        if (t.length <= maxLen) return t;
        return t.slice(0, Math.max(0, maxLen - 1)) + '…';
    };

    const len = name.length;

    // Prefer shorter, more "chatty" titles when vendor name is short.
    if (len <= 12) {
        // Example: "More from Dareymi"
        return truncate(`More from ${name}`);
    }

    // Medium names: "See more <vendor>" may fit better than "More from <vendor>".
    if (len <= 16) {
        // Example: "See more Dareymi"
        return truncate(`See more ${name}`);
    }

    // Long names: avoid appending "products"; keep it concise.
    if (len <= 24) {
        // Example: "More from Taye's…"
        return truncate(`More from ${name}`);
    }

    // Very long: fallback.
    return 'See more';
}

function computeHasNextPage({ pagination, fallbackCount, page, limit }) {
    const currentPage = Number.isFinite(Number(pagination?.page)) ? Number(pagination.page) : Number(page);
    const perPage = Number.isFinite(Number(pagination?.perPage)) ? Number(pagination.perPage) : Number(limit);
    const totalCount = Number.isFinite(Number(pagination?.total))
        ? Number(pagination.total)
        : (Number.isFinite(Number(fallbackCount)) ? Number(fallbackCount) : 0);
    const totalPages = Number.isFinite(Number(pagination?.totalPages))
        ? Number(pagination.totalPages)
        : (perPage > 0 ? Math.ceil(totalCount / perPage) : 1);
    return currentPage < totalPages;
}

function createSnapshotId() {
    return crypto.randomBytes(4).toString('hex');
}

module.exports = {
    buildProductCards,
    buildFacetRefinerButtons,
    deriveClauseNameFromAttributes,
    buildDefaultSeeMoreTitle,
    pickVendorSeeMoreTitle,
    computeHasNextPage,
    createSnapshotId
};
