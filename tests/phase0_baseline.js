/**
 * Phase 0: Baseline Metrics Collection
 * Run test queries to establish legacy system baseline
 */

const axios = require('axios');

const API_URL = 'http://localhost:3005';

const TEST_QUERIES = [
    // Search queries
    { message: "Show me laptops" },
    { message: "I need a phone under $500" },
    { message: "Gaming laptops" },
    { message: "Show me Apple products" },
    { message: "Affordable headphones" },

    // Vendor queries
    { message: "Tell me about Dell" },
    { message: "What does Infinix sell?" },
    { message: "Is Apple a vendor here?" },

    // Help/greeting
    { message: "Hi" },
    { message: "What can you help me with?" },
    { message: "Help" },

    // Product details
    { message: "Show me MacBook details" },
    { message: "Tell me about Samsung phones" },

    // Conversational
    { message: "Thanks" },
    { message: "That's cool" },
    { message: "Okay" },

    // Cart operations
    { message: "Add the first one to cart" },
    { message: "Show my cart" },

    // Complex queries
    { message: "Compare Dell and HP laptops" },
    { message: "Show me budget gaming phones under $300" }
];

async function runBaseline() {
    console.log('🧪 Phase 0: Baseline Metrics Collection\n');
    console.log(`Running ${TEST_QUERIES.length} test queries...\n`);

    const sessionId = 'baseline-test-session';
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < TEST_QUERIES.length; i++) {
        const query = TEST_QUERIES[i];
        process.stdout.write(`[${i + 1}/${TEST_QUERIES.length}] "${query.message}"... `);

        try {
            const response = await axios.post(`${API_URL}/chat`, {
                session_id: sessionId,
                message: query.message
            });

            if (response.data.success) {
                console.log('✅');
                successCount++;
            } else {
                console.log('❌ (API returned success:false)');
                errorCount++;
            }

            // Delay between requests to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.log(`❌ (${error.message})`);
            errorCount++;
        }
    }

    // Fetch final metrics
    console.log('\n📊 Fetching metrics...\n');

    try {
        const metricsResponse = await axios.get(`${API_URL}/metrics`);
        const { metrics, summary } = metricsResponse.data;

        console.log('='.repeat(60));
        console.log('BASELINE METRICS (Legacy System)');
        console.log('='.repeat(60));
        console.log(summary);
        console.log('');
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed: ${errorCount}`);
        console.log(`📈 Success Rate: ${((successCount / TEST_QUERIES.length) * 100).toFixed(1)}%`);
        console.log('='.repeat(60));

        // Save to file
        const fs = require('fs');
        const timestamp = new Date().toISOString();
        const baselineData = {
            timestamp,
            queries_run: TEST_QUERIES.length,
            success_count: successCount,
            error_count: errorCount,
            metrics: metrics.legacy,
            summary
        };

        fs.writeFileSync(
            'logs/baseline_metrics.json',
            JSON.stringify(baselineData, null, 2)
        );

        console.log('\n💾 Baseline saved to logs/baseline_metrics.json\n');

    } catch (error) {
        console.error('❌ Failed to fetch metrics:', error.message);
    }
}

// Run baseline
runBaseline().catch(console.error);
