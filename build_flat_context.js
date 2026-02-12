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

async function buildContext() {
    try {
        console.log('🚀 Building Flat Context Tables from DB...');

        // 1. Fetch Categories
        const catRes = await pool.query('SELECT id, name, slug, description FROM categories WHERE tenant_id = $1', [process.env.TENANT_ID]);
        const categories = {};
        catRes.rows.forEach(c => {
            categories[c.name.toLowerCase().replace(/\s+/g, '_')] = {
                id: c.id,
                label: c.name,
                slug: c.slug,
                description: c.description || '',
                attributes: [],
                allowed_clauses: []
            };
        });

        // 2. Fetch Attributes & Clauses
        const attrRes = await pool.query(`
            SELECT 
                a.label as attr_label, 
                a.clauses, 
                ca.excluded_clauses,
                c.name as category_name
            FROM attributes a
            JOIN category_attributes ca ON ca.attribute_id = a.id
            JOIN categories c ON ca.category_id = c.id
            WHERE a.tenant_id = $1
        `, [process.env.TENANT_ID]);

        const allClauses = {};
        attrRes.rows.forEach(row => {
            const catKey = row.category_name.toLowerCase().replace(/\s+/g, '_');
            if (categories[catKey]) {
                if (!categories[catKey].attributes.includes(row.attr_label)) {
                    categories[catKey].attributes.push(row.attr_label);
                }

                if (row.clauses && Array.isArray(row.clauses)) {
                    row.clauses.forEach(clause => {
                        const clauseKey = clause.label.toLowerCase().replace(/\s+/g, '_');

                        // Check if this clause is excluded for this category
                        const isExcluded = row.excluded_clauses && Array.isArray(row.excluded_clauses) && row.excluded_clauses.includes(clause.name);

                        if (!isExcluded) {
                            if (!categories[catKey].allowed_clauses.includes(clauseKey)) {
                                categories[catKey].allowed_clauses.push(clauseKey);
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
                            if (!allClauses[clauseKey]?.excluded_categories.includes(catKey)) {
                                if (allClauses[clauseKey]) allClauses[clauseKey].excluded_categories.push(catKey);
                            }
                        }
                    });
                }
            }
        });

        // 3. Fetch Collections
        const collRes = await pool.query('SELECT id, name, slug FROM collections WHERE tenant_id = $1', [process.env.TENANT_ID]);
        const collections = {};
        collRes.rows.forEach(c => {
            collections[c.name.toLowerCase().replace(/\s+/g, '_')] = {
                id: c.id,
                label: c.name,
                slug: c.slug,
                categories: null // Default all
            };
        });

        // 4. Fetch Vendors
        const vendorRes = await pool.query(`
            SELECT DISTINCT u.id, u.business_name, u.first_name, u.last_name, u.email
            FROM users u
            JOIN products p ON p.created_by = u.id
            WHERE p.tenant_id = $1
        `, [process.env.TENANT_ID]);
        const vendors = {};
        vendorRes.rows.forEach(v => {
            const name = v.business_name || `${v.first_name} ${v.last_name}`.trim() || 'Store';
            vendors[name.toLowerCase().replace(/\s+/g, '_')] = {
                id: v.id,
                business_name: name,
                tag: name,
                delivery_scope: "Local & National",
                categories: []
            };
        });

        // 5. Fetch Category Inventory (product counts)
        const inventoryRes = await pool.query(`
            SELECT c.slug, COUNT(pc.product_id) as product_count
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.slug
        `, [process.env.TENANT_ID]);

        const categoryInventory = {};
        inventoryRes.rows.forEach(r => {
            categoryInventory[r.slug] = parseInt(r.product_count);
        });

        // Write storeContext.js
        const contextContent = `
/**
 * AUTO-GENERATED Store Context
 * Generated on: ${new Date().toISOString()}
 */
const CATEGORIES = ${JSON.stringify(categories, null, 4)};
const COLLECTIONS = ${JSON.stringify(collections, null, 4)};
const VENDORS = ${JSON.stringify(vendors, null, 4)};
const BUSINESSES = { ...VENDORS };
const CATEGORY_INVENTORY = ${JSON.stringify(categoryInventory, null, 4)};

module.exports = { CATEGORIES, COLLECTIONS, VENDORS, BUSINESSES, CATEGORY_INVENTORY };
`;
        fs.writeFileSync('storeContext.js', contextContent);
        console.log('✅ storeContext.js updated');

        // Write clauses.js
        const clausesContent = `
/**
 * AUTO-GENERATED Semantic Clauses
 * Generated on: ${new Date().toISOString()}
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
        fs.writeFileSync('clauses.js', clausesContent);
        console.log('✅ clauses.js updated');

    } catch (err) {
        console.error('❌ Build failed:', err.message);
    } finally {
        await pool.end();
    }
}

buildContext();
