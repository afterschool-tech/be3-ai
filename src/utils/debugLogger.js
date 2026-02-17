const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../logs/runs');

// Ensure the directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

let currentRunFile = null;

/**
 * Start a new log file for a specific request/run
 * @param {string} runId - Unique identifier for the run
 */
function startRun(runId) {
    const filename = `run_${Date.now()}_${runId}.log`;
    currentRunFile = path.join(LOGS_DIR, filename);

    const initialHeader = `=== DEBUG LOG START: ${new Date().toISOString()} | RUN ID: ${runId} ===\n\n`;
    fs.writeFileSync(currentRunFile, initialHeader);
    return currentRunFile;
}

/**
 * Log something to the current run file
 */
function logDebug(section, data) {
    const timestamp = new Date().toISOString();
    const formattedData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const entry = `[${timestamp}] [${section}]\n${formattedData}\n\n------------------------------\n\n`;

    // Always append to the main debug log (backup/overview)
    const mainLog = path.join(__dirname, '../../logs/full_debug.log');
    try {
        fs.appendFileSync(mainLog, entry);
    } catch (e) {
        console.warn('Failed to write to main debug log');
    }

    // Append to the current run file if active
    if (currentRunFile) {
        try {
            fs.appendFileSync(currentRunFile, entry);
        } catch (e) {
            console.error('Failed to write to run-specific log:', e.message);
        }
    }
}

module.exports = { logDebug, startRun };
