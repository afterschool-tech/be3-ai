#!/usr/bin/env node
/**
 * download-logs.js
 * Fetches debug runs from the /logs endpoint and writes them as .log files
 * that are byte-identical to what the local file logger produces.
 *
 * Usage:
 *   node scripts/download-logs.js                      # download all runs
 *   node scripts/download-logs.js req_17756028550      # download one run
 *   node scripts/download-logs.js --host https://your-render-url.onrender.com
 *
 * Output: logs/runs/<runId>.log  (same folder your local logger uses)
 */

require('dotenv').config();
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── Config ───────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const hostFlag  = args.indexOf('--host');
const BASE_URL  = hostFlag !== -1
    ? args[hostFlag + 1]
    : `http://localhost:${process.env.PORT || 3005}`;

// Any arg that isn't a flag or flag-value is treated as a runId filter
const runIdFilter = args.filter((a, i) => !a.startsWith('--') && i !== hostFlag + 1);

const OUT_DIR = path.join(__dirname, '../logs/runs');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function get(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Bad JSON from ${url}: ${data.slice(0, 200)}`)); }
            });
        }).on('error', reject);
    });
}

// ─── Format one entry exactly like the file logger does ───────────────────────
function formatEntry(entry) {
    const { _type, section, timestamp, data, ...rest } = entry;

    if (_type === 'RUN_START') return null;

    const sectionLabel = section || _type || 'UNKNOWN';

    // content is either the old .data property or the spread properties
    const content = data !== undefined ? data : rest;

    // Reproduce legacy file logger logic:
    // If it's the { message: "..." } wrapper for strings, take just the string.
    // Otherwise, if it's an object, stringify it.
    let body;
    if (typeof content === 'object' && content !== null) {
        if (Object.keys(content).length === 1 && content.message !== undefined) {
            body = String(content.message);
        } else {
            body = JSON.stringify(content, null, 2);
        }
    } else {
        body = String(content ?? '');
    }

    return `[${timestamp}] [${sectionLabel}]\n${body}\n\n------------------------------\n`;
}

// ─── Build the .log file content from an array of entries ─────────────────────
function buildLogFile(runId, entries) {
    // Find the RUN_START entry for the header timestamp
    const startEntry = entries.find(e => e._type === 'RUN_START');
    const startTs    = startEntry?.timestamp || new Date().toISOString();

    const header = `=== DEBUG LOG START: ${startTs} | RUN ID: ${runId} ===\n\n`;
    const body   = entries
        .map(formatEntry)
        .filter(Boolean)
        .join('\n');

    return header + body;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\n📡 Fetching log index from ${BASE_URL}/logs ...`);

    let runIds;
    try {
        const index = await get(`${BASE_URL}/logs`);
        if (!index.success) throw new Error(index.error || 'Unknown error');
        runIds = index.runIds || [];
    } catch (e) {
        console.error(`❌ Could not reach /logs: ${e.message}`);
        console.error('   Is the server running? Try --host <url> if using Render.');
        process.exit(1);
    }

    if (runIds.length === 0) {
        console.log('ℹ️  No runs found in Redis. Enable :filelog in the REPL and run a request first.');
        return;
    }

    // Apply any runId filter
    const targets = runIdFilter.length > 0
        ? runIds.filter(id => runIdFilter.some(f => id.includes(f)))
        : runIds;

    if (targets.length === 0) {
        console.log(`ℹ️  No runs matched filter: ${runIdFilter.join(', ')}`);
        console.log(`   Available runs: ${runIds.join(', ')}`);
        return;
    }

    console.log(`📋 Found ${runIds.length} run(s). Downloading ${targets.length}...\n`);

    for (const runId of targets) {
        process.stdout.write(`  ⬇  ${runId} ... `);
        try {
            const res = await get(`${BASE_URL}/logs/${runId}`);
            if (!res.success) throw new Error(res.error || 'Unknown error');

            const entries = res.entries || [];
            
            // ─── Filename logic: run_<timestamp>_<runId>.log ────────────────
            const startEntry = entries.find(e => e._type === 'RUN_START');
            const isoTs      = startEntry?.timestamp || new Date().toISOString();
            const unixTs     = new Date(isoTs).getTime();
            const fileName   = `run_${unixTs}_${runId}.log`;
            
            const content = buildLogFile(runId, entries);
            const outPath = path.join(OUT_DIR, fileName);

            fs.writeFileSync(outPath, content, 'utf8');
            console.log(`✅  ${entries.length} entries → ${path.relative(process.cwd(), outPath)}`);
        } catch (e) {
            console.log(`❌  ${e.message}`);
        }
    }

    console.log('\n✅ Done. Open the .log files in your telemetry tool as usual.\n');
}

main();
