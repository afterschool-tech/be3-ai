# Chapter 30 — System Diagnostics: REPL, Metrics, Debug Logger

## The REPL and Shared Personality Layer

The comment on line 259 of `server.js` reveals something important:

```js
/**
 * Generate response based on tool results (Unified Be3 Voice)
 * Shared module — used by both server.js and the REPL.
 */
const { generateResponseFromTools } = require('./personalityLayer');
```

The personality layer is a shared module. The REPL — the command-line interactive pipeline used for development and manual testing — uses exactly the same response generation code as the production HTTP server. This is not incidental; it is a deliberate architectural choice that ensures every response tested in the REPL behaves identically to a production response. There is no "test mode" LLM call or simplified prompt — the REPL exercises the full pipeline including DCO config loading, segment assembly, history windowing, and the Groq API call.

This means that debugging a response quality issue in development is as simple as running the REPL, which runs against the same Redis state, the same store context, and the same LLM endpoint as production. The REPL is not a simplified testing harness — it is a full pipeline client with a different transport.

---

## The Dot-Command System

The `/chat` endpoint intercepts certain special commands before executing the pipeline. These are developer and support commands prefixed with `.`:

```js
const systemCmd = (message || '').trim().toLowerCase();

if (systemCmd === '.clearcache' || systemCmd === '.clearcahe') {
    await stateManager.clearState(session_id);
    await stateManager.setLastTools(session_id, []);
    return res.json({ success: true, reply: "State cache cleared!" });
}
if (systemCmd === '.clearcart') {
    const { removed } = await clearBackendCart(session_id);
    return res.json({ success: true, reply: `Cart cleared! Removed ${removed} item(s).` });
}
if (systemCmd === '.clearall') {
    await stateManager.clearState(session_id);
    await stateManager.setLastTools(session_id, []);
    const { removed } = await clearBackendCart(session_id);
    return res.json({ success: true, reply: `State + cart cleared!` });
}
```

Note the `.clearcahe` alias — a deliberate typo catch. These commands:

**`.clearcache`** — Wipes the session's Redis state object (conversation history, search context, microstate, stack, reference maps, preferences) and the persisted tool history. Used to start a fresh session without restarting the server.

**`.clearcart`** — Calls the backend `/cart/items/:id` DELETE endpoint for every item currently in the session's cart. The backend cart is a separate datastore from the AI session state; this command clears both.

**`.clearall`** — Combines both: wipes AI session state, tool history, and backend cart. The nuclear reset.

These run before `startRun()` — they never appear in the debug logs because they bypass the pipeline entirely.

---

## The Debug Logger Architecture

The debug logger provides per-request structured logging with two backends: a dedicated Redis instance, and local files. The critical design principle is that debug Redis is completely isolated from state Redis.

### Why Separate Redis Connections

The system uses Redis for all session state: conversation history, microstate, stack, search context, reference maps, image cache, tool history. The main state Redis connection is on a budget — Upstash's free tier has a strict command count limit. Adding debug logging to the same connection would exhaust the command budget during heavy testing, breaking the production state system.

The debug logger uses `DEBUG_REDIS_URL` — a completely separate Redis instance, its own connection, its own command budget:

```js
const DEBUG_REDIS_URL = process.env.DEBUG_REDIS_URL;
// Completely separate from state Redis:
const client = redis.createClient({ url: DEBUG_REDIS_URL });
await client.connect();
```

### The `startRun()` / `logDebug()` Contract

Every incoming `/chat` request opens a new log "run" at the very start of the handler:

```js
const runId = `req_${Date.now()}`;
startRun(runId);
```

`startRun()` does two things:
1. Pushes the `runId` onto a master index list (`be3:debug:runs`) so all run IDs are enumerable
2. Creates the run's own Redis List (`be3:debug:run:<runId>`) and writes an opening `RUN_START` entry

Throughout the pipeline, every significant stage calls `logDebug(section, data)`:

```js
logDebug('SERVER:VISUAL_SEARCH_SHORT_CIRCUIT', {
    _desc: 'Visual search detected — short-circuiting pipeline',
    _example: 'User sent image → bypass resolveDeterministic',
    imageLength: req.body.image?.length || 0
});
```

