/**
 * Be3 RAG REPL
 * Interactive test shell for the Active Knowledge RAG pipeline.
 * 
 * Usage:
 *   node rag_repl.js
 * 
 * Commands:
 *   /pin vendor <uuid>    - Hard-pin a specific vendor for the session
 *   /pin category <uuid>  - Hard-pin a specific category for the session
 *   /clear                - Clear the current pin and ambient context
 *   /list vendors         - List all indexed vendors
 *   /list categories      - List 20 indexed categories
 *   /list policies        - List all policy & identity chunks
 *   /exit                 - Quit the REPL
 */

require('dotenv').config();
const readline = require('readline');
const { processRAGQuery, rawSearch } = require('./src/core/ragService');
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'saas_ecommerce',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '343434',
});

const SESSION_ID = `repl-session-${Date.now()}`;
const state = { vendor: null, category: null, rawMode: false };

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

function prompt() {
    const pin = state.vendor
        ? `📌 vendor:${state.vendor.slice(0, 8)}…`
        : state.category
            ? `📌 category:${state.category.slice(0, 8)}…`
            : 'no pin';
    const mode = state.rawMode ? ' \x1b[33m[RAW]\x1b[0m' : '';
    rl.question(`\n\x1b[36m[Be3 RAG | ${pin}]${mode}\x1b[0m > `, handleInput);
}

