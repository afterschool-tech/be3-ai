# IntentResolver Word Inventory (What words you keep, what they do, and how to extend safely)

Scope:
- This document inventories **all word/phrase lists** currently used by your deterministic NLU pipeline.
- It covers:
  - Global lexicons in `src/services/intentResolver/config/*`
  - Inline lexicons that materially affect behavior (e.g. `ACTION_VERBS`, `FILLERS`)
  - Cleaning-related lists in `src/services/intentResolver/pipeline/nlpCleaner.js`
  - Per-intent `keywords` and `synonyms` in `src/services/intentResolver/config/intents/*.js`

It answers for each inventory:
- **What it does**
- **What it does NOT do**
- **Questions to ask before adding words**
- **Where to add the word instead** if this list isn’t the right place

---

## Mental model: where “words” affect the pipeline

Your pipeline has multiple places where a word can matter:

- **Fuzzy correction (typos)**
  - Attempts to correct a misspelled word into a known intent keyword.
- **Statement splitting (multi-intent)**
  - Uses conjunction lists to split one message into multiple statements.
- **Candidate detection (keyword/synonym matching)**
  - Uses per-intent keywords/synonyms to produce candidate intents.
- **Schema resolution (scoring)**
  - Uses action entities + IDF-weighted keyword matches + phrase matches.
- **Entity extraction & residual formation**
  - Uses filler/guard lists to decide what becomes a “residual product lump”.
- **Query cleaning (product mention extraction)**
  - Aggressively removes noise words to leave product-like tokens.

Because these steps are layered, the *same word* can have different consequences depending on where you add it.

---

# A) Global inventories in `src/services/intentResolver/config/`

## A1) `stopWords` — `config/stopWords.js`

**What it does**
- Used to **skip** certain words when:
  - `pipeline/fuzzyMatcher.js` decides what words to even attempt to correct.
  - `pipeline/candidateDetector.js` does the orphan fallback (“if any non-stop-words exist, default to product_search”).

**What it does NOT do**
- It does **not** stop a word from matching intent `keywords`/`synonyms` directly.
- It is **not** the main place to remove “social chatter” from residual product text.

**Questions before adding a word**
- Will I regret never correcting typos for this word?
- Is this word purely grammatical (e.g. “the”, “to”), or does it carry commerce meaning?
- If it’s commerce meaning (“cart”, “track”, “checkout”), should it really be skipped in fuzzy correction?

**If not here, add it instead**
- If it’s “social noise” (hi/thanks/please): prefer `entityExtractor`’s `FILLERS` or `nlpCleaner.cleanQuery()` greetings list.
- If it’s a generic phrase that’s causing false intent matches: consider `weakSynonyms`.

---

## A2) `commonWords` — `config/commonWords.js`

**What it does**
- Used by `pipeline/fuzzyMatcher.js` as a **Common Word Guard**: if a word is common English, don’t correct it.
- This specifically protects conversational words like “seriously”, “actually”, “love”, etc.

**What it does NOT do**
- It does not influence intent matching or entity extraction.

**Questions before adding a word**
- Is this word being wrongly “corrected” into an intent keyword?
- Is it common conversational language that should never be corrected?

**If not here, add it instead**
- If it’s grammar-only: `stopWords`.
- If it’s domain-specific but should be protected: consider improving fuzzyMatcher’s guards (not this list).

---

## A3) `weakSynonyms` — `config/weakSynonyms.js`

**What it does**
- Used by `pipeline/candidateDetector.js` to **down-weight** generic multi-word phrases.
- If a matched multi-word synonym is in this list, it adds only `+0.3` keywordScore.

**What it does NOT do**
- It does not prevent matching.
- It does not affect schemaResolver scoring directly.

**Questions before adding a phrase**
- Does this phrase occur across many intents and cause false positives?
- Is it “desire scaffolding” (I want / can you / help me) rather than intent-specific?

**If not here, add it instead**
- If it’s actually a strong, intent-specific phrase: put it in the intent’s `synonyms` (not weakSynonyms).

---

## A4) `conjunctions` — `config/conjunctions.js`

**What it does**
- Used by `pipeline/preprocessor.js` to split one message into multiple statements.
- Ordered list: multi-word connectors are matched first.

**What it does NOT do**
- It does not detect intent.
- It does not extract products.

**Questions before adding a conjunction**
- Does this connector *reliably* separate two actions, not two objects?
- Will it cause harmful over-splitting? (e.g. splitting product lists into separate intents)