Each `logDebug` call pushes a self-contained JSON entry onto the run's Redis List via `redisPush()`:

```js
const entry = JSON.stringify({
    timestamp,
    section,
    ...data   // _desc, _example, and all payload fields merged at top level
});
redisPush(`${REDIS_RUN_PREFIX}${currentRunId}`, entry);
```

The `_desc` and `_example` convention embedded in every log entry makes logs self-documenting — each entry explains what stage it represents and gives a concrete example of the kind of data it contains.

### Fire-and-Forget Push

`redisPush()` is explicitly never `await`ed:

```js
function redisPush(key, value) {
    getDebugClient().then(client => {
        if (!client) return;
        client.rPush(key, value).catch(e => { /* warn once */ });
    });
    // Returns immediately — no await
}
```

Logging must never add latency to a pipeline request. By resolving the client promise and issuing the RPUSH in a background microtask, the log call returns synchronously. If the debug Redis connection is slow or unavailable, the pipeline proceeds without interruption. The first Redis failure triggers a one-time warning and silently suppresses subsequent failures.

### Local File Fallback

Without `DEBUG_REDIS_URL`, logs write to local files. `full_debug.log` receives every entry from every run in the current process session. Each run also gets a dedicated `run_<timestamp>_<runId>.log` file:

```js
const filename = `run_${Date.now()}_${runId}.log`;
currentRunFile = path.join(LOGS_DIR, filename);
```

This is the legacy local development mode. Redis mode is preferred for any environment where logs need to survive process restarts or be retrieved via API.

---

## The Log Retrieval API

Four HTTP endpoints expose the debug log data for tooling and external log consumers:

```
GET  /logs              → List all run IDs (most recent last)
GET  /logs/:runId       → All entries for a specific run (as parsed JSON array)
DELETE /logs/:runId     → Delete a single run's log list from Redis
DELETE /logs            → Wipe ALL debug logs and the master index
```

```js
app.get('/logs/:runId', async (req, res) => {
    const entries = await getRunLogs(req.params.runId);
    res.json({ success: true, runId: req.params.runId, count: entries.length, entries });
});
```

`getRunLogs()` fetches the entire Redis List for a run using `lRange(key, 0, -1)` (all elements) and parses each JSON entry. Invalid entries (unparseable JSON) are returned as `{ raw: entry }` rather than throwing — the log consumer always receives the full list regardless of individual entry corruption.

The `download-logs.js` script in `/scripts/` uses these endpoints to export run logs to local files in the same format as the local file backend, maintaining full compatibility between the Redis and file logging modes.

---

## The Debug State Endpoints

Two additional diagnostic endpoints expose raw session state:

```
GET    /debug/state/:session_id   → Full Redis state object for the session
DELETE /debug/state/:session_id   → Wipe the session state from Redis
```

```js
app.get('/debug/state/:session_id', async (req, res) => {
    const state = await stateManager.getState(req.params.session_id);
    res.json({ success: true, state });
});
```

These return or clear the complete session object: conversation history, current intent, microstate, stack, cart state, preferences, abandoned items, product context, reference maps, search snapshots, and tool history. Used by developers to inspect exactly what the pipeline knows about a session at any point, and to surgically reset specific sessions without affecting others.

---

## The Metrics System

The metrics system tracks a performance comparison between the legacy AI-based pipeline and the current deterministic tool system. It lives entirely in memory — no Redis, no file I/O — making it zero-cost to write and near-zero-cost to read:

```js
const metrics = {
    legacy:     { requests: 0, apiCalls: 0, totalResponseTime: 0, avgResponseTime: 0, errors: 0 },
    toolSystem: { requests: 0, apiCalls: 0, totalResponseTime: 0, avgResponseTime: 0, errors: 0,
                  toolsUsed: {}, contextHits: 0 }
};
```

`trackRequest(system, data)` is called at the end of each pipeline request with the system name (`'toolSystem'` for the current pipeline), response time, API call count, tool names used, and error flag.

`contextHits` counts requests where `apiCalls === 0` — queries resolved entirely from cached state context without a backend API call. A high context hit rate indicates the session's reference maps and search context are doing their job, avoiding redundant API calls.

