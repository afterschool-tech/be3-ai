const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'saas_ecommerce',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '343434',
});

async function testAttributes() {
    try {
        const attrRes = await pool.query(`
            SELECT id, label, code, type, options, clauses
            FROM attributes
            WHERE tenant_id = $1
        `, [process.env.TENANT_ID]);

        console.log(`Found ${attrRes.rows.length} attributes`);

        const attributesMap = {};
        attrRes.rows.forEach((a, idx) => {
            console.log(`\nProcessing attribute ${idx + 1}/${attrRes.rows.length}: ${a.label}`);
            try {
                const key = a.label.toLowerCase().replace(/\s+/g, '_');

                // Parse options
                let options = [];
                try {
                    options = typeof a.options === 'string' ? JSON.parse(a.options) : (a.options || []);
                } catch (e) {
                    console.log(`  ⚠️  Options parse error: ${e.message}`);
                    options = [];
                }

                // Parse clauses
                let clauses = [];
                try {
                    clauses = typeof a.clauses === 'string' ? JSON.parse(a.clauses) : (a.clauses || []);
                } catch (e) {
                    console.log(`  ⚠️  Clauses parse error: ${e.message}`);
                    clauses = [];
                }

                console.log(`  Options: ${options.length}, Clauses: ${clauses.length}`);

                attributesMap[key] = {
                    id: a.id,
                    code: a.code,
                    label: a.label,
                    type: a.type || 'text',
                    predefined_values: options.map(opt => ({
                        label: opt.label || opt.name || opt.value,
                        value: opt.value
                    })),
                    clauses: clauses.filter(c => c && c.label).map(c => ({
                        name: c.name || c.label.toLowerCase().replace(/\s+/g, '_'),
                        label: c.label,
                        matches: Array.isArray(c.value) ? c.value : (c.value ? [c.value] : []),
                        operator: c.operator || '=',
                        prefix: c.prefix || '',
                        suffix: c.suffix || ''
                    })),
                    categories: []
                };
                console.log(`  ✅ Success`);
            } catch (err) {
                console.error(`  ❌ Error processing ${a.label}:`, err.message);
                console.error(err.stack);
            }
        });

        console.log(`\n✅ Processed ${Object.keys(attributesMap).length} attributes`);

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err.stack);
    } finally {
        await pool.end();
    }
}

testAttributes();
