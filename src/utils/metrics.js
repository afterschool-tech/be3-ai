/**
 * Metrics Tracking System
 * Compares legacy system vs new tool system performance
 */

const metrics = {
    legacy: {
        requests: 0,
        apiCalls: 0,
        totalResponseTime: 0,
        avgResponseTime: 0,
        errors: 0
    },
    toolSystem: {
        requests: 0,
        apiCalls: 0,
        totalResponseTime: 0,
        avgResponseTime: 0,
        errors: 0,
        toolsUsed: {},
        contextHits: 0 // Queries answered from context without API
    }
};

/**
 * Track a request and its metrics
 * @param {string} system - 'legacy' or 'toolSystem'
 * @param {object} data - Request metrics
 */
function trackRequest(system, data) {
    if (!metrics[system]) {
        console.error(`Unknown system: ${system}`);
        return;
    }

    metrics[system].requests++;
    metrics[system].apiCalls += data.apiCalls || 0;
    metrics[system].totalResponseTime += data.responseTime || 0;
    metrics[system].avgResponseTime =
        metrics[system].totalResponseTime / metrics[system].requests;

    if (data.error) {
        metrics[system].errors++;
    }

    // Tool system specific tracking
    if (system === 'toolSystem') {
        if (data.tools && Array.isArray(data.tools)) {
            data.tools.forEach(tool => {
                metrics[system].toolsUsed[tool] = (metrics[system].toolsUsed[tool] || 0) + 1;
            });
        }

        if (data.apiCalls === 0) {
            metrics[system].contextHits++;
        }
    }
}

/**
 * Get current metrics and comparison
 * @returns {object} - Metrics data with comparison
 */
function getMetrics() {
    const legacyErrorRate = metrics.legacy.requests > 0
        ? (metrics.legacy.errors / metrics.legacy.requests * 100)
        : 0;

    const toolErrorRate = metrics.toolSystem.requests > 0
        ? (metrics.toolSystem.errors / metrics.toolSystem.requests * 100)
        : 0;

    const apiReduction = metrics.legacy.apiCalls > 0
        ? ((metrics.legacy.apiCalls - metrics.toolSystem.apiCalls) / metrics.legacy.apiCalls * 100)
        : 0;

    const speedImprovement = metrics.legacy.avgResponseTime > 0
        ? ((metrics.legacy.avgResponseTime - metrics.toolSystem.avgResponseTime) / metrics.legacy.avgResponseTime * 100)
        : 0;

    const contextHitRate = metrics.toolSystem.requests > 0
        ? (metrics.toolSystem.contextHits / metrics.toolSystem.requests * 100)
        : 0;

    return {
        legacy: {
            ...metrics.legacy,
            errorRate: legacyErrorRate.toFixed(2) + '%'
        },
        toolSystem: {
            ...metrics.toolSystem,
            errorRate: toolErrorRate.toFixed(2) + '%',
            contextHitRate: contextHitRate.toFixed(1) + '%'
        },
        comparison: {
            apiCallReduction: apiReduction > 0 ? `${apiReduction.toFixed(1)}%` : 'N/A',
            speedImprovement: speedImprovement > 0 ? `${speedImprovement.toFixed(1)}%` : 'N/A',
            errorRateDelta: (toolErrorRate - legacyErrorRate).toFixed(2) + '%'
        },
        topTools: Object.entries(metrics.toolSystem.toolsUsed)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tool, count]) => `${tool} (${count})`)
    };
}

/**
 * Reset metrics (for testing)
 */
function resetMetrics() {
    metrics.legacy = {
        requests: 0,
        apiCalls: 0,
        totalResponseTime: 0,
        avgResponseTime: 0,
        errors: 0
    };
    metrics.toolSystem = {
        requests: 0,
        apiCalls: 0,
        totalResponseTime: 0,
        avgResponseTime: 0,
        errors: 0,
        toolsUsed: {},
        contextHits: 0
    };
}

/**
 * Get metrics summary for logging
 * @returns {string} - Formatted metrics summary
 */
function getMetricsSummary() {
    const m = getMetrics();
    return `
📊 Metrics Summary:
Legacy:    ${m.legacy.requests} requests | ${m.legacy.apiCalls} API calls | ${m.legacy.avgResponseTime.toFixed(0)}ms avg | ${m.legacy.errorRate} errors
Tool Sys:  ${m.toolSystem.requests} requests | ${m.toolSystem.apiCalls} API calls | ${m.toolSystem.avgResponseTime.toFixed(0)}ms avg | ${m.toolSystem.errorRate} errors
Context Hit Rate: ${m.toolSystem.contextHitRate}
Comparison: ${m.comparison.apiCallReduction} API reduction | ${m.comparison.speedImprovement} faster
`.trim();
}

module.exports = {
    trackRequest,
    getMetrics,
    resetMetrics,
    getMetricsSummary
};
