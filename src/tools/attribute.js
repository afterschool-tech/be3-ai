/**
 * Attribute Tools
 * Capabilities related to product attributes (filtering, values).
 */

const { ATTRIBUTES, CATEGORIES } = require('../context/storeContext');
const { normalizeCategory } = require('../utils/normalization');

/**
 * Helper to find attributes relevant to a category
 */
function getAttributesForCategory(categoryInput) {
    if (!categoryInput) return [];

    const catId = normalizeCategory(categoryInput);
    const cat = catId ? CATEGORIES[Object.keys(CATEGORIES).find(k => CATEGORIES[k].id === catId)] : null;
    if (!cat) return [];

    // Collect attributes from category context (assuming 'attributes' array of keys)
    const attrKeys = cat.attributes || [];

    return attrKeys.map(key => {
        const attr = ATTRIBUTES[key];
        return attr ? {
            code: attr.code,
            label: attr.label,
            type: attr.type,
            values: attr.predefined_values || []
        } : null;
    }).filter(Boolean);
}

const attributeTools = {
    'attribute.list': {
        description: 'List available filter attributes for a specific category',
        params: {
            category_slug: { type: 'string', description: 'Category slug (e.g. laptops, shoes)' }
        },
        handler: async (params, context) => {
            const { category_slug } = params;
            if (!category_slug) return { error: "Category slug is required" };

            const attributes = getAttributesForCategory(category_slug);

            if (attributes.length === 0) {
                return {
                    message: "No specific filters available for this category.",
                    attributes: []
                };
            }

            return {
                category: params.category_slug,
                attributes: attributes.map(a => ({
                    label: a.label,
                    code: a.code,
                    value_count: a.values.length
                }))
            };
        }
    },

    'attribute.getValues': {
        description: 'Get valid values for a specific attribute',
        params: {
            attribute_code: { type: 'string', description: 'Attribute code or label (e.g. size, color)' },
            category_slug: { type: 'string', description: 'Optional: Context category' }
        },
        handler: async (params, context) => {
            const { attribute_code, category_slug } = params;

            // Find attribute by code or label
            const attr = Object.values(ATTRIBUTES).find(a =>
                a.code === attribute_code || a.label.toLowerCase() === attribute_code.toLowerCase()
            );

            if (!attr) return { error: `Attribute not found: ${attribute_code}` };

            return {
                attribute: attr.label,
                code: attr.code,
                type: attr.type,
                values: attr.predefined_values || []
            };
        }
    },

    'attribute.findByCategory': {
        description: 'Find all attributes that are relevant/enabled for a specific category',
        params: {
            category_slug: { type: 'string', description: 'Category slug' }
        },
        handler: async (params, context) => {
            const { category_slug } = params;
            if (!category_slug) return { error: "Category slug required" };

            const attributes = getAttributesForCategory(category_slug);
            return {
                category: category_slug,
                attributes
            };
        }
    }
};

module.exports = attributeTools;
