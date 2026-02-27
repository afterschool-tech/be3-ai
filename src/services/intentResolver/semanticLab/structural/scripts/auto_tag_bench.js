/**

 * Auto-Tag Bench - Uses AI to generate structural templates for untagged variations

 */

const fs = require('fs');

const path = require('path');

const crypto = require('crypto');



const { queryAI } = require('../../../../../core/hfAiService');



const DEFAULT_BENCH_FILE = path.join(__dirname, '../data/slot_bench.json');

const LOG_FILE = path.join(__dirname, '../logs/auto_tag.log');



const log = (msg) => {

    const timestamp = new Date().toISOString();

    try {

        fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

        fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);

    } catch (e) {

        // If logging fails, still allow script to run.

    }

    console.log(msg);

};



function parseArgs(argv) {

    const args = {};

    for (const raw of argv.slice(2)) {

        if (!raw.startsWith('--')) continue;

        const [k, v] = raw.slice(2).split('=');

        args[k] = v === undefined ? true : v;

    }

    return args;

}



function toInt(val, fallback) {

    const n = parseInt(String(val), 10);

    return Number.isFinite(n) ? n : fallback;

}



function toFloat(val, fallback) {

    const n = parseFloat(String(val));

    return Number.isFinite(n) ? n : fallback;

}



function stripFencesAndQuotes(s) {

    if (!s) return '';

    let out = String(s).trim();

    out = out.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();

    out = out.replace(/^"/, '').replace(/"$/, '').trim();

    return out;

}



function normalizeDoubleBrackets(template, allowedSlots) {

    if (!template) return template;

    return template.replace(/\[\[\s*([a-zA-Z0-9_]+)\s*\]\]/g, (m, slotName) => {

        const normalized = `[${slotName}]`;

        return allowedSlots.has(normalized) ? normalized : m;

    });

}



function extractSlotNames(template) {

    const names = [];

    const re = /\[([^\]]+)\]/g;

    let match;

    while ((match = re.exec(template))) {

        names.push(match[1]);

    }

    return names;

}



function sleep(ms) {

    return new Promise(resolve => setTimeout(resolve, ms));

}



function md5(s) {

    return crypto.createHash('md5').update(String(s)).digest('hex');

}



function readJsonIfExists(filePath) {

    if (!filePath) return null;

    if (!fs.existsSync(filePath)) return null;

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));

}



function writeJsonAtomic(filePath, obj) {

    const tmp = `${filePath}.tmp`;

    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));

    fs.renameSync(tmp, filePath);

}



function parseIntentList(rawIntent, data) {

    const s = String(rawIntent || '').trim();

    if (!s) return [];

    if (s === 'all') return Object.keys(data);

    return s.split(',').map(x => x.trim()).filter(Boolean);

}



async function generateTemplateWithAI(text, slots, opts) {

    const prompt = [

        {

            role: 'system',

            content: `You are a template generator for a structural extraction system.

Given a user query and a list of available slot tags, replace the entity values in the query with the appropriate tags.

Available tags: ${slots.join(', ')}

Return ONLY the tagged template string, with no explanations and no code fences.`

        },

        {

            role: 'user',

            content: `Query: "${text}"\nTemplate:`

        }

    ];



    try {

        const response = await queryAI(

            prompt,

            opts.maxTokens,

            opts.temperature,

            2,

            {},

            opts.model || null

        );



        return stripFencesAndQuotes(response);

    } catch (err) {

        log(`AI Error for "${text}": ${err.message}`);

        return null;

    }

}