**If not here, add it instead**
- If the issue is “compare X and Y” being split incorrectly: add guard words to `conjunctionGuards`.

---

## A5) `conjunctionGuards` — `config/conjunctionGuards.js`

**What it does**
- Used by `pipeline/preprocessor.js` to prevent splitting when “and” links operands.
- Current example: compare-style phrases.

**What it does NOT do**
- It does not prevent splitting on “then” (your preprocessor treats then as always split-worthy).

**Questions before adding a guard word**
- Does this word reliably imply “and” is connecting items (products/attributes), not intents?
- Is it safe to treat it as a global guard, or should it be intent-specific?

---

## A6) `negations` — `config/negations.js`

**What it does**
- Used by `pipeline/preprocessor.js` to mark a statement as `negated` using regex patterns.

**What it does NOT do**
- It does not itself invert intents; inversion happens only if `intentInversions` defines a mapping.

**Questions before adding a negation token/pattern**
- Will this accidentally label normal sentences as negated?
- Is this token used in a non-negation way in commerce queries?

---

## A7) `intentInversions` — `config/intentInversions.js`

**What it does**
- Used by `pipeline/candidateDetector.js`.
- If a statement is `negated` and the detected intent appears here, it remaps to the inverse.

**What it does NOT do**
- It does not handle nuanced negation (“don’t remove” vs “remove”). It’s a coarse remap.

**Questions before adding an inversion mapping**
- Is there a true, stable inverse intent?
- Will users phrase negations in a way that makes this mapping correct most of the time?

---

## A8) `intentRegistry` — `config/intentRegistry.js` (meta-inventory)

This file doesn’t contain word lists, but it controls how your word lists are consumed:

**What it does**
- Loads all intents.
- Exposes:
  - `getAllKeywords()`
  - `buildKeywordMap()`
  - `buildIdfMap()` for **keywords + synonyms tokens** across intents.

**What it does NOT do**
- It does not apply stopwords/common word filtering when building IDF. All tokens count.

**Questions before adding new words to intents**
- Will this word show up in many intents and reduce its IDF signal?
- Is this word so common (“what”, “me”, “is”) that it adds little value but dilutes IDF?

---

# B) Inline inventories that affect behavior (outside config)

## B1) `ACTION_VERBS` — `pipeline/entityExtractor.js`

**What it does**
- Maps *specific verbs* to *action categories*.
- Produces `action` entities.
- Feeds `schemaResolver`’s `ACTION_TO_INTENTS` mapping (high-precision routing).

**What it does NOT do**
- It does not capture multi-word action phrases (only single tokens).
- It does not do “semantic synonyms” unless you explicitly add them.

**Questions before adding a verb**
- Is the verb ambiguous in shopping context? (If yes, it will misroute.)
- Does it map cleanly to exactly one action category?
- Do I need it as an action signal, or is it better as an intent synonym?

**If not here, add it instead**
- If it’s a multi-word phrase (“take my money”): add to intent `synonyms`.
- If it’s generic desire (“I want”): add to `weakSynonyms` (or keep it weak).

---

## B2) `FILLERS` — `pipeline/entityExtractor.js`

**What it does**
- A large set of “non-entity” words that shouldn’t be treated as product clues.
- Helps keep `residualWords` (product lump) cleaner.

**What it does NOT do**
- It does not affect fuzzy correction.
- It does not affect intent candidate matching directly.

**Questions before adding a word**
- Is this word frequently ending up in residual product lumps?
- Is it genuinely non-informative across your domain?

**If not here, add it instead**
- If it’s a grammatical word and you mainly care about fuzzy skipping: `stopWords`.
- If it’s a greeting/politeness word and you want aggressive stripping for product extraction: also add to `nlpCleaner.cleanQuery()` greetings list.

---

## B3) `CLAUSE_EXCLUDE` — `pipeline/entityExtractor.js`

**What it does**
- Prevents clause/attribute detection from triggering on overly generic words.

**What it does NOT do**
- It does not affect product extraction directly; it affects whether a token becomes a clause entity.

**Questions before adding a word**
- Is this word appearing in clause labels/matches but shouldn’t create a clause entity?

---

## B4) IntentScorer guards: `junkQueries` and `navigationalTerms` — `pipeline/intentScorer.js`

**What it does**
- Penalizes cases where extracted `product_name` is actually a verb or navigation term.

**What it does NOT do**
- It does not prevent extraction; it only adjusts final scoring.

**Questions before adding a term**
- Is this term frequently extracted as a product but is never a legitimate product name?

---

# C) Cleaning-related word inventories (`pipeline/nlpCleaner.js`)

