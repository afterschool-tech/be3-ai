const { normalizeCategory } = require('../utils/normalization');

const categoryTools = {
    'category.list': {
        description: 'List all top-level categories',
        params: {},
        handler: async (params, context) => {
            return Object.values(context.CATEGORIES)
                .filter(c => !c.parent_id)
                .map(c => ({ label: c.label, count: c.total_count }));
        }
    },
    'category.getInfo': {
        description: 'Get detailed information about a specific category',
        params: {
            category: { type: 'string', description: 'Category name or slug' }
        },
        handler: async (params, context) => {
            const catId = normalizeCategory(params.category);
            if (!catId) return { error: `Category "${params.category}" not found.` };
            const cat = context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)];

            if (!cat) return { error: `Category "${params.category}" not found.` };

            return {
                id: cat.id,
                label: cat.label,
                slug: cat.slug,
                description: cat.description,
                product_count: cat.total_count,
                has_children: cat.children && cat.children.length > 0
            };
        }
    },

    'category.getSubcategories': {
        description: 'Get the subcategories (children) of a specific category',
        params: {
            category: { type: 'string', description: 'Parent category name or slug' }
        },
        handler: async (params, context) => {
            const catId = normalizeCategory(params.category);
            if (!catId) return { error: `Parent category "${params.category}" not found.` };
            const parent = context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)];

            if (!parent) return { error: `Parent category "${params.category}" not found.` };

            const children = (parent.children || []).map(childId => {
                const child = context.CATEGORIES[childId];
                return child ? { label: child.label, slug: child.slug, count: child.total_count } : null;
            }).filter(Boolean);

            return {
                parent: parent.label,
                subcategories: children
            };
        }
    },

    'category.getAttributes': {
        description: 'Get all filtering attributes applicable to a specific category',
        params: {
            category: { type: 'string', description: 'Category name or slug' }
        },
        handler: async (params, context) => {
            const catId = normalizeCategory(params.category);
            if (!catId) return { error: `Category "${params.category}" not found.` };
            const cat = context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)];

            if (!cat) return { error: `Category "${params.category}" not found.` };

            const attrKeys = cat.attributes || [];
            const attributes = attrKeys.map(key => {
                const attr = context.ATTRIBUTES[key];
                return attr ? { label: attr.label, code: attr.code, type: attr.type } : null;
            }).filter(Boolean);

            return {
                category: cat.label,
                available_attributes: attributes
            };
        }
    },

    'category.getProductCount': {
        description: 'Get the number of products available in a category',
        params: {
            category: { type: 'string', description: 'Category name or slug' }
        },
        handler: async (params, context) => {
            const catId = normalizeCategory(params.category);
            if (!catId) return { error: `Category "${params.category}" not found.` };
            const cat = context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)];

            if (!cat) return { error: `Category "${params.category}" not found.` };

            return {
                category: cat.label,
                count: cat.total_count,
                direct_count: cat.product_count,
                recursive: true
            };
        }
    }
};

module.exports = categoryTools;
