const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'saas_ecommerce',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '343434',
});

async function gatherData() {
    try {
        console.log('--- GATHERING REAL STORE DATA ---');

        // 1. Categories
        console.log('\n[Categories]');
        const cats = await pool.query('SELECT id, name, slug, description FROM categories WHERE tenant_id = $1', [process.env.TENANT_ID]);
        console.log(JSON.stringify(cats.rows, null, 2));

        // 2. Collections
        console.log('\n[Collections]');
        const colls = await pool.query('SELECT id, name, slug, description FROM collections WHERE tenant_id = $1', [process.env.TENANT_ID]);
        console.log(JSON.stringify(colls.rows, null, 2));

        // 3. Vendors/Businesses
        console.log('\n[Vendors/Businesses]');
        const vendors = await pool.query(`
            SELECT DISTINCT u.id, u.name as business_name, u.email
            FROM users u
            JOIN products p ON p.created_by = u.id
            WHERE p.tenant_id = $1
        `, [process.env.TENANT_ID]);
        console.log(JSON.stringify(vendors.rows, null, 2));

        // 4. Products to infer attributes (sample)
        console.log('\n[Product Attributes Sample]');
        const products = await pool.query(`
            SELECT id, name, attributes 
            FROM products 
            WHERE tenant_id = $1 
            LIMIT 5
        `, [process.env.TENANT_ID]);
        console.log(JSON.stringify(products.rows, null, 2));

        // 5. Category Inventory Counts
        console.log('\n[Category Product Counts]');
        const inventory = await pool.query(`
            SELECT c.slug, COUNT(pc.product_id) as product_count
            FROM categories c
            LEFT JOIN product_categories pc ON c.id = pc.category_id
            WHERE c.tenant_id = $1
            GROUP BY c.slug
            ORDER BY product_count DESC
        `, [process.env.TENANT_ID]);
        console.log(JSON.stringify(inventory.rows, null, 2));

    } catch (err) {
        console.error('Error gathering data:', err.message);
    } finally {
        await pool.end();
    }
}

gatherData();