File:
- `src/services/intentResolver/pipeline/nlpCleaner.js`

## C1) `cleanText(text)`

**What it does**
- Removes adverbs using `compromise`.
- Lowercases and strips punctuation with a regex.

**What it does NOT do**
- It does not remove conjunctions by default (line is commented out).
- It does not remove pronouns/prepositions.

**When to modify**
- Only if you see adverbs/punctuation harming intent detection.

---

## C2) `stripSocialNoise(text)` greetings list

**List**
- `hello`, `hi`, `hey`, `yo`, `sup`

**What it does**
- Removes greeting tokens.

**What it does NOT do**
- It doesn’t remove “please/thanks” (that’s in `cleanQuery`).

---

## C3) `cleanQuery(text)` actionNoise + greetings list

**actionNoise list**
- `get`, `show`, `find`, `view`, `search`, `give`, `want`, `need`, `buy`

**greetings/politeness list**
- `hello`, `hi`, `hey`, `yo`, `sup`, `please`, `thanks`, `thank you`

**What it does**
- Aggressively removes:
  - adverbs, conjunctions, prepositions, pronouns, modals
  - common action verbs that pollute search/product mentions
  - greetings/politeness
- Produces a “product-like” query string.

**What it does NOT do**
- It does not “understand products”; it only removes noise.
- It can’t safely remove domain words without risk.

**Questions before adding to `actionNoise`**
- Is this word *never* part of a product name in your catalog?
- Will removing it cause loss of meaning in queries like “case for iphone”?

**If not here, add it instead**
- If the word is causing intent misclassification: tune intent keywords/synonyms or `ACTION_VERBS`.
- If the word is causing residual lumps: add to `FILLERS`.

---

# D) Per-intent inventories (`config/intents/*.js`)

Every intent file defines:
- `keywords`: primary triggers (treated as “core verbs/signals”)
- `synonyms`: recall expansion phrases (can be single- or multi-word)

## What `keywords` do
- Used everywhere:
  - Candidate detection
  - Schema keyword scoring
  - IDF map building
  - Fuzzy correction target list (**important**: fuzzyMatcher only corrects toward keywords)
  - IntentScorer treats matched keywords as 5x weight vs synonyms

## What `keywords` do NOT do
- They don’t extract parameters.
- They don’t guarantee the intent will win; schema fit and action verbs can override.

## Questions before adding a `keyword`
- Is it a single, unambiguous action word for this intent?
- Would I want fuzzyMatcher to correct typos *into* this word?
- Will adding it to multiple intents reduce its IDF usefulness?

## What `synonyms` do
- CandidateDetector uses them to match phrases and extra words.
- Multi-word synonyms are especially strong for candidate detection.

## Questions before adding a `synonym`
- Is it a phrase users actually say?
- Is it too generic and shared across many intents?
- If generic, should it be in `weakSynonyms` instead (so it’s weak)?

---

## D1) Current intent lexicons (enumerated)

### `add_to_cart`
- **keywords**: `add`, `cart`
- **synonyms**: `throw in`, `put in`, `grab`, `cop`, `i'll take`, `gimme`, `hook me up with`, `i would like`, `add to cart`, `add to basket`, `add to bag`, `put in cart`, `put in basket`, `put in bag`, `add it to cart`, `add this to cart`, `add that to cart`, `add it to my cart`, `add this to my cart`, `add that to my cart`, `buy it`, `purchase it`, `order it`, `let me get`, `let me buy`, `grab`, `cop`

### `browse_collection`
- **keywords**: `collection`, `new arrivals`, `best sellers`, `trending`, `featured`
- **synonyms**: `show me the collection`, `browse collection`, `what is trending`, `new products`, `latest arrivals`, `popular items`, `what is new`, `what's new`, `top picks`, `curated`, `show me new arrivals`, `best selling`, `most popular`, `hot items`, `fresh drops`, `newest items`

### `cancel_order`
- **keywords**: `cancel`, `abort`, `revoke`, `kill`, `stop`, `remove`, `abandon`
- **synonyms**: `cancel my order`, `cancel order`, `abort order`, `i want to cancel`, `undo my order`, `stop my order`, `cancel this order`, `i changed my mind`, `revoke order`, `cancel purchase`, `void order`

### `check_availability`
- **keywords**: `available`, `in stock`, `stock`, `availability`
- **synonyms**: `is it available`, `is it in stock`, `is there`, `have you got`, `any left`, `still available`, `still in stock`, `out of stock`, `sold out`, `back in stock`, `check stock`, `check availability`