async function handleInput(input) {
    input = input.trim();
    if (!input) return prompt();

    if (input === '/exit') {
        console.log('\nBye! 👋');
        await pool.end();
        process.exit(0);
    }

    if (input === '/clear') {
        state.vendor = null;
        state.category = null;
        console.log('\x1b[33m✓ Context cleared\x1b[0m');
        return prompt();
    }

    if (input === '/raw') {
        state.rawMode = !state.rawMode;
        console.log(`\x1b[33m✓ Raw mode ${state.rawMode ? 'ON — showing chunks without LLM' : 'OFF — full RAG pipeline'}\x1b[0m`);
        return prompt();
    }

    if (input.startsWith('/pin vendor ')) {
        state.vendor = input.slice('/pin vendor '.length);
        state.category = null;
        console.log(`\x1b[33m✓ Vendor pinned: ${state.vendor}\x1b[0m`);
        return prompt();
    }

    if (input.startsWith('/pin category ')) {
        state.category = input.slice('/pin category '.length);
        state.vendor = null;
        console.log(`\x1b[33m✓ Category pinned: ${state.category}\x1b[0m`);
        return prompt();
    }

    if (input.startsWith('/list vendors')) {
        const parts = input.split(' ');
        const page = parseInt(parts[2]) || 1;
        const offset = (page - 1) * 20;

        const res = await pool.query(`SELECT id, entity_name FROM ai_knowledge_chunks WHERE type = 'vendor' ORDER BY entity_name LIMIT 20 OFFSET $1`, [offset]);
        console.log(`\n\x1b[36mIndexed Vendors (Page ${page}):\x1b[0m`);
        res.rows.forEach(r => console.log(`  ${r.id.padEnd(48)}  ${r.entity_name}`));
        if (res.rows.length === 20) console.log('\x1b[90m  (Type /list vendors ' + (page + 1) + ' for more)\x1b[0m');
        return prompt();
    }

    if (input.startsWith('/list categories')) {
        const parts = input.split(' ');
        const page = parseInt(parts[2]) || 1;
        const offset = (page - 1) * 20;

        const res = await pool.query(`SELECT id, entity_name, content FROM ai_knowledge_chunks WHERE type = 'category' ORDER BY entity_name LIMIT 20 OFFSET $1`, [offset]);
        console.log(`\n\x1b[36mIndexed Categories (Page ${page}):\x1b[0m`);
        res.rows.forEach(r => {
            console.log(`  \x1b[32m${r.entity_name.padEnd(30)}\x1b[0m ${r.id}`);
            // Extract the product count sentence if it exists
            const match = r.content.match(/has (\d+) products/i);
            const countStr = match ? `\x1b[33m[${match[1]} products]\x1b[0m` : `\x1b[90m[0 products]\x1b[0m`;
            console.log(`    ${countStr} ${r.content.substring(0, 100)}...`);
        });
        if (res.rows.length === 20) console.log('\x1b[90m  (Type /list categories ' + (page + 1) + ' for more)\x1b[0m');
        return prompt();
    }

    if (input === '/list policies') {
        const res = await pool.query(`SELECT id, entity_name, type FROM ai_knowledge_chunks WHERE type IN ('store_policy','store_identity') ORDER BY type, id`);
        console.log('\n\x1b[36mStore Policy & Identity Chunks:\x1b[0m');
        res.rows.forEach(r => console.log(`  [${r.type}]  ${r.id.padEnd(30)}  ${r.entity_name}`));
        return prompt();
    }

    if (input.startsWith('/')) {
        console.log('\x1b[31mUnknown command. Try /list vendors, /list categories, /list policies, /pin vendor <id>, /clear, /exit\x1b[0m');
        return prompt();
    }

    // Regular query
    const extracted = {};
    if (state.vendor) extracted.vendor = state.vendor;
    if (state.category) extracted.category = state.category;

    if (state.rawMode) {
        // RAW mode: just show matching chunks, no LLM
        console.log('\x1b[90m⏳ Running raw vector search...\x1b[0m');
        try {
            const raw = await rawSearch(SESSION_ID, input, extracted);
            if (raw.error) {
                console.log(`\x1b[31mError: ${raw.error}\x1b[0m`);
            } else if (!raw.selected.length && !raw.dropped.length) {
                console.log('\x1b[31m⚠ No chunks matched above threshold.\x1b[0m');
            } else {
                console.log(`\n\x1b[36mQuery: "${raw.query}" | Pin: ${raw.pin || 'none'}\x1b[0m`);

                let idx = 1;
                raw.selected.forEach(c => {
                    const sim = parseFloat(c.similarity).toFixed(4);
                    // Green for selected
                    console.log(`\n\x1b[32m[${idx++}] ${c.id}  (sim: ${sim})  [${c.type}] ✓ SELECTED\x1b[0m`);
                    console.log(`    \x1b[32m${c.content.slice(0, 220)}${c.content.length > 220 ? '…' : ''}\x1b[0m`);
                });

                raw.dropped.forEach(c => {
                    const sim = parseFloat(c.similarity).toFixed(4);
                    // Yellow for dropped candidates
                    console.log(`\n\x1b[33m[${idx++}] ${c.id}  (sim: ${sim})  [${c.type}] ✗ SKIPPED\x1b[0m`);
                    console.log(`    ${c.content.slice(0, 220)}${c.content.length > 220 ? '…' : ''}`);
                });
            }
        } catch (e) {
            console.error('\x1b[31mError:\x1b[0m', e.message);
        }
        return prompt();
    }

    // Full RAG mode
    console.log('\x1b[90m⏳ Searching knowledge base...\x1b[0m');
    try {
        const result = await processRAGQuery(SESSION_ID, input, extracted);

        if (!result) {
            console.log('\x1b[31m⚠ No relevant knowledge found. Try rephrasing or using /list to see what is indexed.\x1b[0m');
        } else {
            console.log('\n\x1b[32m──────────────────────────────────────────────\x1b[0m');
            console.log(`\x1b[97m${result.message}\x1b[0m`);
            if (result.whatsapp?.buttons?.length) {
                console.log('\n\x1b[33mButtons:\x1b[0m');
                result.whatsapp.buttons.forEach(b => console.log(`  [ ${b.title} ]  →  ${b.id}`));
            }
            console.log('\x1b[32m──────────────────────────────────────────────\x1b[0m');
        }
    } catch (e) {
        console.error('\x1b[31mRAG Error:\x1b[0m', e.message);
    }

    prompt();
}

async function start() {
    console.log('\x1b[1;36m');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║       Be3 Active RAG  REPL  🧠       ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('\x1b[0m');
    console.log('  Type any question to query the RAG pipeline.');
    console.log('  Commands: /list vendors · /list categories · /list policies');
    console.log('            /pin vendor <uuid> · /clear · /raw (toggle chunk mode) · /exit\n');

    // Quick health check
    try {
        const check = await pool.query(`SELECT COUNT(*) FROM ai_knowledge_chunks`);
        console.log(`\x1b[90m  ✓ Knowledge base: ${check.rows[0].count} chunks loaded\x1b[0m\n`);
    } catch (e) {
        console.error('\x1b[31m  ✗ DB connection failed:', e.message, '\x1b[0m\n');
    }

    prompt();
}

start();
