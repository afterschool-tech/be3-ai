const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'saas_ecommerce',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '343434',
});

async function buildComprehensiveContext() {
    try {
        console.log('🚀 Building Comprehensive Store Context...\n');

        // ===== 1. HIERARCHICAL CATEGORIES =====
        console.log('📂 Fetching categories with parent-child relationships...');
        const catRes = await pool.query(`
            SELECT id, parent_id, name, slug, description, image_url
            FROM categories 
            WHERE tenant_id = $1
            ORDER BY name
        `, [process.env.TENANT_ID]);

        const categoriesMap = {};
        const childrenMap = {}; // parent_id -> [child_keys]
        const idToKeyMap = {}; // id -> key

        catRes.rows.forEach(c => {
            const key = c.name.toLowerCase().replace(/\s+/g, '_');
            categoriesMap[key] = {
                id: c.id,
                label: c.name,
                slug: c.slug,
                description: c.description || '',
                image_url: c.image_url || null,
                parent_id: c.parent_id,
                children: [],
                attributes: [],
                allowed_clauses: [],
                product_count: 0,
                total_count: 0
            };
            idToKeyMap[c.id] = key;

            if (c.parent_id) {
                if (!childrenMap[c.parent_id]) childrenMap[c.parent_id] = [];
                childrenMap[c.parent_id].push(key);
            }
        });

        // Populate children arrays
        Object.values(categoriesMap).forEach(cat => {
            cat.children = childrenMap[cat.id] || [];
        });

        console.log(`✅ ${Object.keys(categoriesMap).length} categories loaded`);

        // ===== 2. ATTRIBUTES (with predefined values and clauses) =====
        console.log('🏷️  Fetching attributes & system_attributes...');
        const attrRes = await pool.query(`
            SELECT id, label, code, type, options, clauses
            FROM attributes
            WHERE tenant_id = $1
            UNION ALL
            SELECT id, label, code, type, options, NULL as clauses
            FROM system_attributes
        `, [process.env.TENANT_ID]);

        const attributesMap = {};
        attrRes.rows.forEach(a => {
            const key = a.label.toLowerCase().replace(/\s+/g, '_');

            // Parse options (predefined values for select type)
            let options = [];
            try {
                options = typeof a.options === 'string' ? JSON.parse(a.options) : (a.options || []);
            } catch (e) {
                options = [];
            }

            // Parse clauses (semantic groupings)
            let clauses = [];
            try {
                clauses = typeof a.clauses === 'string' ? JSON.parse(a.clauses) : (a.clauses || []);
            } catch (e) {
                clauses = [];
            }

            attributesMap[key] = {
                id: a.id,
                code: a.code,
                label: a.label,
                type: a.type || 'text',
                // Predefined values (for select type dropdown)
                predefined_values: (options && Array.isArray(options)) ? options.map(opt => ({
                    label: opt.label || opt.name || opt.value,
                    value: opt.value
                })) : [],
                // Semantic clauses (e.g., "affordable" = ["budget", "midrange"])
                clauses: clauses.filter(c => c && c.label).map(c => ({
                    name: c.name || c.label.toLowerCase().replace(/\s+/g, '_'),
                    label: c.label,
                    matches: Array.isArray(c.value) ? c.value : (c.value ? [c.value] : []),
                    operator: c.operator || '=',
                    prefix: c.prefix || '',
                    suffix: c.suffix || ''
                })),
                categories: [] // Will populate below
            };
        });

        console.log(`✅ ${Object.keys(attributesMap).length} attributes loaded`);
        console.log('📊 Sample attribute:', JSON.stringify(Object.values(attributesMap)[0], null, 2));

        // Note: system_attributes apply globally to ALL categories so lets map them implicitly first
        const systemAttrRes = await pool.query(`SELECT id, label FROM system_attributes`);
        const systemAttributeKeys = systemAttrRes.rows.map(a => a.label.toLowerCase().replace(/\s+/g, '_'));

        Object.keys(categoriesMap).forEach(catKey => {
            systemAttributeKeys.forEach(sysAttrKey => {
                if (!categoriesMap[catKey].attributes.includes(sysAttrKey)) {
                    categoriesMap[catKey].attributes.push(sysAttrKey);
                }
                if (attributesMap[sysAttrKey] && !attributesMap[sysAttrKey].categories.includes(catKey)) {
                    attributesMap[sysAttrKey].categories.push(catKey);
                }
            });
        });

        // ===== 3. CATEGORY-ATTRIBUTE RELATIONSHIPS =====
        console.log('🔗 Mapping category-attribute relationships...');
        const catAttrRes = await pool.query(`
            SELECT 
                ca.category_id,
                ca.attribute_id,
                ca.excluded_clauses,
                c.name as category_name,
                a.label as attr_label,
                a.clauses
            FROM category_attributes ca
            JOIN categories c ON ca.category_id = c.id
            JOIN attributes a ON ca.attribute_id = a.id
            WHERE c.tenant_id = $1
        `, [process.env.TENANT_ID]);

        const allClauses = {};

        catAttrRes.rows.forEach(row => {
            const catKey = row.category_name.toLowerCase().replace(/\s+/g, '_');
            const attrKey = row.attr_label.toLowerCase().replace(/\s+/g, '_');

            if (categoriesMap[catKey]) {
                // Add attribute to category
                if (!categoriesMap[catKey].attributes.includes(attrKey)) {
                    categoriesMap[catKey].attributes.push(attrKey);
                }

                // Add category to attribute
                if (attributesMap[attrKey] && !attributesMap[attrKey].categories.includes(catKey)) {
                    attributesMap[attrKey].categories.push(catKey);
                }

                // Process clauses (semantic clauses for AI matching)
                if (row.clauses && Array.isArray(row.clauses)) {
                    row.clauses.forEach(clause => {
                        const clauseKey = clause.label.toLowerCase().replace(/\s+/g, '_');
                        const isExcluded = row.excluded_clauses && Array.isArray(row.excluded_clauses) && row.excluded_clauses.includes(clause.name);

                        if (!isExcluded) {
                            if (!categoriesMap[catKey].allowed_clauses.includes(clauseKey)) {
                                categoriesMap[catKey].allowed_clauses.push(clauseKey);
                            }

                            if (!allClauses[clauseKey]) {
                                allClauses[clauseKey] = {
                                    label: clause.label,
                                    attribute: row.attr_label,
                                    matches: Array.isArray(clause.value) ? clause.value : [clause.value],
                                    display: {
                                        prefix: clause.prefix || '',
                                        suffix: clause.suffix || ''
                                    },
                                    categories: [],
                                    excluded_categories: []
                                };
                            }
                            if (!allClauses[clauseKey].categories.includes(catKey)) {
                                allClauses[clauseKey].categories.push(catKey);
                            }
                        } else {
                            if (allClauses[clauseKey] && !allClauses[clauseKey].excluded_categories.includes(catKey)) {
                                allClauses[clauseKey].excluded_categories.push(catKey);
                            }
                        }
                    });
                }
            }
        });

        console.log(`✅ ${catAttrRes.rows.length} category-attribute mappings processed`);

        // ===== 3b. ATTRIBUTE INHERITANCE (Parent → Child) =====
        // The storefront resolves attributes using a recursive CTE that walks UP the
        // parent chain (categories.routes.js). A child category inherits ALL attributes
        // and clauses from its ancestors unless it explicitly has its own definition.
        // We replicate that here by walking UP each category's parent chain.
        console.log('🧬 Propagating inherited attributes (parent → child)...');
        let inheritedCount = 0;

        // Helper: collect the ancestor chain for a category (bottom-up)
        function getAncestorChain(catKey) {
            const chain = [];
            let current = categoriesMap[catKey];
            while (current && current.parent_id) {
                const parentKey = idToKeyMap[current.parent_id];
                if (!parentKey || !categoriesMap[parentKey]) break;
                chain.push(parentKey);
                current = categoriesMap[parentKey];
            }
            return chain; // [parent, grandparent, great-grandparent, ...]
        }

        for (const catKey of Object.keys(categoriesMap)) {
            const ancestors = getAncestorChain(catKey);
            if (ancestors.length === 0) continue; // Top-level, nothing to inherit

            for (const ancestorKey of ancestors) {
                const ancestor = categoriesMap[ancestorKey];

                // Inherit attributes
                for (const attrKey of ancestor.attributes) {
                    // Skip system attributes (already applied globally)
                    if (systemAttributeKeys.includes(attrKey)) continue;

                    if (!categoriesMap[catKey].attributes.includes(attrKey)) {
                        categoriesMap[catKey].attributes.push(attrKey);
                        inheritedCount++;

                        // Also update the reverse mapping (attribute → categories)
                        if (attributesMap[attrKey] && !attributesMap[attrKey].categories.includes(catKey)) {
                            attributesMap[attrKey].categories.push(catKey);
                        }
                    }
                }

                // Inherit allowed_clauses
                for (const clauseKey of ancestor.allowed_clauses) {
                    if (!categoriesMap[catKey].allowed_clauses.includes(clauseKey)) {
                        categoriesMap[catKey].allowed_clauses.push(clauseKey);

                        // Also update clause.categories for the global CLAUSES map
                        if (allClauses[clauseKey] && !allClauses[clauseKey].categories.includes(catKey)) {
                            allClauses[clauseKey].categories.push(catKey);
                        }
                    }
                }
            }
        }

        console.log(`✅ ${inheritedCount} inherited attribute-category links added`);

        // ===== 4. COLLECTIONS (with rules) =====
        console.log('📦 Fetching collections...');
        const collRes = await pool.query(`
            SELECT id, name, slug, rules, manual_product_ids, excluded_product_ids
            FROM collections
            WHERE tenant_id = $1 AND is_active = true
        `, [process.env.TENANT_ID]);

        const collectionsMap = {};
        collRes.rows.forEach(c => {
            const key = c.name.toLowerCase().replace(/\s+/g, '_');
            let rules = [];
            try {
                rules = typeof c.rules === 'string' ? JSON.parse(c.rules) : (c.rules || []);
            } catch (e) {
                rules = [];
            }

            collectionsMap[key] = {
                id: c.id,
                label: c.name,
                slug: c.slug,
                rules: rules, // Dynamic rules for product matching
                manual_product_ids: c.manual_product_ids || [],
                excluded_product_ids: c.excluded_product_ids || [],
                is_dynamic: rules.length > 0,
                categories: null // Collections can span multiple categories
            };
        });

        console.log(`✅ ${Object.keys(collectionsMap).length} collections loaded`);

        // ===== 5. VENDORS (with category distribution) =====
        console.log('🏪 Fetching vendors...');
        const vendorRes = await pool.query(`
            SELECT DISTINCT 
                u.id, 
                u.business_name, 
                u.first_name, 
                u.last_name,
                u.checkout_style,
                u.whatsapp_phone,
                COUNT(DISTINCT p.id) as product_count
            FROM users u
            JOIN products p ON p.created_by = u.id
            WHERE p.tenant_id = $1
            GROUP BY u.id, u.business_name, u.first_name, u.last_name, u.checkout_style, u.whatsapp_phone
        `, [process.env.TENANT_ID]);

        const vendorsMap = {};
        vendorRes.rows.forEach(v => {
            const name = v.business_name || `${v.first_name} ${v.last_name}`.trim() || 'Store';
            const key = name.toLowerCase().replace(/\s+/g, '_');
            vendorsMap[key] = {
                id: v.id,
                business_name: name,
                tag: name,
                checkout_style: v.checkout_style || 'inhouse',
                whatsapp_phone: v.whatsapp_phone || null,
                delivery_scope: "Local & National",
                product_count: parseInt(v.product_count) || 0,
                categories: []
            };
        });

        console.log(`✅ ${Object.keys(vendorsMap).length} vendors loaded`);

        // ===== 6. PRODUCT COUNTS (per category, recursive) =====
        console.log('📊 Calculating product counts...');
        const inventoryRes = await pool.query(`
            SELECT c.slug, COUNT(DISTINCT pc.product_id) as product_count
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.slug
        `, [process.env.TENANT_ID]);

        const categoryInventory = {};
        inventoryRes.rows.forEach(r => {
            categoryInventory[r.slug] = parseInt(r.product_count) || 0;

            // Find category and set counts
            const catKey = Object.keys(categoriesMap).find(k => categoriesMap[k].slug === r.slug);
            if (catKey) {
                categoriesMap[catKey].product_count = parseInt(r.product_count) || 0;
            }
        });

        // Recursive rollup for total_count (includes children)
        function calculateTotalCount(catKey) {
            const cat = categoriesMap[catKey];
            if (!cat) return 0;

            let total = cat.product_count;
            cat.children.forEach(childKey => {
                total += calculateTotalCount(childKey);
            });
            cat.total_count = total;
            return total;
        }

        Object.keys(categoriesMap).forEach(catKey => {
            if (!categoriesMap[catKey].parent_id) {
                calculateTotalCount(catKey);
            }
        });

        console.log(`✅ Product counts calculated`);

        // ===== 7. WRITE storeContext.js =====
        const contextContent = `
/**
 * AUTO-GENERATED Comprehensive Store Context
 * Generated: ${new Date().toISOString()}
 * 
 * This context powers the AI with:
 * - Hierarchical categories (parent→child)
 * - Attributes (with predefined values)
 * - Collections (with product counts)
 * - Vendors (with product counts)
 * 
 * PHILOSOPHY: Context is ADVISORY, not restrictive.
 * The AI should use this to guide decisions, not hard-filter queries.
 */

const initContextHelpers = require('./contextHelpers');

const CATEGORIES = ${JSON.stringify(categoriesMap, null, 4)};

const ATTRIBUTES = ${JSON.stringify(attributesMap, null, 4)};

const COLLECTIONS = ${JSON.stringify(collectionsMap, null, 4)};

const VENDORS = ${JSON.stringify(vendorsMap, null, 4)};

const BUSINESSES = { ...VENDORS };

const CATEGORY_INVENTORY = ${JSON.stringify(categoryInventory, null, 4)};

const helpers = initContextHelpers(CATEGORIES, ATTRIBUTES, COLLECTIONS, VENDORS);

module.exports = { 
    CATEGORIES, 
    ATTRIBUTES,
    COLLECTIONS, 
    VENDORS, 
    BUSINESSES, 
    CATEGORY_INVENTORY,
    ...helpers
};
`;

        fs.writeFileSync('src/context/storeContext.js', contextContent);
        console.log('\n✅ src/context/storeContext.js generated successfully');

        // ===== 8. WRITE clauses.js (semantic clauses for AI) =====
        const clausesContent = `
/**
 * AUTO-GENERATED Semantic Clauses
 * Generated: ${new Date().toISOString()}
 */
const CLAUSES = ${JSON.stringify(allClauses, null, 4)};

function getClausesForCategory(categoryName) {
    const applicable = {};
    for (const [id, clause] of Object.entries(CLAUSES)) {
        if (clause.categories.includes(categoryName) && !clause.excluded_categories.includes(categoryName)) {
            applicable[id] = clause;
        }
    }
    return applicable;
}

module.exports = { CLAUSES, getClausesForCategory };
`;

        fs.writeFileSync('src/context/clauses.js', clausesContent);
        console.log('✅ src/context/clauses.js generated successfully');

        // ===== 9. PRINT SUMMARY =====
        console.log('\n📊 Context Summary:');
        console.log(`   Categories: ${Object.keys(categoriesMap).length}`);
        console.log(`   Attributes: ${Object.keys(attributesMap).length}`);
        console.log(`   Collections: ${Object.keys(collectionsMap).length}`);
        console.log(`   Vendors: ${Object.keys(vendorsMap).length}`);
        console.log(`   Clauses: ${Object.keys(allClauses).length}`);

    } catch (err) {
        console.error('❌ Build failed:', err.message);
        console.error(err.stack);
    } finally {
        await pool.end();
    }
}

buildComprehensiveContext();
