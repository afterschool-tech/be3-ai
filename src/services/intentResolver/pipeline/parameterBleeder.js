/**
 * Pipeline Stage 6: Parameter Bleeder
 * Cross-intent parameter inheritance for multi-intent messages.
 * When a sub-statement has incomplete required params,
 * looks at preceding sub-statements to fill the gaps.
 * 
 * Imports: intentRegistry from config
 * Inline data: NONE
 */

const intentRegistry = require('../config/intentRegistry');

/**
 * Apply cross-intent parameter bleeding.
 * 
 * @param {Array} resolvedStatements - Array of { intentName, candidates, extractedParams }
 * @returns {Array} - Same array with params filled via bleeding
 */
function bleedParameters(resolvedStatements) {
    if (resolvedStatements.length <= 1) {
        return resolvedStatements; // Nothing to bleed with single statements
    }

    for (let i = 1; i < resolvedStatements.length; i++) {
        const current = resolvedStatements[i];
        const intent = intentRegistry.get(current.intentName);

        if (!intent) continue;

        // Check each required parameter
        for (const [paramName, paramDef] of Object.entries(intent.parameters)) {
            if (!paramDef.required) continue;

            const currentValue = current.extractedParams[paramName];
            const isMissing = currentValue === null || currentValue === undefined;
            const isIncomplete = paramName === 'products' &&
                Array.isArray(currentValue) &&
                intent.minProducts &&
                currentValue.length < intent.minProducts;

            if (isMissing || isIncomplete) {
                // Look backwards at preceding statements for the same param
                for (let j = i - 1; j >= 0; j--) {
                    const preceding = resolvedStatements[j];
                    const precedingValue = preceding.extractedParams[paramName];

                    if (precedingValue !== null && precedingValue !== undefined) {
                        if (isIncomplete && Array.isArray(currentValue) && Array.isArray(precedingValue)) {
                            // Merge: prepend inherited products, deduplicate
                            const merged = [...precedingValue, ...currentValue];
                            const unique = [...new Set(merged)];
                            current.extractedParams[paramName] = unique;
                            current.bledParams = current.bledParams || [];
                            current.bledParams.push({
                                param: paramName,
                                inherited: precedingValue,
                                fromStatement: j,
                                action: 'merged'
                            });
                        } else if (isMissing) {
                            // Inherit directly
                            current.extractedParams[paramName] = precedingValue;
                            current.bledParams = current.bledParams || [];
                            current.bledParams.push({
                                param: paramName,
                                inherited: precedingValue,
                                fromStatement: j,
                                action: 'inherited'
                            });
                        }
                        break; // Only inherit from the nearest preceding statement
                    }
                }
            }
        }
    }

    return resolvedStatements;
}

module.exports = { bleedParameters };
