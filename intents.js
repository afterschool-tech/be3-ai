/**
 * Intent Definitions
 * Defines all 16 intents for the Be3 shopping assistant
 */

const INTENTS = {
    SEARCH_PRODUCTS: 'search_products',
    VIEW_PRODUCT: 'view_product',
    COMPARE_PRODUCTS: 'compare_products',
    ADD_TO_CART: 'add_to_cart',
    REMOVE_FROM_CART: 'remove_from_cart',
    VIEW_CART: 'view_cart',
    UPDATE_QUANTITY: 'update_quantity',
    START_CHECKOUT: 'start_checkout',
    SET_DELIVERY_OPTION: 'set_delivery_option',
    CONFIRM_ORDER: 'confirm_order',
    VIEW_ORDERS: 'view_orders',
    TRACK_ORDER: 'track_order',
    CANCEL_ORDER: 'cancel_order',
    HELP: 'help',
    GET_ADVICE: 'get_advice',
    FALLBACK_UNKNOWN: 'fallback_unknown'
};

/**
 * Intent descriptions for AI classification
 * Used to help the AI understand which intent to classify user messages into
 */
const INTENT_DESCRIPTIONS = {
    [INTENTS.SEARCH_PRODUCTS]: {
        description: "User wants to browse or search for products, possibly filtered by category, price range, brand, or specific attributes. Extract price as numbers without currency symbols.",
        examples: [
            "Show me laptops",
            "I'm looking for phones under $500",
            "Do you have Samsung products?",
            "What electronics do you sell?",
            "Show me all products in the tech category",
            "Find me a cheap watch",
            "Are there any cameras between 200 and 600?",
            "Show me smartphones under 1000"
        ],
        parameters: ['query', 'category', 'price_min', 'price_max', 'vendor']
    },
    [INTENTS.VIEW_PRODUCT]: {
        description: "User wants to see detailed information about a specific product",
        examples: [
            "Tell me more about the iPhone 15",
            "What are the specs of that laptop?",
            "Show me details for product #123",
            "I want to know more about this item"
        ],
        parameters: ['product_name', 'product_id', 'product_handle']
    },
    [INTENTS.COMPARE_PRODUCTS]: {
        description: "User wants to compare features, prices, or specifications of multiple products",
        examples: [
            "Compare iPhone 15 and Samsung Galaxy S24",
            "What's the difference between these two laptops?",
            "Which is better, product A or product B?",
            "Compare the first and third items"
        ],
        parameters: ['product_names', 'product_ids']
    },
    [INTENTS.ADD_TO_CART]: {
        description: "User wants to add a product to their shopping cart",
        examples: [
            "Add this to my cart",
            "I want to buy 2 of those",
            "Add the iPhone to cart",
            "I'll take 3 of these",
            "Put that in my basket"
        ],
        parameters: ['product_name', 'product_id', 'quantity']
    },
    [INTENTS.REMOVE_FROM_CART]: {
        description: "User wants to remove a product from their shopping cart",
        examples: [
            "Remove the laptop from my cart",
            "Delete that item",
            "I don't want the phone anymore",
            "Take that out of my cart"
        ],
        parameters: ['product_name', 'product_id', 'cart_item_id']
    },
    [INTENTS.VIEW_CART]: {
        description: "User wants to see what's currently in their shopping cart, or check the contents of their basket",
        examples: [
            "What's in my cart?",
            "Show me my basket",
            "What have I added?",
            "View cart",
            "What am I buying?",
            "Check my cart",
            "What's in the cart?",
            "Show items in cart"
        ],
        parameters: []
    },
    [INTENTS.UPDATE_QUANTITY]: {
        description: "User wants to change the quantity of an item in their cart",
        examples: [
            "Change quantity to 5",
            "I want 3 of those instead",
            "Make it 2 laptops",
            "Update the quantity to 1"
        ],
        parameters: ['product_name', 'product_id', 'cart_item_id', 'quantity']
    },
    [INTENTS.START_CHECKOUT]: {
        description: "User wants to begin the checkout process to complete their purchase",
        examples: [
            "I want to checkout",
            "Let's complete the order",
            "Proceed to payment",
            "I'm ready to buy",
            "How do I pay?"
        ],
        parameters: []
    },
    [INTENTS.SET_DELIVERY_OPTION]: {
        description: "User wants to set or change their shipping/delivery preferences",
        examples: [
            "I want express delivery",
            "Change to standard shipping",
            "What delivery options do you have?",
            "I need it delivered by Friday"
        ],
        parameters: ['delivery_option', 'delivery_speed']
    },
    [INTENTS.CONFIRM_ORDER]: {
        description: "User wants to finalize and confirm their purchase",
        examples: [
            "Confirm my order",
            "Yes, place the order",
            "Complete the purchase",
            "Finalize my order"
        ],
        parameters: []
    },
    [INTENTS.VIEW_ORDERS]: {
        description: "User wants to see their past or current orders",
        examples: [
            "Show me my orders",
            "What have I bought before?",
            "Order history",
            "My purchases",
            "What did I order last week?"
        ],
        parameters: []
    },
    [INTENTS.TRACK_ORDER]: {
        description: "User wants to check the status or location of a specific order",
        examples: [
            "Where is my order?",
            "Track order #12345",
            "When will my package arrive?",
            "Order status",
            "Has my order shipped?"
        ],
        parameters: ['order_number', 'order_id']
    },
    [INTENTS.CANCEL_ORDER]: {
        description: "User wants to cancel an existing order",
        examples: [
            "Cancel my order",
            "I want to cancel order #12345",
            "Stop my purchase",
            "I don't want this anymore"
        ],
        parameters: ['order_number', 'order_id']
    },
    [INTENTS.HELP]: {
        description: "User is asking for general assistance or wants to know what the bot can do",
        examples: [
            "Help",
            "What can you do?",
            "How does this work?",
            "I need assistance",
            "Can you help me?"
        ],
        parameters: []
    },
    [INTENTS.GET_ADVICE]: {
        description: "User is asking for advice, opinions, or follow-up questions about products they are currently looking at or have just searched for. They might ask about suitability for a specific use case (e.g. 'is this good for students?') or for a recommendation based on the current list.",
        examples: [
            "Is this good for a computer science student?",
            "Which of these would you recommend for me?",
            "I don't have much money, is the second one better?",
            "Why should I buy this one instead of the other?",
            "Do you think this fits my needs?",
            "Is it worth the price?"
        ],
        parameters: ['product_name', 'context_query']
    },
    [INTENTS.FALLBACK_UNKNOWN]: {
        description: "User's message is unclear, ambiguous, or doesn't match any specific intent",
        examples: [
            "asdfghjkl",
            "...",
            "huh?",
            "I don't know"
        ],
        parameters: []
    }
};

