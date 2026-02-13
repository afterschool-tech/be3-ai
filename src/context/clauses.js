
/**
 * AUTO-GENERATED Semantic Clauses
 * Generated: 2026-02-12T06:43:11.690Z
 */
const CLAUSES = {
    "apple_product": {
        "label": "apple product",
        "attribute": "brand",
        "matches": [
            "apple"
        ],
        "display": {
            "prefix": "",
            "suffix": "by apple"
        },
        "categories": [
            "android_phones",
            "business_laptops",
            "smartphones_&_tablets",
            "laptops_&_computers",
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "infinix_product": {
        "label": "infinix product",
        "attribute": "brand",
        "matches": [
            "infinix"
        ],
        "display": {
            "prefix": "",
            "suffix": "by infinix"
        },
        "categories": [
            "android_phones",
            "business_laptops",
            "smartphones_&_tablets",
            "laptops_&_computers",
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "microsoft_product": {
        "label": "Microsoft product",
        "attribute": "brand",
        "matches": [
            "microsoft"
        ],
        "display": {
            "prefix": "Microsoft",
            "suffix": ""
        },
        "categories": [
            "android_phones",
            "business_laptops",
            "smartphones_&_tablets",
            "laptops_&_computers",
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "small_storage": {
        "label": "small storage",
        "attribute": "storage",
        "matches": [
            "200"
        ],
        "display": {
            "prefix": "small storage",
            "suffix": ""
        },
        "categories": [
            "android_phones",
            "gadgets",
            "sound_gadget",
            "iphones",
            "kitchen_appliances",
            "smartphones_&_tablets"
        ],
        "excluded_categories": []
    },
    "color_for_ladies": {
        "label": "color for ladies",
        "attribute": "color",
        "matches": [
            "red",
            "green",
            "blue",
            "yellow",
            "pink",
            "grey",
            "white"
        ],
        "display": {
            "prefix": "vibrant",
            "suffix": "for ladies"
        },
        "categories": [
            "food",
            "gadgets",
            "sound_gadget",
            "iphones",
            "kitchen_appliances",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "color_for_men": {
        "label": "color for men",
        "attribute": "color",
        "matches": [
            "black",
            "brown"
        ],
        "display": {
            "prefix": "",
            "suffix": "for men"
        },
        "categories": [
            "food",
            "gadgets",
            "sound_gadget",
            "iphones",
            "kitchen_appliances",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "affordable": {
        "label": "affordable",
        "attribute": "price tier",
        "matches": [
            "budget",
            "midrange"
        ],
        "display": {
            "prefix": "cheap",
            "suffix": ""
        },
        "categories": [
            "smartphones",
            "tablets",
            "desktops",
            "laptops_&_computers",
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "expensive": {
        "label": "expensive",
        "attribute": "price tier",
        "matches": [
            "premium",
            "flagship"
        ],
        "display": {
            "prefix": "expensive",
            "suffix": ""
        },
        "categories": [
            "smartphones",
            "tablets",
            "desktops",
            "laptops_&_computers",
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "ultrabooks",
            "gaming"
        ],
        "excluded_categories": []
    },
    "high_quality": {
        "label": "High quality",
        "attribute": "quality",
        "matches": [
            "Grade A"
        ],
        "display": {
            "prefix": "High quality",
            "suffix": ""
        },
        "categories": [
            "kitchen_appliances"
        ],
        "excluded_categories": []
    }
};

function getClausesForCategory(categoryName) {
    const applicable = {};
    for (const [id, clause] of Object.entries(CLAUSES)) {
        if (clause.categories.includes(categoryName) && !clause.excluded_categories.includes(categoryName)) {
            applicable[id] = clause;
        }
    }
    return applicable;
}

module.exports = { CLAUSES, getClausesForCategory };
