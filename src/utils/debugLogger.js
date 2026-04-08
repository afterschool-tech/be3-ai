const fs = require('fs');
const path = require('path');
const redis = require('redis');

// DEBUG=true  → logging on (Redis if DEBUG_REDIS_URL set, else local files)
// DEBUG=false → completely silent — regardless of NODE_ENV
const DEBUG_ENABLED = process.env.DEBUG === 'true';
// Uses a DEDICATED Redis connection (DEBUG_REDIS_URL) so log commands never
// eat into the main state Redis budget (important on Upstash free tier).
const DEBUG_REDIS_URL = process.env.DEBUG_REDIS_URL;
const HAS_REDIS_URL = !!DEBUG_REDIS_URL;

// ─── Local log directories (only created when Redis is unavailable) ──────────
const LOGS_DIR = path.join(__dirname, '../../logs/runs');
if (DEBUG_ENABLED && !HAS_REDIS_URL) {
    try {
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
        }
    } catch (e) { /* silently skip */ }
}

// ─── Redis key constants ─────────────────────────────────────────────────────
// Each request gets its own List:  be3:debug:run:<runId>
// A master index List tracks all run IDs: be3:debug:runs
const REDIS_RUN_PREFIX = 'be3:debug:run:';
const REDIS_RUN_INDEX  = 'be3:debug:runs';

// ─── State ───────────────────────────────────────────────────────────────────
let currentRunId   = null;   // active runId for RPUSH targeting
let currentRunFile = null;   // active file path (dev only)

// ─── Dedicated debug Redis connection ────────────────────────────────────────
// Completely separate from the state Redis — own connection, own command budget.
let _debugClient = null;
let _debugConnecting = false;

async function getDebugClient() {
    if (_debugClient) return _debugClient;
    if (_debugConnecting || !DEBUG_REDIS_URL) return null;
    _debugConnecting = true;
    try {
        const client = redis.createClient({ url: DEBUG_REDIS_URL });
        client.on('error', e => console.warn('[DebugLogger] Redis error:', e.message));
        await client.connect();
        _debugClient = client;
        console.log('[DebugLogger] Dedicated debug Redis connected');
    } catch (e) {
        console.warn('[DebugLogger] Could not connect to debug Redis:', e.message);
    }
    _debugConnecting = false;
    return _debugClient;
}

// Initialise eagerly when DEBUG is on so the connection is ready before the first request
if (DEBUG_ENABLED && HAS_REDIS_URL) {
    getDebugClient().catch(() => {});
}

// ─── Fire-and-forget Redis push (never blocks the request pipeline) ──────────
function redisPush(key, value) {
    // getDebugClient() returns a Promise — resolve it then push, all async, never awaited
    getDebugClient().then(client => {
        if (!client) return;
        client.rPush(key, value).catch(e => {
            if (!redisPush._warned) {
                console.warn('[DebugLogger] Redis RPUSH failed:', e.message);
                redisPush._warned = true;
            }
        });
    });
}

// ─── startRun ────────────────────────────────────────────────────────────────
/**
 * Open a new log "run" for one request/pipeline execution.
 *
 * DEBUG=true + REDIS_URL set → Redis List  be3:debug:run:<runId>  (no TTL)
 * DEBUG=true + no REDIS_URL  → local .log file (same as legacy behaviour)
 * DEBUG=false                → no-op
 */
function startRun(runId) {
    if (!DEBUG_ENABLED) return null;

    currentRunId = runId;

    const header = JSON.stringify({
        _type: 'RUN_START',
        runId,
        timestamp: new Date().toISOString()
    });

    if (HAS_REDIS_URL) {
        // Redis path — register in master index then write the opening entry
        redisPush(REDIS_RUN_INDEX, runId);
        redisPush(`${REDIS_RUN_PREFIX}${runId}`, header);
        return `redis:${REDIS_RUN_PREFIX}${runId}`;
    }

    // File path — unchanged legacy behaviour
    try {
        const filename = `run_${Date.now()}_${runId}.log`;
        currentRunFile = path.join(LOGS_DIR, filename);
        const initialHeader = `=== DEBUG LOG START: ${new Date().toISOString()} | RUN ID: ${runId} ===\n\n`;
        fs.writeFileSync(currentRunFile, initialHeader);
    } catch (e) {
        currentRunFile = null;
    }

    return currentRunFile;
}

// ─── logDebug ────────────────────────────────────────────────────────────────
/**
 * Append a section + data snapshot to the current run.
 *
 * DEBUG=true + REDIS_URL → RPUSH to be3:debug:run:<currentRunId> (no TTL)
 * DEBUG=true + no REDIS_URL → append to local files
 * DEBUG=false → no-op
 */
function logDebug(section, data) {
    if (!DEBUG_ENABLED || !currentRunId) return;

    const timestamp = new Date().toISOString();

    if (HAS_REDIS_URL) {
        // Redis path — self-contained JSON entry per log call
        const entry = JSON.stringify({
            timestamp,
            section,
            ...(typeof data === 'object' && data !== null ? data : { message: String(data ?? '') })
        });
        redisPush(`${REDIS_RUN_PREFIX}${currentRunId}`, entry);
        return;
    }

    // File path — unchanged legacy behaviour
    const formattedData = typeof data === 'object' && data !== null
        ? JSON.stringify(data, null, 2)
        : String(data ?? '');
    const entry = `[${timestamp}] [${section}]\n${formattedData}\n\n------------------------------\n\n`;

    try {
        const mainLog = path.join(__dirname, '../../logs/full_debug.log');
        fs.appendFileSync(mainLog, entry);
    } catch (e) { }

    if (currentRunFile) {
        try { fs.appendFileSync(currentRunFile, entry); } catch (e) { }
    }
}

// ─── Retrieval helpers (used by the /logs endpoints) ─────────────────────────

/**
 * Fetch all log entries for a specific run.
 * Returns an array of parsed entry objects.
 */
async function getRunLogs(runId) {
    const client = await getDebugClient();
    if (!client) throw new Error('Debug Redis not connected — is DEBUG_REDIS_URL set?');
    const raw = await client.lRange(`${REDIS_RUN_PREFIX}${runId}`, 0, -1);
    return raw.map(entry => {
        try { return JSON.parse(entry); } catch { return { raw: entry }; }
    });
}

/**
 * List all run IDs ever recorded (master index).
 * Most recent runs are at the end of the list.
 */
async function getAllRunIds() {
    const client = await getDebugClient();
    if (!client) throw new Error('Debug Redis not connected — is DEBUG_REDIS_URL set?');
    return client.lRange(REDIS_RUN_INDEX, 0, -1);
}

/**
 * Delete a specific run's log list from Redis.
 */
async function deleteRunLogs(runId) {
    const client = await getDebugClient();
    if (!client) throw new Error('Debug Redis not connected — is DEBUG_REDIS_URL set?');
    await client.del(`${REDIS_RUN_PREFIX}${runId}`);
}

/**
 * Delete ALL debug logs and clear the master index.
 */
async function clearAllLogs() {
    const client = await getDebugClient();
    if (!client) throw new Error('Debug Redis not connected — is DEBUG_REDIS_URL set?');
    const runIds = await client.lRange(REDIS_RUN_INDEX, 0, -1);
    if (runIds.length > 0) {
        const keys = runIds.map(id => `${REDIS_RUN_PREFIX}${id}`);
        await client.del(keys);
    }
    await client.del(REDIS_RUN_INDEX);
    return runIds.length;
}

module.exports = {
    logDebug,
    startRun,
    // retrieval
    getRunLogs,
    getAllRunIds,
    deleteRunLogs,
    clearAllLogs
};