async function main() {

    const args = parseArgs(process.argv);



    const inFile = String(args.in || DEFAULT_BENCH_FILE);

    const outFile = String(

        args.out ||

        path.join(path.dirname(inFile), `slot_bench.ai_preview.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

    );



    const rawIntent = args.intent ? String(args.intent) : '';

    const limit = toInt(args.limit, 0); // 0 = no limit

    const continuous = String(args.continuous || '0') === '1';

    const mode = String(args.mode || (continuous ? 'append' : 'replace')); // replace | append



    const delayMs = toInt(args.delayMs, 250);

    const cooldownEvery = toInt(args.cooldownEvery, 0);

    const cooldownMs = toInt(args.cooldownMs, 10000);

    const saveEvery = toInt(args.saveEvery, 10);



    const maxTokens = toInt(args.maxTokens, 120);

    const temperature = toFloat(args.temperature, 0);

    const model = args.model ? String(args.model) : null;



    if (!rawIntent) {

        log('Error: Missing required --intent=<intentName|comma,list|all>');

        process.exitCode = 1;

        return;

    }



    if (!fs.existsSync(inFile)) {

        log(`Error: Input slot bench not found at ${inFile}`);

        process.exitCode = 1;

        return;

    }



    if (fs.existsSync(outFile) && args.overwrite) {

        // ok

    }



    const baseData = readJsonIfExists(!args.overwrite ? outFile : null) || JSON.parse(fs.readFileSync(inFile, 'utf8'));

    const intentList = parseIntentList(rawIntent, baseData);

    if (intentList.length === 0) {

        log(`Error: No intents resolved from --intent=${rawIntent}`);

        process.exitCode = 1;

        return;

    }



    const slots = ['[product]', '[clause]', '[category]', '[vendor]', '[quantity]', '[price]', '[attribute]'];

    const allowedSlots = new Set(slots);



    const progressFile = String(

        args.progress ||

        path.join(path.dirname(outFile), `auto_tag_progress.${path.basename(outFile)}.json`)

    );

    const progress = readJsonIfExists(progressFile) || { intents: {} };



    log('Starting AI-assisted structural preview tagging...');

    log(`Input: ${inFile}`);

    log(`Output: ${outFile}`);

    log(`Intents: ${intentList.join(', ')}`);

    log(`Limit: ${limit || '(none)'}`);

    log(`Mode: ${mode}`);

    log(`AI params: { maxTokens: ${maxTokens}, temperature: ${temperature}, model: ${model || '(default)'} }`);

    if (continuous) {

        log(`Continuous: 1 (delayMs=${delayMs}, cooldownEvery=${cooldownEvery || 'off'}, cooldownMs=${cooldownMs}, saveEvery=${saveEvery})`);

        log(`Progress: ${progressFile}`);

    }



    let generated = 0;

    let kept = 0;

    let rejected = 0;

    let skipped = 0;

    let aiCalls = 0;

    let sinceCooldown = 0;

    let sinceSave = 0;



    for (const intentName of intentList) {

        const entry = baseData[intentName];

        if (!entry) {

            log(`  [SKIP:intent_missing] ${intentName}`);

            continue;

        }



        const variations = Array.isArray(entry.variations) ? entry.variations : [];

        const existingTemplates = new Set(Array.isArray(entry.slot_templates) ? entry.slot_templates : []);

        const outTemplates = new Set(mode === 'append' ? Array.from(existingTemplates) : []);



        const intentProgress = progress.intents[intentName] || { done: {} };

        progress.intents[intentName] = intentProgress;



        const toProcess = limit > 0 ? variations.slice(0, Math.max(0, limit)) : variations;

        log(`Processing intent: ${intentName} (variations=${variations.length}, targeting=${toProcess.length})`);



        for (const variation of toProcess) {

            const key = md5(variation);

            if (intentProgress.done[key]) {

                skipped++;

                continue;

            }



            const normalizedVariation = normalizeDoubleBrackets(String(variation), allowedSlots);

            let raw = null;

            try {

                raw = await generateTemplateWithAI(normalizedVariation, slots, { maxTokens, temperature, model });

            } catch (e) {

                raw = null;

            }



            generated++;

            aiCalls++;

            sinceCooldown++;

            sinceSave++;



            if (!raw) {

                rejected++;

                intentProgress.done[key] = { ok: false, at: new Date().toISOString() };

            } else {

                let template = normalizeDoubleBrackets(raw, allowedSlots);

                template = stripFencesAndQuotes(template);



                const slotNames = extractSlotNames(template);

                const invalid = slotNames.filter(n => !allowedSlots.has(`[${n.trim()}]`));

                if (invalid.length > 0) {

                    log(`  [REJECT:unknown_slot] "${variation}" -> "${template}" (unknown: ${invalid.join(', ')})`);

                    rejected++;

                    intentProgress.done[key] = { ok: false, reason: 'unknown_slot', at: new Date().toISOString() };

                } else {

                    outTemplates.add(template);

                    kept++;

                    intentProgress.done[key] = { ok: true, template, at: new Date().toISOString() };

                    log(`  [OK] "${variation}" -> "${template}"`);

                }

            }



            baseData[intentName] = {

                ...entry,

                slot_templates: Array.from(outTemplates)

            };



            if (continuous) {

                if (delayMs > 0) {

                    await sleep(delayMs);

                }

                if (cooldownEvery > 0 && sinceCooldown >= cooldownEvery) {

                    log(`Cooldown: sleeping ${cooldownMs}ms after ${sinceCooldown} AI calls`);

                    await sleep(cooldownMs);

                    sinceCooldown = 0;

                }

                if (saveEvery > 0 && sinceSave >= saveEvery) {

                    writeJsonAtomic(outFile, baseData);

                    writeJsonAtomic(progressFile, progress);

                    sinceSave = 0;

                }

            }

        }

    }



    writeJsonAtomic(outFile, baseData);

    writeJsonAtomic(progressFile, progress);

    log(`Done. aiCalls=${aiCalls}, generated=${generated}, kept=${kept}, rejected=${rejected}, skipped=${skipped}`);

}



// Note: This script is intended to be run manually by the developer

main();