/**
 * Generate the intent classification prompt for the AI
 * This prompt teaches the AI how to classify user messages
 */
function getIntentClassificationPrompt(categories = [], vendors = []) {
    const categoryList = categories.length > 0 ? categories.join(', ') : 'None available';
    const vendorList = vendors.length > 0 ? vendors.join(', ') : 'None available';

    const intentList = Object.entries(INTENT_DESCRIPTIONS)
        .map(([intent, { description, examples }]) => {
            return `${intent}:
  Description: ${description}
  Examples: ${examples.map(ex => `"${ex}"`).join(', ')}`;
        })
        .join('\n\n');

    return `You are an intent classifier for a shopping assistant. Your job is to classify user messages into one of the following intents and extract relevant parameters.

AVAILABLE INTENTS:

${intentList}

DYNAMIC STORE CONTEXT:
Valid Categories: ${categoryList}
Valid Vendors: ${vendorList}

INSTRUCTIONS:
1. Read the user's message carefully
2. Classify it into ONE of the intents above
3. Extract any relevant parameters mentioned in the message
4. Return ONLY a JSON object with this exact format:
{
  "intent": "intent_name",
  "params": {
    "param_name": "param_value"
  },
  "confidence": 0.95
}

RULES:
- Always return valid JSON
- Use lowercase for intent names (e.g., "search_products" not "SEARCH_PRODUCTS")
- Extract as many relevant parameters as possible. 
- For pricing: "under $X" or "less than $X" means price_max = X. "over $X" or "more than $X" means price_min = X.
- IGNORE conversational fillers like "Now", "Actually", "Also", "By the way" when determining intent. Focus on the core request.
- If a user says "Show me X", even if they said "Now show me X", it's a search_products intent.
- If no parameters are found, use empty object: "params": {}
- Confidence should be between 0 and 1
- If the message is unclear or doesn't match any intent, use "fallback_unknown"
- For product references like "this", "that", "the first one", extract the product name if it was mentioned in the conversation history.
- For comparisons (compare_products), ALWAYS put the names in the "product_names" ARRAY. Do not use "product1", "product2".
- CATEGORY EXTRACTION: If the user mentions a category from the DYNAMIC STORE CONTEXT (e.g. "desktops", "smartphones"), put it in the "category" param. If they mention a product that implies a category (e.g. "Macbook"), keep the query as "Macbook" but also set "category" if you can infer it from the list.
- ACTIONABLE INTENTS: If the user says "Find me affordable desktops", set intent="search_products", category="desktops", query="affordable desktops".
- RE-EXTRACTION: If the user clarifies a category (e.g. User: "Show me phones", then "I mean Android phones"), extract "Android phones" as the category.

EXAMPLES:

User: "Show me laptops under $1000"
Response: {"intent": "search_products", "params": {"query": "laptops", "price_max": 1000}, "confidence": 0.98}

User: "Add 2 to my cart"
Response: {"intent": "add_to_cart", "params": {"quantity": 2}, "confidence": 0.85}

User: "What's in my cart?"
Response: {"intent": "view_cart", "params": {}, "confidence": 1.0}

User: "Where is my order?"
Response: {"intent": "track_order", "params": {}, "confidence": 0.95}

Now classify the following user message:`;
}

/**
 * Get help message content
 */
function getHelpMessage() {
    return `I'm your Be3 shopping assistant! Here's what I can help you with:

🔍 **Search & Browse**
- Search for products: "Show me laptops"
- Filter by price: "Phones under $500"
- Browse categories: "What's in the electronics section?"

🛒 **Shopping Cart**
- Add items: "Add this to my cart"
- View cart: "What's in my cart?"
- Update quantities: "Change to 3 items"
- Remove items: "Remove the laptop from cart"

📦 **Orders**
- View orders: "Show my order history"
- Track orders: "Where is my order?"
- Cancel orders: "Cancel order #12345"

💳 **Checkout**
- Start checkout: "I want to checkout"
- Set delivery: "I need express shipping"

Just ask me anything and I'll help you shop!`;
}

module.exports = {
    INTENTS,
    INTENT_DESCRIPTIONS,
    getIntentClassificationPrompt,
    getHelpMessage
};
