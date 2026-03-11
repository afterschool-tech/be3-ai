/**
 * Context Helpers for Be3 AI
 * 
 * This file contains the logic for generating various context summaries.
 * It is separated from the auto-generated data in storeContext.js to 
 * prevent logic loss during rebuilds.
 */

function initContextHelpers(CATEGORIES, ATTRIBUTES, COLLECTIONS, VENDORS) {

    /**
     * Tree Navigation & Context Helpers
     */
    const getCategoryTree = () => {
        const roots = Object.keys(CATEGORIES).filter(k => !CATEGORIES[k].parent_id);

        const getAncestors = (categoryKey) => {
            const ancestors = [];
            let current = CATEGORIES[categoryKey];
            while (current && current.parent_id) {
                const parentKey = Object.keys(CATEGORIES).find(k => CATEGORIES[k].id === current.parent_id);
                if (parentKey) {
                    ancestors.unshift(parentKey);
                    current = CATEGORIES[parentKey];
                } else break;
            }
            return ancestors;
        };

        const getDescendants = (categoryKey) => {
            const descendants = [];
            const queue = [...(CATEGORIES[categoryKey]?.children || [])];
            while (queue.length > 0) {
                const child = queue.shift();
                descendants.push(child);
                queue.push(...(CATEGORIES[child]?.children || []));
            }
            return descendants;
        };

        const getSiblings = (categoryKey) => {
            const cat = CATEGORIES[categoryKey];
            if (!cat || !cat.parent_id) return [];
            const parentKey = Object.keys(CATEGORIES).find(k => CATEGORIES[k].id === cat.parent_id);
            if (!parentKey) return [];
            return CATEGORIES[parentKey].children.filter(c => c !== categoryKey);
        };

        const getPath = (categoryKey) => {
            const ancestors = getAncestors(categoryKey);
            return [...ancestors, categoryKey].map(k => CATEGORIES[k]?.label).filter(Boolean).join(' > ');
        };

        const findBySlug = (slug) => {
            return Object.keys(CATEGORIES).find(k => CATEGORIES[k].slug === slug);
        };

        return {
            roots,
            getAncestors,
            getDescendants,
            getSiblings,
            getPath,
            findBySlug
        };
    };

    const tree = getCategoryTree();

    /**
     * Get comprehensive context summary for AI prompts
     */
    const getContextSummary = () => {
        return {
            categories: {
                total: Object.keys(CATEGORIES).length,
                roots: tree.roots.map(k => ({
                    key: k,
                    label: CATEGORIES[k].label,
                    total_products: CATEGORIES[k].total_count,
                    children: CATEGORIES[k].children.length
                })),
                available: Object.entries(CATEGORIES)
                    .filter(([k, c]) => c.total_count > 0)
                    .map(([k, c]) => ({
                        path: tree.getPath(k),
                        products: c.total_count,
                        attributes: c.attributes
                    })),
                unavailable: Object.entries(CATEGORIES)
                    .filter(([k, c]) => c.total_count === 0)
                    .map(([k, c]) => tree.getPath(k))
            },

            attributes: {
                total: Object.keys(ATTRIBUTES).length,
                list: Object.entries(ATTRIBUTES).map(([k, a]) => ({
                    label: a.label,
                    has_predefined_values: a.has_predefined_values,
                    supported_by: a.categories.length,
                    example_categories: a.categories.slice(0, 3)
                }))
            },

            collections: {
                total: Object.keys(COLLECTIONS).length,
                dynamic: Object.entries(COLLECTIONS).filter(([k, c]) => c.is_dynamic).length,
                list: Object.entries(COLLECTIONS).map(([k, c]) => ({
                    label: c.label,
                    rules_count: c.rules.length,
                    manual_count: c.manual_product_ids.length
                }))
            },

            vendors: {
                total: Object.keys(VENDORS).length,
                list: Object.values(VENDORS).map(v => ({
                    name: v.business_name,
                    products: v.product_count,
                    checkout_style: v.checkout_style,
                    whatsapp: v.whatsapp_phone
                }))
            }
        };
    };

    /**
     * Get LEAN context for System Prompts (Token Efficient)
     */
    const getLeanContext = () => {
        const roots = tree.roots.map(k => CATEGORIES[k].label);

        const activeCategories = Object.values(CATEGORIES)
            .filter(c => c.total_count > 0)
            .map(c => ({
                name: c.label,
                count: c.total_count
            }));

        const vendors = Object.values(VENDORS).map(v => ({
            name: v.business_name,
            checkout: v.checkout_style,
            phone: v.whatsapp_phone
        }));

        const collections = Object.values(COLLECTIONS).map(c => c.label);
        const attributes = Object.values(ATTRIBUTES).map(a => a.label);

        return {
            store_scope: {
                root_departments: roots,
                active_departments: activeCategories,
                partners: vendors,
                featured_collections: collections,
                filters: attributes
            },
            policy: "Use 'category.list' to see sub-departments. Use 'product.search' to find items."
        };
    };

    /**
     * Get ultra-lean context for rescue prompts
     */
    const getUltraLeanContext = () => {
        const vendors = Object.values(VENDORS).map(v => ({
            name: v.business_name,
            phone: v.whatsapp_phone,
            checkout: v.checkout_style
        }));

        const categories = Object.values(CATEGORIES).map(c => ({
            name: c.label,
            slug: c.slug,
            count: c.total_count
        }));

        const brandValues = (ATTRIBUTES?.brand?.predefined_values || [])
            .map(b => (b?.value ?? b?.label))
            .filter(Boolean);

        return {
            vendors,
            categories,
            brands: brandValues
        };
    };

    return {
        getCategoryTree,
        getContextSummary,
        getLeanContext,
        getUltraLeanContext,
        CATEGORY_TREE: tree
    };
}

module.exports = initContextHelpers;