### `confirm_order`
- **keywords**: `confirm`, `finalize`, `approve`
- **synonyms**: `confirm my order`, `finalize order`, `place the order`, `yes confirm`, `go ahead`, `approve order`, `submit order`, `proceed with order`, `yes place it`, `confirm purchase`, `lock it in`, `place my order`

### `discovery_sentinel`
- **keywords**: `discover`, `explore`, `browse`, `surprise`, `new`, `recommendation`
- **synonyms**: `show me everything`, `what do you sell`, `what is available`, `browse products`, `explore your store`, `discover products`, `show me things`, `what can i find`, `show me your stuff`, `all products`, `everything you have`, `just show me`

### `end_conversation`
- **keywords**: `bye`, `goodbye`, `end`, `done`, `exit`
- **synonyms**: `see you later`, `talk to you later`, `thanks bye`, `that is all`, `that's all`, `nothing else`, `i am done`, `i'm done`, `close chat`, `end chat`, `finish`, `later`, `peace`, `catch you later`, `gotta go`

### `get_advice`
- **keywords**: `advice`, `should`, `ought`, `recommend`, `suggest`, `guidance`, `advisor`, `should i buy`, `what to buy`, `recommend me`
- **synonyms**: `buy`, `choose`, `pick`, `what should i buy`, `what do you recommend`, `can you suggest`, `recommendation`, `suggestion`, `tips`, `guide`, `advice for`, `i need advice`, `help me choose`, `help me decide`, `which one should i get`, `what is the best`, `best option`, `i am confused`, `not sure what to pick`, `guide me`, `what would you suggest`, `any recommendations`, `tips for buying`

### `get_help`
- **keywords**: `help`, `assist`, `support`, `guide`
- **synonyms**: `what can you do`, `how do i`, `help me`, `i need help`, `i need assistance`, `show me how`, `what are your features`, `what do you offer`, `how does this work`, `instructions`, `tutorial`, `usage`, `capabilities`, `menu`

### `give_feedback`
- **keywords**: `feedback`, `rate`, `review`, `complaint`, `complain`
- **synonyms**: `i want to complain`, `give feedback`, `rate this`, `leave a review`, `how was my experience`, `rate my experience`, `i have a complaint`, `this was bad`, `this was great`, `bad experience`, `good experience`, `report issue`, `not satisfied`, `very satisfied`, `thumbs up`, `thumbs down`

### `list_orders`
- **keywords**: `history`, `purchases`, `bought`, `past`, `previous`
- **synonyms**: `orders`, `my orders`, `order history`, `past orders`, `show my orders`, `list my orders`, `what did i order`, `previous orders`, `purchase history`, `recent orders`, `show order history`, `all my orders`, `what have i bought`

### `list_vendors`
- **keywords**: `vendors`, `sellers`, `stores`, `shops`, `brands`
- **synonyms**: `list vendors`, `show all stores`, `which sellers`, `what brands are available`, `list of sellers`, `all shops`, `show available vendors`, `who sells on here`, `marketplace sellers`, `directory`, `list all vendors`

### `order_status`
- **keywords**: `track`, `status`, `tracking`
- **synonyms**: `track`, `tracking`, `where is my order`, `where's my order`, `track my order`, `order status`, `order tracking`, `shipment`, `shipped`, `arrived`, `when will`, `eta`, `delivery status`, `check order`, `check my order`, `track package`, `package status`, `where is my package`

### `product_compare`
- **keywords**: `compare`, `comparison`, `versus`, `vs`, `side by side`
- **synonyms**: `match up`, `stack up`, `weigh`, `put against`, `how does x stack against`, `differences between`, `compare with`, `compare to`, `compare against`, `which is better`, `which one is better`, `difference between`, `better between`, `vs`, `v/s`

### `product_search`
- **keywords**: `search`, `explore`, `discover`, `find`, `show`
- **synonyms**: `look`, `browse`, `show me`, `let me see`, `i want to see`, `looking for`, `do you have`, `what do you have`, `any`, `got any`, `help me find`, `where can i find`, `display`, `view`, `buy`, `want`, `get`, `need`

### `remove_from_cart`
- **keywords**: `remove`, `delete`, `drop`, `take out`
- **synonyms**: `get rid of`, `ditch`, `cancel item`, `don't want`, `lose`, `scratch`, `nix`, `take away`, `remove from cart`, `remove from basket`, `remove from bag`, `take out of cart`, `take out of basket`, `delete from cart`, `drop from cart`

