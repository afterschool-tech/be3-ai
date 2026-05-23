const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const poolConfig = process.env.DB_SOURCE === 'cloud'
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Required for Neon
    }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'saas_ecommerce',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '343434',
    };

const pool = new Pool(poolConfig);

async function buildComprehensiveContext() {
    try {
        const connectionLabel = process.env.DB_SOURCE === 'cloud' ? '☁️  CLOUD (Neon)' : '💻 LOCAL';
        const hostInfo = process.env.DB_SOURCE === 'cloud'
            ? (process.env.DATABASE_URL?.match(/@([^/]+)/)?.[1] || 'URL Provided')
            : (process.env.DB_HOST || 'localhost');

        console.log(`🚀 Building Comprehensive Store Context...`);
        console.log(`📡 Source: ${connectionLabel}`);
        console.log(`🔗 Host: ${hostInfo}\n`);

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
                predefined_values: (options && Array.isArray(options)) ? options.map(opt => {
                    if (typeof opt === 'string' || typeof opt === 'number') {
                        return { label: String(opt), value: String(opt) };
                    }
                    return {
                        label: opt.label || opt.name || opt.value,
                        value: opt.value !== undefined ? opt.value : opt
                    };
                }) : [],
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

                        // Initialize global clause structure whether excluded or not
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

                        if (!isExcluded) {
                            if (!categoriesMap[catKey].allowed_clauses.includes(clauseKey)) {
                                categoriesMap[catKey].allowed_clauses.push(clauseKey);
                            }
                            if (!allClauses[clauseKey].categories.includes(catKey)) {
                                allClauses[clauseKey].categories.push(catKey);
                            }
                        } else {
                            if (!allClauses[clauseKey].excluded_categories.includes(catKey)) {
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
                    // CRITICAL FIX: Do not inherit if the child category explicitly excluded this clause!
                    const isExcludedByChild = allClauses[clauseKey] && allClauses[clauseKey].excluded_categories && allClauses[clauseKey].excluded_categories.includes(catKey);

                    if (!isExcludedByChild && !categoriesMap[catKey].allowed_clauses.includes(clauseKey)) {
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

        // ===== 5. VENDORS (comprehensive — all new schema fields) =====
        console.log('🏪 Fetching vendors with full profile data...');

        // Introspect which optional columns actually exist in users table (safe across migration states)
        const optionalUserCols = ['business_description', 'business_thumbnail', 'business_backdrop', 'kyc_status', 'kyb_status'];
        const existingColsRes = await pool.query(`
            SELECT attname FROM pg_attribute
            WHERE attrelid = 'users'::regclass AND attnum > 0 AND NOT attisdropped
              AND attname = ANY($1)
        `, [optionalUserCols]);
        const existingCols = new Set(existingColsRes.rows.map(r => r.attname));
        console.log(`  ↳ Optional user columns available: ${[...existingCols].join(', ') || 'none'}`);

        const optionalSelects = optionalUserCols
            .map(col => existingCols.has(col) ? `u.${col}` : `NULL AS ${col}`)
            .join(',\n                ');

        const groupByOptional = optionalUserCols
            .filter(col => existingCols.has(col))
            .map(col => `u.${col}`)
            .join(', ');

        const vendorRes = await pool.query(`
            SELECT
                u.id,
                u.business_name,
                u.first_name,
                u.last_name,
                u.checkout_style,
                u.whatsapp_phone,
                ${optionalSelects},
                COUNT(DISTINCT p.id) as product_count
            FROM users u
            JOIN products p ON p.created_by = u.id AND p.tenant_id = $1 AND p.deleted_at IS NULL
            WHERE p.tenant_id = $1
            GROUP BY u.id, u.business_name, u.first_name, u.last_name, u.checkout_style,
                     u.whatsapp_phone${groupByOptional ? ', ' + groupByOptional : ''}
        `, [process.env.TENANT_ID]);

        const vendorsMap = {};
        const vendorIdToKey = {};

        vendorRes.rows.forEach(v => {
            const name = v.business_name || `${v.first_name} ${v.last_name}`.trim() || 'Store';
            const key = name.toLowerCase().replace(/\s+/g, '_');
            vendorsMap[key] = {
                id: v.id,
                business_name: name,
                tag: name,
                checkout_style: v.checkout_style || 'inhouse',
                whatsapp_phone: v.whatsapp_phone || null,
                business_description: v.business_description || null,
                business_thumbnail: v.business_thumbnail || null,
                business_backdrop: v.business_backdrop || null,
                kyc_status: v.kyc_status || 'none',
                kyb_status: v.kyb_status || 'none',
                product_count: parseInt(v.product_count) || 0,
                categories: [],
                primary_location: null,
                delivery_zones: [],
                shipping_config: null,
                avg_rating: null,
                total_ratings: 0
            };
            vendorIdToKey[v.id] = key;
        });

        console.log(`✅ ${Object.keys(vendorsMap).length} vendors loaded`);


        // ===== 5b. CATEGORY LEDGER (categories each vendor actually sells in) =====
        console.log('📒 Fetching vendor category ledgers...');
        const ledgerRes = await pool.query(`
            SELECT vcl.vendor_id, vcl.category_id, vcl.product_count, c.name as category_name, c.slug as category_slug
            FROM vendor_category_ledger vcl
            JOIN categories c ON vcl.category_id = c.id
            WHERE vcl.tenant_id = $1 AND vcl.vendor_id IS NOT NULL AND vcl.product_count > 0
            ORDER BY vcl.product_count DESC
        `, [process.env.TENANT_ID]);

        ledgerRes.rows.forEach(row => {
            const key = vendorIdToKey[row.vendor_id];
            if (key && vendorsMap[key]) {
                vendorsMap[key].categories.push({
                    id: row.category_id,
                    label: row.category_name,
                    slug: row.category_slug,
                    product_count: row.product_count
                });
            }
        });

        // ===== 5c. PRIMARY LOCATION (vendor's main business address) =====
        console.log('📍 Fetching vendor primary locations...');
        const locRes = await pool.query(`
            SELECT DISTINCT ON (vendor_id)
                vendor_id, scope, continent, country, state, city, address, is_primary
            FROM vendor_locations
            WHERE tenant_id = $1
            ORDER BY vendor_id, is_primary DESC, created_at ASC
        `, [process.env.TENANT_ID]);

        locRes.rows.forEach(row => {
            const key = vendorIdToKey[row.vendor_id];
            if (key && vendorsMap[key]) {
                vendorsMap[key].primary_location = {
                    scope: row.scope,
                    continent: row.continent || null,
                    country: row.country || null,
                    state: row.state || null,
                    city: row.city || null,
                    address: row.address || null
                };
            }
        });

        // ===== 5d. SHIPPING CONFIG (base fee + processing SLA per vendor) =====
        console.log('🚚 Fetching vendor shipping configs...');
        const shipConfigRes = await pool.query(`
            SELECT vendor_id, global_base_fee, global_processing_min, global_processing_max
            FROM vendor_shipping_configs
            WHERE tenant_id = $1
        `, [process.env.TENANT_ID]);

        shipConfigRes.rows.forEach(row => {
            const key = vendorIdToKey[row.vendor_id];
            if (key && vendorsMap[key]) {
                vendorsMap[key].shipping_config = {
                    base_fee: parseFloat(row.global_base_fee) || 0,
                    processing_days_min: row.global_processing_min ?? 1,
                    processing_days_max: row.global_processing_max ?? 2
                };
            }
        });

        // ===== 5e. DELIVERY ZONES (where each vendor ships to + transit times) =====
        console.log('🗺️  Fetching vendor delivery zones...');
        const shipZoneRes = await pool.query(`
            SELECT
                vsz.vendor_id,
                vsz.location_type,
                vsz.multiplier,
                vsz.transit_min,
                vsz.transit_max,
                CASE
                    WHEN vsz.location_type = 'country'  THEN co.name
                    WHEN vsz.location_type = 'state'    THEN st.name
                    WHEN vsz.location_type = 'landmark' THEN lm.name
                END AS location_name,
                CASE
                    WHEN vsz.location_type = 'state'    THEN co2.name
                    WHEN vsz.location_type = 'landmark' THEN co3.name
                    ELSE NULL
                END AS country_name
            FROM vendor_shipping_zones vsz
            LEFT JOIN countries  co  ON vsz.location_type = 'country'  AND vsz.location_id = co.id  AND co.tenant_id  = $1
            LEFT JOIN states     st  ON vsz.location_type = 'state'    AND vsz.location_id = st.id
            LEFT JOIN countries  co2 ON st.country_id = co2.id         AND co2.tenant_id    = $1
            LEFT JOIN landmarks  lm  ON vsz.location_type = 'landmark' AND vsz.location_id = lm.id
            LEFT JOIN states     st3 ON lm.state_id = st3.id
            LEFT JOIN countries  co3 ON st3.country_id = co3.id        AND co3.tenant_id    = $1
            WHERE vsz.tenant_id = $1
            ORDER BY vsz.vendor_id, vsz.location_type, location_name
        `, [process.env.TENANT_ID]);

        shipZoneRes.rows.forEach(row => {
            const key = vendorIdToKey[row.vendor_id];
            if (key && vendorsMap[key]) {
                vendorsMap[key].delivery_zones.push({
                    type: row.location_type,
                    name: row.location_name || null,
                    country: row.country_name || null,
                    multiplier: parseFloat(row.multiplier) || 1,
                    transit_min: row.transit_min ?? 1,
                    transit_max: row.transit_max ?? 3
                });
            }
        });

        // ===== 5f. AVG RATING (aggregated across all vendor's products) =====
        console.log('⭐ Fetching vendor average ratings...');
        const ratingsRes = await pool.query(`
            SELECT
                p.created_by AS vendor_id,
                ROUND(AVG(prs.average_rating), 1) AS avg_rating,
                SUM(prs.total_ratings)::int AS total_ratings
            FROM product_rating_summary prs
            JOIN products p ON prs.product_id = p.id AND prs.tenant_id = $1
            WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
            GROUP BY p.created_by
        `, [process.env.TENANT_ID]);

        ratingsRes.rows.forEach(row => {
            const key = vendorIdToKey[row.vendor_id];
            if (key && vendorsMap[key]) {
                vendorsMap[key].avg_rating = parseFloat(row.avg_rating) || null;
                vendorsMap[key].total_ratings = parseInt(row.total_ratings) || 0;
            }
        });

        console.log(`✅ Vendor profiles enriched with locations, ledger, shipping & ratings`);

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
