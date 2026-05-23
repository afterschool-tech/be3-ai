/**
 * src/context/indexer.js
 * 
 * Active RAG Indexer
 * Converts structured store context (vendors, categories, collections) into
 * dense prose chunks, generates embeddings, and upserts them into the vector DB.
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const context = require('./storeContext');

const poolConfig = process.env.DB_SOURCE === 'cloud'
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'saas_ecommerce',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '343434',
    };
const pool = new Pool(poolConfig);

async function generateEmbeddingsAndUpsert() {
    console.log("🚀 Starting Active RAG Indexer...");

    // We already required the context object top-level
    const chunks = [];

    // 1. Process Vendors
    console.log(`Processing ${Object.keys(context.VENDORS || {}).length} vendors...`);
    for (const [key, vendor] of Object.entries(context.VENDORS || {})) {
        if (!vendor) continue;

        let prose = `Vendor: ${vendor.business_name}. `;
        if (vendor.business_description) {
            prose += `${vendor.business_description}. `;
        }

        if (vendor.kyb_status === 'approved') {
            prose += `This is a verified business. `;
        }

        if (vendor.avg_rating) {
            prose += `They have a rating of ${vendor.avg_rating} stars from ${vendor.total_ratings} reviews. `;
        }

        if (vendor.primary_location) {
            const loc = vendor.primary_location;
            const locationStr = [loc.address, loc.city, loc.state, loc.country].filter(Boolean).join(', ');
            if (locationStr) {
                prose += `Located in ${locationStr}. `;
            }
        }

        if (vendor.categories && vendor.categories.length > 0) {
            const cats = vendor.categories.map(c => c.label).join(', ');
            prose += `They actively sell in these categories: ${cats}. `;
        }

        if (vendor.shipping_config) {
            const sc = vendor.shipping_config;
            prose += `Standard processing time is ${sc.processing_days_min} to ${sc.processing_days_max} days. `;
            if (sc.base_fee > 0) {
                prose += `Base shipping fee is ${sc.base_fee}. `;
            }
        }

        if (vendor.delivery_zones && vendor.delivery_zones.length > 0) {
            const zones = vendor.delivery_zones.map(z => z.name || z.country).join(', ');
            prose += `They deliver to: ${zones}. `;
        }

        chunks.push({
            id: `vendor_${vendor.id}`,
            type: 'vendor',
            entity_id: vendor.id,
            entity_name: vendor.business_name,
            content: prose.trim()
        });
    }

    // 2. Process Categories
    console.log(`Processing ${Object.keys(context.CATEGORIES || {}).length} categories...`);
    for (const [key, category] of Object.entries(context.CATEGORIES || {})) {
        if (!category) continue;

        let prose = `Category: ${category.label}. `;
        if (category.description) {
            prose += `${category.description} `;
        }

        const breadcrumb = (category.breadcrumb || []).map(b => b.label || b.name).join(' > ');
        if (breadcrumb) {
            prose += `Located under ${breadcrumb}. `;
        }

        if (category.total_count > 0) {
            prose += `This category currently has ${category.total_count} products available. `;
        } else {
            prose += `This category is currently out of stock (0 products). `;
        }

        chunks.push({
            id: `category_${category.id}`,
            type: 'category',
            entity_id: category.id,
            entity_name: category.label,
            content: prose.trim()
        });
    }

    // 3. Process Collections
    console.log(`Processing ${Object.keys(context.COLLECTIONS || {}).length} collections...`);
    for (const [key, collection] of Object.entries(context.COLLECTIONS || {})) {
        if (!collection) continue;

        let prose = `Collection: ${collection.name}. `;
        if (collection.description) {
            prose += `${collection.description} `;
        }

        if (collection.vendor_bio) {
            prose += `About the creator: ${collection.vendor_bio} `;
        }

        prose += `This collection is ${collection.is_curated ? 'curated' : 'automated'}. `;

        chunks.push({
            id: `collection_${collection.id}`,
            type: 'collection',
            entity_id: collection.id,
            entity_name: collection.name,
            content: prose.trim()
        });
    }

    // 4. Group C: Store Policy / FAQ Chunks (manually authored)
    console.log(`Processing store policy chunks...`);
    const storePolicies = [
        {
            id: 'policy_delivery',
            topic: 'delivery',
            content: `Be3 Delivery & Shipping Policy. Delivery on Be3 is managed individually by each vendor — there is no single flat rate for all orders. Each vendor sets their own base shipping fee and adjusts it per delivery zone (by landmark, state, or country). The final fee is calculated as the vendor's base fee multiplied by the zone rate multiplier for your location. Total delivery time = the vendor's processing days (time to pack and hand off) + transit days for your zone. If a vendor does not cover your location, they cannot accept your order. To see exact delivery costs, proceed to checkout and enter your delivery address. Customers receive order tracking updates once the item is dispatched.`
        },
        {
            id: 'policy_returns',
            topic: 'returns',
            content: `Be3 Returns & Refunds Policy. Customers may return eligible items within 7 days of delivery. Items must be unused, in their original packaging, and with all tags intact. Perishable goods, customised orders, and digital products are not eligible for return. To initiate a return, contact our support team with your order ID and reason. Refunds are processed within 3 to 5 business days once the returned item is received and inspected. Refunds are issued to the original payment method or as wallet credit.`
        },
        {
            id: 'policy_payments',
            topic: 'payments',
            content: `Be3 Payment Options. Be3 accepts payment via debit and credit cards (Visa, Mastercard, Verve), bank transfers, and USSD codes. Customers can also pay using their Be3 wallet balance, which can be topped up at any time. All transactions are secured and encrypted. Pay-on-delivery is available for select locations within Lagos. Instalment payments are currently not supported. If a payment fails, please retry or contact your bank before reaching out to us.`
        },
        {
            id: 'policy_about',
            topic: 'about_us',
            content: `About Be3. Be3 is a curated multi-vendor e-commerce marketplace connecting verified sellers with buyers across Nigeria. Our platform hosts a wide range of categories including electronics, fashion, home goods, beauty, and more. Every vendor on Be3 is vetted before listing. We are committed to trust, convenience, and fast delivery. Our mission is to empower local businesses while giving every Nigerian shopper access to quality products at fair prices.`
        },
        {
            id: 'policy_support',
            topic: 'support',
            content: `Be3 Customer Support. Our support team is available Monday to Friday, 8am to 8pm WAT. On weekends we operate reduced hours: 10am to 4pm WAT. You can reach us via WhatsApp, live chat, or email. Response time is typically under 2 hours during business hours. For urgent order issues such as wrong items or missing deliveries, please contact us immediately with your order ID so we can escalate promptly.`
        },
        {
            id: 'policy_ordering',
            topic: 'ordering_process',
            content: `How to order on Be3. Browse products from verified vendors, add items to your cart, and proceed to checkout. You can search by category, vendor name, or product type. At checkout, provide your delivery address and select a payment method. Once your order is confirmed, you will receive a notification and a tracking ID when the item ships. You can track your order at any time by asking the Be3 assistant or visiting the orders section.`
        }
    ];

    for (const policy of storePolicies) {
        chunks.push({
            id: policy.id,
            type: 'store_policy',
            entity_id: null,
            entity_name: `Be3 ${policy.topic.replace(/_/g, ' ')} policy`,
            content: policy.content
        });
    }

    // 5. Group E: Platform Identity / Capabilities Chunks
    console.log(`Processing platform identity chunks...`);
    const platformChunks = [
        {
            id: 'platform_identity',
            content: `Be3 is a Nigerian e-commerce marketplace where customers can discover, compare, and buy products from multiple verified vendors in one place. The platform supports product search, vendor browsing, order placement, cart management, wishlist curation, and order tracking. Be3 is accessible via WhatsApp and the web. The AI assistant can help customers find products, learn about vendors, check delivery info, and navigate their orders.`
        },
        {
            id: 'platform_capabilities',
            content: `What Be3's shopping assistant can help you with: searching for specific products or categories, finding out about vendors and their products, checking delivery and return policies, adding items to your cart or wishlist, tracking your orders, comparing products, and getting personalised shopping advice. The assistant cannot process payments directly, access other platforms, or guarantee stock availability. For a payment issue or account problem, the support team is the right contact.`
        }
    ];

    for (const platform of platformChunks) {
        chunks.push({
            id: platform.id,
            type: 'store_identity',
            entity_id: null,
            entity_name: 'Be3 Platform',
            content: platform.content
        });
    }


    console.log(`Generated ${chunks.length} total knowledge chunks.Starting vectorization...`);

    // Ensure table exists
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_knowledge_chunks(
                id VARCHAR(100) PRIMARY KEY,
                tenant_id UUID,
                type VARCHAR(50) NOT NULL,
                entity_id UUID,
                entity_name VARCHAR(255),
                content TEXT NOT NULL,
                embedding vector(384),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `);

    // Create an HNSW index for fast semantic search if not exists
    await pool.query(`
        CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_embedding_idx 
        ON ai_knowledge_chunks USING hnsw(embedding vector_cosine_ops)
            `);

    const BATCH_SIZE = 20;
    const TENANT_ID = process.env.TENANT_ID || '00000000-0000-0000-0000-000000000000';
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const texts = batch.map(c => c.content);

        try {
            console.log(`Vectorizing batch ${i / BATCH_SIZE + 1} (${batch.length} chunks)...`);

            // Connect to local transformer service (default: localhost:3009)
            const TRANSFORMER_URL = process.env.TRANSFORMER_URL || 'http://localhost:3009';
            const { default: axios } = await import('axios');

            const res = await axios.post(`${TRANSFORMER_URL}/embed`, {
                texts: texts,
                purpose: 'passage'
            });

            const embeddings = res.data?.embeddings;
            if (!embeddings || embeddings.length !== batch.length) {
                throw new Error("Transformer response mismatch or empty");
            }

            // Database UPSERT batch
            for (let j = 0; j < batch.length; j++) {
                const chunk = batch[j];
                const vectorStr = `[${embeddings[j].join(',')}]`;

                await pool.query(`
                    INSERT INTO ai_knowledge_chunks (id, tenant_id, type, entity_id, entity_name, content, embedding, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::vector, NOW())
                    ON CONFLICT (id) DO UPDATE SET 
                        tenant_id = EXCLUDED.tenant_id,
                        type = EXCLUDED.type,
                        entity_id = EXCLUDED.entity_id,
                        entity_name = EXCLUDED.entity_name,
                        content = EXCLUDED.content,
                        embedding = EXCLUDED.embedding,
                        updated_at = NOW()
                `, [chunk.id, TENANT_ID, chunk.type, chunk.entity_id, chunk.entity_name, chunk.content, vectorStr]);

                successCount++;
            }
        } catch (err) {
            if (err.code === 'ECONNREFUSED') {
                console.error(`Batch failed: Transformer service is not running. Start it on port 3009!`);
            } else {
                console.error(`Batch failed: ${err.message || err.toString()}`);
                if (err.response) {
                    console.error(`Response data: ${JSON.stringify(err.response.data)}`);
                }
            }
            failCount += batch.length;
        }
    }

    console.log(`✅ Indexer complete. ${successCount} upserted, ${failCount} failed.`);
    process.exit(0);
}

generateEmbeddingsAndUpsert().catch(console.error);
