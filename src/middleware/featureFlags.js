/**
 * Feature Flag System
 * Controls rollout of new features with A/B testing support
 */

require('dotenv').config();

const FEATURES = {
    contextIntegration: process.env.FEATURE_CONTEXT_INTEGRATION === 'true',
    apiOptimization: process.env.FEATURE_API_OPTIMIZATION === 'true',
    toolSystem: process.env.FEATURE_TOOL_SYSTEM === 'true',
    toolTrafficPercent: parseInt(process.env.TOOL_SYSTEM_TRAFFIC_PERCENT || '0', 10)
};

/**
 * Determine if a session should use the new tool system
 * Uses consistent hash-based routing per session
 * @param {string} sessionId - User session identifier
 * @returns {boolean} - True if session should use tool system
 */
function shouldUseToolSystem(sessionId) {
    if (!FEATURES.toolSystem) return false;

    // Consistent routing per session (hash-based)
    const hash = sessionId.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0);

    const bucket = Math.abs(hash) % 100;
    return bucket < FEATURES.toolTrafficPercent;
}

/**
 * Get current feature flag status
 * @returns {object} - Feature flag configuration
 */
function getFeatures() {
    return {
        ...FEATURES,
        description: {
            contextIntegration: 'AI has access to full store context',
            apiOptimization: 'Context-powered API call reduction',
            toolSystem: 'Dynamic tool-based architecture',
            toolTrafficPercent: `${FEATURES.toolTrafficPercent}% of traffic uses tools`
        }
    };
}

module.exports = {
    FEATURES,
    shouldUseToolSystem,
    getFeatures
};