```js
if (data.apiCalls === 0) {
    metrics[system].contextHits++;
}
```

`getMetrics()` computes derived statistics: error rates, API call reduction (legacy vs tool system), speed improvement percentage, and a top-10 tools ranking:

```js
topTools: Object.entries(metrics.toolSystem.toolsUsed)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => `${tool} (${count})`)
```

The comparison fields reveal the value of the tool system migration:
- `apiCallReduction` — how many fewer backend API calls the tool system makes vs the legacy system
- `speedImprovement` — average response time reduction
- `errorRateDelta` — whether the tool system is more or less error-prone

### The `/metrics` Endpoint

```js
app.get('/metrics', (req, res) =>
    res.json({ success: true, metrics: getMetrics(), summary: getMetricsSummary() })
);
```

`getMetricsSummary()` formats the metrics as a human-readable ASCII block:

```
📊 Metrics Summary:
Legacy:    42 requests | 210 API calls | 1840ms avg | 4.76% errors
Tool Sys:  312 requests | 624 API calls | 820ms avg | 1.28% errors
Context Hit Rate: 18.2%
Comparison: 70.3% API reduction | 55.4% faster
```

Metrics reset on process restart — the system does not persist metrics to Redis. For persistent metrics tracking, the telemetry exporter tooling in the debug scripts reads from the log entries themselves and reconstructs metrics from pipeline stage timing data.

---

## The `ai_steps.log` File

`logStep()` is a simple append-to-file function that runs alongside the debug logger:

```js
function logStep(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${msg}`;
    console.log(entry);
    fs.appendFileSync('ai_steps.log', `${entry}\n`);
}
```

This is the original, synchronous step log that predates the Redis debug system. It writes to `ai_steps.log` at the project root on every significant pipeline branch — intent resolution, tool selection, image injection, sentinel decisions. Unlike `logDebug`, it is always active regardless of the `DEBUG` environment variable. It is the permanent, always-on audit trail of high-level pipeline decisions.

The `ai_steps.log` file (394KB at time of writing) represents the complete history of every pipeline execution since the log was last rotated — a persistent, flat timeline of intent resolutions, sentinel verdicts, stack executions, and microstate lifecycle events.

---

## Full Observability Stack

Putting the diagnostics systems together:

| Layer | Tool | Persistence | Activation | Purpose |
|---|---|---|---|---|
| High-level trace | `ai_steps.log` | File (always) | Always on | Permanent audit of pipeline branches |
| Per-request structured trace | `logDebug` → Redis | Debug Redis List per run | `DEBUG=true` | Full stage-by-stage pipeline observability |
| Session state inspection | `/debug/state/:id` | Main Redis | Always on | Raw session state dump for debugging |
| Performance tracking | `metrics` in-memory | None (resets on restart) | Always on | Legacy vs tool system comparison |
| Log export | `/logs` API | Debug Redis | `DEBUG=true` | Tool-readable log retrieval for analysis |

The combination of these systems provides complete pipeline observability: from the permanent high-level `ai_steps.log` trace, through the per-request structured Redis logs with their stage-by-stage data snapshots, to the raw session state inspection endpoint. A developer diagnosing a pipeline issue can: (1) identify the request from `ai_steps.log`, (2) fetch the full structured run log from `/logs/:runId`, (3) inspect the session state from `/debug/state/:session_id`, and (4) check the metrics endpoint to see whether the issue is systemic or isolated.

---

## Closing: The Pipeline as a Whole

This chapter closes the 30-chapter documentation of the Be3 AI intent resolution pipeline. From the engineered token pre-processor at the entry point, through the deterministic zero-AI classification system, across the NLP stages (context resolution, entity extraction, schema scoring, parameter extraction, bleeding, porting, normalisation), through the tool execution and microstate lifecycle, to the DCO-powered personality layer and the UI aggregator — the pipeline is a system designed to be fast, explicit, and observable.

Every design decision documented here — the deterministic-first philosophy, the composable DCO segments, the dual-channel UI separation, the fire-and-forget debug logger, the two-pass image injection — was made in service of a single goal: a WhatsApp shopping assistant that feels instant, accurate, and genuinely helpful, at production scale.
