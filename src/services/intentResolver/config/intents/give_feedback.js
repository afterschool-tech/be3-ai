/**
 * Intent: give_feedback
 * Triggered when the user wants to give feedback, rate, or complain.
 */

module.exports = {
    name: 'give_feedback',

    keywords: [
        'feedback', 'rate', 'review', 'complaint', 'complain'
    ],

    synonyms: [
        'i want to complain', 'give feedback', 'rate this',
        'leave a review', 'how was my experience', 'rate my experience',
        'i have a complaint', 'this was bad', 'this was great',
        'bad experience', 'good experience', 'report issue',
        'not satisfied', 'very satisfied', 'thumbs up', 'thumbs down'
    ],

    parameters: {
        rating: { type: 'number', required: false, description: 'Rating from 1-5' },
        comment: { type: 'string', required: false, description: 'Feedback comment or complaint text' }
    },

    toolName: 'conversation.feedback',

    paramMap: {
        rating: 'rating',
        comment: 'comment'
    },

    minProducts: 0,
    maxProducts: 0,
    invertTo: null
};
