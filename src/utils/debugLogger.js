const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs/runs');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Ensure the directory exists (skip entirely in production)
if (!IS_PRODUCTION) {
    try {
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
        }
    } catch (e) {
        // Silently fail if directory creation is blocked
    }
}

let currentRunFile = null;

/**
 * Start a new log file for a specific request/run
 */
function startRun(runId) {
    if (IS_PRODUCTION) return null; // Complete silence in production

    try {
        const filename = `run_${Date.now()}_${runId}.log`;
        currentRunFile = path.join(LOGS_DIR, filename);

        const initialHeader = `=== DEBUG LOG START: ${new Date().toISOString()} | RUN ID: ${runId} ===\n\n`;
        fs.writeFileSync(currentRunFile, initialHeader);
        return currentRunFile;
    } catch (e) {
        return null;
    }
}

/**
 * Log something to the current run file
 * Completely disabled in production
 */
function logDebug(section, data) {
    if (IS_PRODUCTION) return; // Complete silence in production

    const timestamp = new Date().toISOString();
    const formattedData = typeof data === 'object' && data !== null ? JSON.stringify(data, null, 2) : data;
    const entry = `[${timestamp}] [${section}]\n${formattedData}\n\n------------------------------\n\n`;

    // Local File Logging (Development Only)
    try {
        const mainLog = path.join(__dirname, '../../logs/full_debug.log');
        fs.appendFileSync(mainLog, entry);
    } catch (e) { }

    if (currentRunFile) {
        try {
            fs.appendFileSync(currentRunFile, entry);
        } catch (e) { }
    }
}

module.exports = { logDebug, startRun };