### `set_delivery`
- **keywords**: `delivery`, `shipping`, `express`, `standard`, `address`, `location`, `delivered`
- **synonyms**: `set delivery`, `change shipping`, `delivery options`, `shipping method`, `express delivery`, `standard shipping`, `how will it be delivered`, `delivery address`, `ship to`, `deliver to`, `change delivery`, `shipping preference`, `delivery method`

### `start_checkout`
- **keywords**: `checkout`, `pay`, `purchase`, `buy now`, `place order`
- **synonyms**: `proceed to checkout`, `ready to pay`, `i want to pay`, `finalize order`, `complete purchase`, `submit order`, `go to checkout`, `check out`, `pay for my cart`, `i want to checkout`, `take my money`, `process my order`, `ready to buy`, `how do i pay`, `payment`

### `test_microstate`
- **keywords**: `dami`
- **synonyms**: `dami microstate`, `dami confirmation`, `dami buttons`

### `update_cart_quantity`
- **keywords**: `update`, `change`, `quantity`, `modify`, `bump`, `adjust`, `set`
- **synonyms**: `change quantity`, `update quantity`, `make it 2`, `make it 3`, `i want more`, `increase quantity`, `decrease quantity`, `set quantity`, `change amount`, `update amount`, `i need more of`, `fewer of`, `less of`, `bump it up`, `adjust quantity`

### `vendor_contact`
- **keywords**: `contact`, `message`, `whatsapp`, `reach`, `talk`, `vendor`, `seller`, `email`, `phone`, `support`, `help`, `address`, `location`, `number`
- **synonyms**: `contact vendor`, `message seller`, `whatsapp vendor`, `how to reach`, `talk to seller`, `send message to vendor`, `contact seller`, `get in touch with`, `vendor whatsapp`, `chat with vendor`, `reach the seller`, `vendor contact`

### `vendor_identity`
- **keywords**: `vendor`, `seller`, `brand`, `company`, `makes`, `sells`
- **synonyms**: `belongs to`, `sold by`, `who sells`, `who sells this`, `which vendor`, `which seller`, `is this from`, `who is the seller`, `vendor of this product`, `where is this from`, `who made this`, `who provides this`, `product vendor`, `product seller`, `from which store`

### `vendor_info`
- **keywords**: `vendor`, `seller`, `store`, `about`, `details`, `info`
- **synonyms**: `about vendor`, `vendor info`, `who is`, `tell me about this vendor`, `vendor information`, `seller info`, `who is this seller`, `about this store`, `vendor details`, `learn about vendor`, `store information`, `seller details`, `who runs this shop`, `about the seller`

### `vendor_products`
- **keywords**: `vendor`, `seller`, `store`, `shop`, `sell`, `sells`, `from`
- **synonyms**: `show me products from`, `vendor products`, `seller products`, `what does this vendor sell`, `products by`, `items from`, `browse vendor`, `shop products`, `store items`, `vendor's products`, `seller's items`, `from this seller`, `from`, `by`

### `view_cart`
- **keywords**: `cart`, `basket`, `bag`
- **synonyms**: `what's in my cart`, `show cart`, `show my cart`, `show me my cart`, `view cart`, `my cart`, `cart contents`, `let me see my cart`, `shopping bag`, `shopping basket`, `shopping cart`, `what did i add`, `what have i added`, `tell me what i got`, `see my cart`, `open cart`, `check cart`, `can i see my cart`, `cart summary`, `items in cart`, `items in my cart`, `view my basket`

---

# E) Quick “where do I add this word?” decision checklist

Use this when you want to add a new word/phrase.

1) **Is it a single verb that should route actions with high precision?**
- Add to `ACTION_VERBS`.

2) **Is it a multi-word phrase users say for a specific intent?**
- Add to that intent’s `synonyms`.

3) **Is it a single, strong, unambiguous trigger word for an intent?**
- Add to that intent’s `keywords`.

4) **Is it generic desire scaffolding (I want / can you / help me)?**
- Add to `weakSynonyms` (or keep it in intent synonyms but accept low value + IDF dilution).

5) **Is it a greeting/politeness word polluting product lumps?**
- Add to `FILLERS` and/or `nlpCleaner.cleanQuery()` greetings.

6) **Is it a common English word being wrongly typo-corrected?**
- Add to `commonWords`.

7) **Is it just grammar that should never be corrected?**
- Add to `stopWords`.

8) **Is it causing multi-intent splitting bugs?**
- Adjust `conjunctions` and/or `conjunctionGuards`.

---

End.
