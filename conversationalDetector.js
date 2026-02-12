/**
 * Conversational Intent Detector
 * Determines if a message is primarily conversational vs. transactional
 */

/**
 * Check if message is a dismissal or rejection
 */
function isDismissal(message) {
    const dismissalPatterns = [
        /^no+$/i,
        /^nah$/i,
        /^nope$/i,
        /not now/i,
        /maybe later/i,
        /don't worry/i,
        /don't bother/i,
        /no thanks/i,
        /i'm good/i,
        /i'm okay/i,
        /i'm fine/i,
        /not interested/i,
        /not right now/i,
        /leave it/i,
        /forget it/i,
        /never mind/i
    ];

    return dismissalPatterns.some(pattern => pattern.test(message.trim()));
}

/**
 * Check if message is purely conversational
 */
function isPurelyConversational(message, classification) {
    const conversationalPatterns = [
        /^(hey|hi|hello|yo|sup|hii+|heya|howdy)/i,
        /(love you|miss you|baby|babe|sweetie|honey|darling)/i,
        /^(how are you|how're you|what's up|wassup|how you doing)/i,
        /^(good morning|good night|good afternoon|good evening)/i,
        /^(thanks|thank you|appreciate|cheers)/i,
        /^(lol|haha|😂|😊|❤️|😍|🥰)/,
        /^(ok|okay|cool|nice|great|awesome|sweet)$/i,
        /^(yeah|yep|yup|sure|alright)$/i
    ];

    // Check if message matches conversational patterns
    const matchesPattern = conversationalPatterns.some(pattern =>
        pattern.test(message.trim())
    );

    // If matches pattern AND intent confidence is low/medium, it's conversational
    if (matchesPattern && classification.confidence < 0.8) {
        return true;
    }

    // If message is very short (1-3 words) and matches pattern, likely conversational
    const wordCount = message.trim().split(/\s+/).length;
    if (wordCount <= 3 && matchesPattern) {
        return true;
    }

    return false;
}

/**
 * Main function to detect conversational intent
 * Returns an object with detection results
 */
function detectConversationalIntent(message, classification) {
    const dismissal = isDismissal(message);
    const purelyConversational = isPurelyConversational(message, classification);

    return {
        isDismissal: dismissal,
        isPurelyConversational: purelyConversational,
        isConversational: dismissal || purelyConversational,
        shouldAllowCasualResponse: dismissal || purelyConversational || classification.confidence < 0.65
    };
}

module.exports = {
    detectConversationalIntent,
    isDismissal,
    isPurelyConversational
};
