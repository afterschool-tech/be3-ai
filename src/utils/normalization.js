/**
 * Normalization Utility
 * Shared logic for resolving user-provided strings to store entities.
 */

const { CATEGORIES, VENDORS } = require('../context/storeContext');

/**
 * Normalizes a category string (label, slug, or breadcrumb) to a valid Category ID.
 * @param {string} cat - The input category string.
 * @returns {string|null} - The Category UUID or null.
 */
function normalizeCategory(cat) {
    if (!cat) return null;
    let catLower = cat.trim().toLowerCase();

    // 1. Handle breadcrumbs like "Smartphones & Tablets > Smartphones"
    // We take the last part as it's the most specific.
    if (catLower.includes('>')) {
        catLower = catLower.split('>').pop().trim();
    }

    // 2. Direct match with key (if input was already a normalized key)
    if (CATEGORIES[catLower]) return CATEGORIES[catLower].id;

    // 3. Find by label, slug, or partial label match
    const match = Object.values(CATEGORIES).find(c =>
        c.id === catLower || // Already an ID
        c.slug === catLower ||
        c.label.toLowerCase() === catLower ||
        catLower.includes(c.label.toLowerCase()) ||
        c.label.toLowerCase().includes(catLower)
    );

    return match ? match.id : null;
}

/**
 * Normalizes a vendor string to the canonical business name.
 * Now supports history-based resolution for "their" or "this vendor".
 */
function normalizeVendor(vendor, history = []) {
    if (!vendor) return null;
    const vendors = Object.values(VENDORS);
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

    return match ? match.business_name : vendor;
}

module.exports = {
    normalizeCategory,
    normalizeVendor
};
