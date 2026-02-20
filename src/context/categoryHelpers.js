/**
 * Category Hierarchy Helpers
 * 
 * Utility functions for navigating the CATEGORIES tree.
 * Used by Knowledge Injection pipeline stages for:
 *   - Parental pivot (search expansion)
 *   - Sibling suggestions (contextual alternatives)
 *   - Hierarchy boost (root category detection)
 *   - Path breadcrumbs
 * 
 * All functions accept a category UUID and use the flat CATEGORIES object.
 */

const { CATEGORIES } = require('./storeContext');
const { logDebug } = require('../utils/debugLogger');

/**
 * Find a category object by UUID.
 * @param {string} categoryId - UUID of the category
 * @returns {Object|null} - Category object or null
 */
function findById(categoryId) {
    if (!categoryId) return null;
    return Object.values(CATEGORIES).find(c => c.id === categoryId) || null;
}

/**
 * Find the key (slug) for a category by UUID.
 * @param {string} categoryId - UUID
 * @returns {string|null} - Key like "iphones" or null
 */
function findKeyById(categoryId) {
    if (!categoryId) return null;
    const entry = Object.entries(CATEGORIES).find(([, c]) => c.id === categoryId);
    return entry ? entry[0] : null;
}

/**
 * Get the parent category object.
 * @param {string} categoryId - UUID of the child
 * @returns {Object|null} - Parent category object or null if root
 */
function getParent(categoryId) {
    const cat = findById(categoryId);
    if (!cat || !cat.parent_id) return null;
    const parent = findById(cat.parent_id);
    logDebug('HIERARCHY:GET_PARENT', {
        _desc: 'Get parent category — lookup parent_id',
        _example: 'Android Tablets → parent: Tablets',
        child: cat.label,
        parent: parent?.label || 'NOT_FOUND'
    });
    return parent;
}

/**
 * Get all ancestors from current category up to root.
 * @param {string} categoryId - UUID
 * @returns {Array} - [parent, grandparent, ...root] (nearest first)
 */
function getAncestors(categoryId) {
    const ancestors = [];
    let current = findById(categoryId);
    if (!current) return ancestors;

    const visited = new Set(); // cycle protection
    while (current && current.parent_id && !visited.has(current.parent_id)) {
        visited.add(current.parent_id);
        const parent = findById(current.parent_id);
        if (parent) {
            ancestors.push(parent);
            current = parent;
        } else {
            break;
        }
    }

    logDebug('HIERARCHY:GET_ANCESTORS', {
        _desc: 'Get ancestors — path from category up to root',
        _example: 'iPhones → [Smartphones, Gadgets, root]',
        from: findById(categoryId)?.label,
        ancestors: ancestors.map(a => a.label)
    });
    return ancestors;
}

/**
 * Get sibling categories (same parent, excluding self).
 * @param {string} categoryId - UUID
 * @returns {Array} - Sibling category objects
 */
function getSiblings(categoryId) {
    const cat = findById(categoryId);
    if (!cat || !cat.parent_id) return [];

    const parent = findById(cat.parent_id);
    if (!parent || !parent.children || parent.children.length === 0) return [];

    const siblings = parent.children
        .map(childKey => CATEGORIES[childKey])
        .filter(c => c && c.id !== categoryId);

    logDebug('HIERARCHY:GET_SIBLINGS', {
        _desc: 'Get siblings — same-parent categories (for suggestions)',
        _example: 'Android Tablets → siblings: iPads, Kindle',
        category: cat.label,
        siblings: siblings.map(s => s.label)
    });
    return siblings;
}

/**
 * Get the full path from root to this category as a breadcrumb string.
 * @param {string} categoryId - UUID
 * @returns {string} - e.g. "Gadgets > Smartphones > iPhones"
 */
function getPath(categoryId) {
    const cat = findById(categoryId);
    if (!cat) return '';

    const ancestors = getAncestors(categoryId);
    const pathParts = [...ancestors.map(a => a.label).reverse(), cat.label];
    const path = pathParts.join(' > ');

    logDebug('HIERARCHY:GET_PATH', {
        _desc: 'Get category path — breadcrumb from root to category',
        _example: 'Gadgets > Smartphones > iPhones',
        category: cat.label,
        path
    });
    return path;
}

/**
 * Check if a category is a root (no parent).
 * @param {string} categoryId - UUID
 * @returns {boolean}
 */
function isRoot(categoryId) {
    const cat = findById(categoryId);
    return cat ? !cat.parent_id : false;
}

/**
 * Get children category objects.
 * @param {string} categoryId - UUID
 * @returns {Array} - Child category objects
 */
function getChildren(categoryId) {
    const cat = findById(categoryId);
    if (!cat || !cat.children || cat.children.length === 0) return [];

    return cat.children
        .map(childKey => CATEGORIES[childKey])
        .filter(Boolean);
}

module.exports = {
    findById,
    findKeyById,
    getParent,
    getAncestors,
    getSiblings,
    getPath,
    isRoot,
    getChildren
};
