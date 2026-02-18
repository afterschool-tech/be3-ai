/**
 * Normalization Utility
 * Shared logic for resolving user-provided strings to store entities.
 */

const { CATEGORIES, VENDORS } = require('../context/storeContext');

/**
 * Normalizes a category string (label, slug, or breadcrumb) to a valid Category ID.
 * @param {string} cat - The input category string.
 * @param {Object} [context] - Optional categories context.
 * @param {boolean} [exactMatchOnly=false] - If true, only returns IDs for exact label/slug matches.
 * @returns {string|null} - The Category UUID or null.
 */
function normalizeCategory(cat, context = null, exactMatchOnly = false) {
    if (!cat) return null;
    const cats = context || CATEGORIES;
    let catLower = cat.trim().toLowerCase();

    // 1. Handle breadcrumbs like "Smartphones & Tablets > Smartphones"
    // We take the last part as it's the most specific.
    if (catLower.includes('>')) {
        catLower = catLower.split('>').pop().trim();
    }

    // 2. Direct match with key (if input was already a normalized key)
    if (cats[catLower]) return cats[catLower].id;

    // 3. Find by label, slug, or partial label match
    const match = Object.values(cats).find(c =>
        c.id === catLower || // Already an ID
        c.slug === catLower ||
        c.label.toLowerCase() === catLower ||
        (!exactMatchOnly && (catLower.includes(c.label.toLowerCase()) || c.label.toLowerCase().includes(catLower)))
    );

    return match ? match.id : null;
}

/**
 * Normalizes a vendor string to the canonical business name.
 * Now supports history-based resolution for "their" or "this vendor".
 * @param {string} vendor - Input vendor string.
 * @param {Array} history - Interaction history.
 * @param {Object} [context] - Optional vendors context.
 */
function normalizeVendor(vendor, history = [], context = null) {
    if (!vendor) return null;
    const vendors = Object.values(context || VENDORS);
    const vendorLower = vendor.trim().toLowerCase();

    // 1. Resolve from history (e.g. "their", "this vendor")
    if (vendorLower === 'their' || vendorLower === 'this vendor' || vendorLower === 'that shop') {
        for (let i = history.length - 1; i >= 0; i--) {
            const entry = history[i];
            const text = entry.text.toLowerCase();
            const found = vendors.find(v => text.includes(v.business_name.toLowerCase()));
            if (found) return found.business_name;
        }
    }

    // 2. Direct match or partial match
    const match = vendors.find(v =>
        v.business_name.toLowerCase() === vendorLower ||
        vendorLower.includes(v.business_name.toLowerCase()) ||
        v.business_name.toLowerCase().includes(vendorLower)
    );

    if (match) return match.business_name;

    // 3. Punctuation-Robust Fallback (Strip non-alphanumeric)
    const strip = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const vendorStripped = strip(vendor);

    const robustMatch = vendors.find(v => {
        const canonicalStripped = strip(v.business_name);
        return canonicalStripped === vendorStripped ||
            canonicalStripped.includes(vendorStripped) ||
            vendorStripped.includes(canonicalStripped);
    });

    return robustMatch ? robustMatch.business_name : vendor;
}

module.exports = {
    normalizeCategory,
    normalizeVendor
};
