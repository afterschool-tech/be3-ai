const { normalizeCategory } = require('../../../utils/normalization');

const adviceTool = {
    description: 'Provide shopping advice, comparisons, or recommendations based on specific categories or needs.',
    params: {
        category: { type: 'string', description: 'Subject category' },
        need: { type: 'string', description: 'User need (e.g. "gaming", "budget")' }
    },
    handler: async (params, context) => {
        const { category, need } = params;
        const catId = normalizeCategory(category, null, false, { initiator: 'product_tool_detail', debug: true });
        const cat = catId ? context.CATEGORIES[Object.keys(context.CATEGORIES).find(k => context.CATEGORIES[k].id === catId)] : null;

        if (!cat) return {
            advice: "I couldn't find specific data for that category, but generally, when shopping for " + (category || "electronics") + ", you should look for reliable brands and check the warranty options.",
            suggested_action: "Would you like me to show you our top-level categories instead?"
        };

        const attributes = (cat.attributes || []).map(a => context.ATTRIBUTES[a]).filter(Boolean);
        const keyFeature = attributes.length > 0 ? attributes[0].label : "quality";

        return {
            category: cat.label,
            advice: `When looking for ${cat.label} ${need ? 'for ' + need : ''}, the most important factor is usually ${keyFeature}. We have ${cat.total_count} items in this section.`,
            suggested_filters: attributes.slice(0, 2).map(a => a.label),
            next_step: `I can search for ${need || ''} ${cat.label} for you.`
        };
    }
};

module.exports = {
    'product.semanticSearch': adviceTool
};
