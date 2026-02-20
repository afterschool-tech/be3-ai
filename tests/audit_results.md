=== BENCH TAG AUDIT ===

add_to_cart: 295 total | 295 tagged (100%) | tags: [product]
browse_collection: 281 total | 281 tagged (100%) | tags: [product]
cancel_order: 254 total | 228 tagged (90%) | tags: [product]
check_availability: 360 total | 360 tagged (100%) | tags: [product]
confirm_order: 250 total | 241 tagged (96%) | tags: [product], [date]
discovery_sentinel: 265 total | 248 tagged (94%) | tags: [product]
end_conversation: 277 total | 148 tagged (53%) | tags: [product]
get_advice: 297 total | 296 tagged (100%) | tags: [product]
get_help: 302 total | 300 tagged (99%) | tags: [product]
give_feedback: 241 total | 238 tagged (99%) | tags: [product]
list_orders: 240 total | 221 tagged (92%) | tags: [product]
list_vendors: 182 total | 135 tagged (74%) | tags: [product]
order_status: 335 total | 310 tagged (93%) | tags: [product]
product_compare: 263 total | 263 tagged (100%) | tags: [product]
product_search: 368 total | 366 tagged (99%) | tags: [product]
remove_from_cart: 308 total | 307 tagged (100%) | tags: [product]
set_delivery: 212 total | 207 tagged (98%) | tags: [product]
start_checkout: 223 total | 163 tagged (73%) | tags: [product]
update_cart_quantity: 244 total | 244 tagged (100%) | tags: [product]
vendor_contact: 224 total | 66 tagged (29%) | tags: [product]
vendor_identity: 177 total | 176 tagged (99%) | tags: [product]
vendor_info: 250 total | 40 tagged (16%) | tags: [product]
vendor_products: 238 total | 180 tagged (76%) | tags: [product]
view_cart: 304 total | 36 tagged (12%) | tags: [product]

=== GLOBAL TAG FREQUENCY ===
  [product]: 5622 occurrences
  [date]: 1 occurrences

=== INTENT PARAM CONFIG ===
add_to_cart: tool=cart.add | params=[products, product_name, query, quantity, vendor, attributes]
browse_collection: tool=collection.getProducts | params=[collection_slug*, limit]
cancel_order: tool=order.cancel | params=[order_number*]
check_availability: tool=product.checkAvailability | params=[products, product_name, query, vendor]
confirm_order: tool=order.confirm | params=[order_number]
discovery_sentinel: tool=discovery.sentinel | params=[query, category]
end_conversation: tool=conversation.end | params=[]
get_advice: tool=conversation.getAdvice | params=[category, need, query]
get_help: tool=conversation.help | params=[]
give_feedback: tool=conversation.feedback | params=[rating, comment]
list_orders: tool=order.list | params=[limit]
list_vendors: tool=vendor.list | params=[]
order_status: tool=order.track | params=[order_id, products]
product_compare: tool=product.compare | params=[products, product_name, query, category, attributes]
product_search: tool=product.search | params=[product_name*, category, vendor, price_min, price_max, sort, limit, attributes]
remove_from_cart: tool=cart.remove | params=[products*, quantity]
set_delivery: tool=order.setDelivery | params=[delivery_type, address]
start_checkout: tool=order.checkout | params=[customer_name, customer_email]
update_cart_quantity: tool=cart.updateQuantity | params=[products*, product_name, quantity*]
vendor_contact: tool=vendor.getContactLink | params=[vendor*]
vendor_identity: tool=vendor.checkIdentity | params=[product_name*, vendor]
vendor_info: tool=vendor.getInfo | params=[vendor*]
vendor_products: tool=vendor.getProducts | params=[vendor*, limit]
view_cart: tool=cart.view | params=[]

=== UNTAGGED VENDOR SAMPLES ===

vendor_products - untagged samples (first 5):
  "show me the seller's entire catalog"
  "can you display products from this store?"
  "browse items from this shop for me"
  "i wanna see what this seller is offering"
  "give me a list of products by this vendor"

vendor_info - untagged samples (first 5):
  "give me the lowdown on this seller"
  "tell me everything about the store"
  "i need deets on this shop"
  "who's behind this online store?"
  "can you enlighten me about the vendor?"

vendor_contact - untagged samples (first 5):
  "i need to shoot a message to the seller asap"
  "i wanna hit up the seller on whatsapp"
  "get me the vendor's contact info, stat!"
  "could you please provide the seller's contact details?"
  "i'm trying to reach the vendor but i don't know how"

vendor_identity - untagged samples (first 5):
  "sold by who exactly?"

=== INTENTS WITH NO TAGS ===

=== PRODUCT SEARCH SAMPLE VARIATIONS ===
  "i'm looking for a new [product]"
  "can you show me some options?"
  "hey, do you have any [product]?"
  "i want to see what you've got"
  "seriously, where can i find a good [product]?"
  "help me find a [product] with good specs"
  "i need to buy a new [product] asap"
  "gimme some info about [product]"
  "let me browse your [product] selection"
  "do you sell [product]?"
  "i'm trying to find a [product] with specific features"
  "can you tell me about your [product]?"
  "i want to check out some [product] prices"
  "actually, i'm looking for a [product] with a certain feature"
  "show me some [product] options, please"

=== ADD_TO_CART SAMPLE VARIATIONS ===
  "add [product] to cart"
  "i need [product] in my cart"
  "can you add [product] to my bag?"
  "throw [product] in my cart"
  "i want to buy [product]"
  "gimme [product] in my cart"
  "seriously, add [product] to cart"
  "put [product] in my shopping bag"
  "i'd like to purchase [product]"
  "add [product] to my shopping cart"

=== VENDOR_PRODUCTS SAMPLE VARIATIONS ===
  "what kind of [product] does this vendor have?"
  "show me the seller's entire catalog"
  "can you display products from this store?"
  "browse items from this shop for me"
  "i wanna see what this seller is offering"
  "give me a list of products by this vendor"
  "what does this seller specialize in?"
  "take me to the vendor's product page"
  "show products from this seller's collection"
  "what [product] does this vendor sell?"
  "display products from this store please"
  "i need to see items from this vendor"
  "tell me about products from this seller"
  "what [product] can i buy from this vendor?"
  "show me items from this seller's inventory"

=== CHECK_AVAILABILITY SAMPLE ===
  "got any [product] left?"
  "is [product] still in stock?"
  "can i cop [product] today?"
  "hey, is [product] available?"
  "seriously, do you have [product]?"
  "i need [product], is it in stock?"
  "do you have any [product] in stock?"
  "gimme [product], is it available?"
  "can i get [product] now?"
  "is there any [product] left?"
  "have you got [product]?"
  "actually, is [product] still available?"
  "how's the stock on [product]?"
  "can i grab [product]?"
  "is [product] sold out?"

=== ORDER_STATUS SAMPLE ===
  "where's my order at"
  "track my [product] shipment"
  "gimme an update on my order"
  "hey, can you tell me where my package is"
  "seriously, when will my order arrive"
  "check order status for me"
  "what's the eta on my delivery"
  "i need to track my [product] order"
  "where is my [product] at"
  "can you check my order status"