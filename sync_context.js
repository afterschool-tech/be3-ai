/**
 * Sync Context Utility
 * Validates and synchronizes the flat knowledge tables (storeContext.js and clauses.js)
 */

const { CATEGORIES, COLLECTIONS, VENDORS, BUSINESSES } = require('./storeContext');
const { CLAUSES } = require('./clauses');

function validateContext() {
    console.log('🧪 Validating Store Context...');
    let errors = 0;

    // 1. Check Categories -> Clauses consistency
    for (const [catId, cat] of Object.entries(CATEGORIES)) {
        if (cat.allowed_clauses) {
            cat.allowed_clauses.forEach(clauseId => {
                if (!CLAUSES[clauseId]) {
                    console.error(`❌ Category "${catId}" references non-existent clause "${clauseId}"`);
                    errors++;
                } else if (!CLAUSES[clauseId].categories.includes(catId)) {
                    console.warn(`⚠️ Clause "${clauseId}" exits but category "${catId}" is not in its applicability list.`);
                }
            });
        }
    }

    // 2. Check Clauses -> Attributes consistency
    for (const [clauseId, clause] of Object.entries(CLAUSES)) {
        clause.categories.forEach(catId => {
            if (CATEGORIES[catId]) {
                if (!CATEGORIES[catId].attributes.includes(clause.attribute)) {
                    console.error(`❌ Clause "${clauseId}" uses attribute "${clause.attribute}" but Category "${catId}" doesn't define it.`);
                    errors++;
                }
            } else {
                console.error(`❌ Clause "${clauseId}" references non-existent category "${catId}"`);
                errors++;
            }
        });
    }

    // 3. Check Vendors -> Categories
    for (const [vendorId, vendor] of Object.entries(VENDORS)) {
        vendor.categories.forEach(catId => {
            if (!CATEGORIES[catId]) {
                console.warn(`⚠️ Vendor "${vendorId}" references category "${catId}" which is not in CATEGORIES.`);
            }
        });
    }

    if (errors === 0) {
        console.log('✅ Context is semantically valid!');
    } else {
        console.log(`\n❌ Validation failed with ${errors} errors.`);
    }
}

/**
 * Generates an overview of the "Prefix + Category + Suffix" system
 */
function generateCatalogSummary() {
    console.log('\n📖 Meaning System Summary:');
    for (const [catId, cat] of Object.entries(CATEGORIES)) {
        console.log(`\n[${cat.label}]`);
        const applicable = Object.entries(CLAUSES).filter(([_, c]) => c.categories.includes(catId));
        applicable.forEach(([id, c]) => {
            const prefix = c.display.prefix ? `${c.display.prefix} ` : '';
            const suffix = c.display.suffix ? ` ${c.display.suffix}` : '';
            console.log(`  - ${id}: "${prefix}${catId}${suffix}"`);
        });
    }
}

// Run validation
validateContext();
generateCatalogSummary();
