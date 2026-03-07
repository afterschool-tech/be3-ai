const { extractProductIntel } = require('../src/services/intentResolver/utils/productIntelExtractor');

const text = "i want to buy a drey mobile t12";
const entities = [
    { type: 'action', value: 'buy', wordIndices: [3], consumedWordIndices: [3] },
    { type: 'category', value: 'drey mobile', wordIndices: [5, 6], consumedWordIndices: [6] }
];

const excludeSet = new Set(['show', 'me', 'i', 'need', 'want', 'give', 'list', 'lists', 'under', 'below', 'for', 'the', 'a', 'an', 'any', 'some', 'compare', 'comparison', 'difference', 'between', 'versus', 'vs', 'v/s', 'and', 'with', 'by', 'at', 'on', 'of', 'in', 'but', 'still', 'like', 'also', 'just', 'very', 'really', 'what', 'is', 'it', 'tell', 'about', 'those', 'these', 'this', 'that', 'its', 'yes', 'no', 'ok', 'okay', 'cool', 'thanks', 'thank', 'please', 'hi', 'hello', 'hey', 'ya', 'yeah', 'yup', 'nope', "i'm", 'to', 'my', 'your', 'get', 'based', 'own', 'which', 'one', 'two', 'can', 'you', 'could', 'would', 'will', 'shall', 'should', 'may', 'might', 'so', "i'll", 'ill', 'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having', 'advice', 'advise', 'recommend', 'recommendation', 'suggest', 'suggestion', 'guidance', 'help', 'product', 'products', 'item', 'items', 'gadget', 'gadgets', 'looking', 'look', 'find', 'search', 'browse', 'explore', 'discover', 'view', 'see', 'seek', 'buy', 'purchase', 'order', 'grab', 'add', 'remove', 'delete', 'update', 'change', 'modify']);

const results = extractProductIntel({
    text,
    entities,
    excludeSet,
    intentName: 'product_search'
});

console.log(JSON.stringify(results, null, 2));
