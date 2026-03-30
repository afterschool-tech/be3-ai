
/**
 * AUTO-GENERATED Semantic Clauses
 * Generated: 2026-03-30T00:09:28.987Z
 */
const CLAUSES = {
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
            "desktops",
            "smartphones",
            "tablets",
            "laptops_&_computers",
            "cooling_system",
            "components",
            "graphics_card",
            "ultrabooks",
            "ram_&_storage",
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
            "desktops",
            "smartphones",
            "tablets",
            "laptops_&_computers",
            "cooling_system",
            "components",
            "graphics_card",
            "ultrabooks",
            "ram_&_storage",
            "gaming"
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
            "sound_gadget",
            "kitchen_appliances",
            "iphones",
            "ultrabooks",
            "gaming",
            "gadgets"
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
            "sound_gadget",
            "kitchen_appliances",
            "iphones",
            "ultrabooks",
            "gaming",
            "gadgets"
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
            "sound_gadget",
            "kitchen_appliances",
            "iphones",
            "android_phones",
            "smartphones_&_tablets",
            "gadgets"
        ],
        "excluded_categories": []
    },
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
            "business_laptops",
            "laptops_&_computers",
            "cooling_system",
            "components",
            "graphics_card",
            "ultrabooks",
            "smartphones_&_tablets",
            "ram_&_storage",
            "gaming",
            "fashion"
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
            "business_laptops",
            "laptops_&_computers",
            "cooling_system",
            "components",
            "graphics_card",
            "ultrabooks",
            "smartphones_&_tablets",
            "ram_&_storage",
            "gaming",
            "fashion"
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
            "business_laptops",
            "laptops_&_computers",
            "cooling_system",
            "components",
            "graphics_card",
            "ultrabooks",
            "smartphones_&_tablets",
            "ram_&_storage",
            "gaming",
            "fashion"
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
