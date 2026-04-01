
/**
 * AUTO-GENERATED Comprehensive Store Context
 * Generated: 2026-04-01T01:26:18.922Z
 * 
 * This context powers the AI with:
 * - Hierarchical categories (parent→child)
 * - Attributes (with predefined values)
 * - Collections (with product counts)
 * - Vendors (with product counts)
 * 
 * PHILOSOPHY: Context is ADVISORY, not restrictive.
 * The AI should use this to guide decisions, not hard-filter queries.
 */

const initContextHelpers = require('./contextHelpers');

const CATEGORIES = {
    "accessories": {
        "id": "8ce3240d-93a4-4b02-8989-2a8208662360",
        "label": "Accessories",
        "slug": "accessories",
        "description": "Accesories of all kinds",
        "image_url": "https://imgs.search.brave.com/7adXlMFwt8872TynGyu6QeWDSgVfE2c50BFsWJLe6Vw/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly9zdGF0/aWMudmVjdGVlenku/Y29tL3N5c3RlbS9y/ZXNvdXJjZXMvdGh1/bWJuYWlscy8wNzUv/NDk3LzQyOC9zbWFs/bC9zYW50YS1zLXNo/aW55LWJ1Y2tsZS1j/bG9zZS11cC1vZi1h/LXRleHR1cmVkLWJs/YWNrLWxlYXRoZXIt/YmVsdC1hbmQtZ29s/ZC1idWNrbGUtb24t/cmVkLWZhYnJpYy1m/cmVlLXBob3RvLmpw/Zw",
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "action_figures_&_collectibles": {
        "id": "2f93c6ed-0cb3-409a-ac78-13c6682b33ce",
        "label": "Action Figures & Collectibles",
        "slug": "action-figures-collectibles",
        "description": "",
        "image_url": null,
        "parent_id": "100746ef-7dba-452b-9ddd-b0c782557c35",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "activewear": {
        "id": "843ff73f-f235-44ce-82c3-84ae5b99e3b5",
        "label": "Activewear",
        "slug": "activewear",
        "description": "",
        "image_url": null,
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "air_conditioners": {
        "id": "fae211a2-a4e4-46be-8455-f9e69203c201",
        "label": "Air Conditioners",
        "slug": "air-conditioners",
        "description": "",
        "image_url": null,
        "parent_id": "2380f970-7bbf-484f-a124-c314e78d0076",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "all_in_one_pcs": {
        "id": "f564122f-2ee3-4af9-b998-b42d72d56ccd",
        "label": "All in one PCs",
        "slug": "all-in-one-pcs",
        "description": "",
        "image_url": "https://www.techjunkie.com/wp-content/uploads/2013/09/20130924_2013imac.jpg",
        "parent_id": "cca00d97-3125-4dc3-9141-e6d459764b76",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "android_phones": {
        "id": "5cba5153-0772-450a-b8b7-8a4fa532ecc1",
        "label": "Android Phones",
        "slug": "android-phones",
        "description": "",
        "image_url": "https://mdsmobile.ae/cdn/shop/articles/Untitled_design_24_651a868c-2c1d-4113-9624-4cb0556d67d1.png?v=1708344936",
        "parent_id": "7b8b5bb4-7878-4203-a550-a0941e1e3eb9",
        "children": [],
        "attributes": [
            "vendor",
            "storage",
            "brand",
            "material",
            "price_tier",
            "color"
        ],
        "allowed_clauses": [
            "small_storage",
            "infinix_product",
            "microsoft_product",
            "leather",
            "affordable",
            "expensive",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 6,
        "total_count": 6
    },
    "android_tablets": {
        "id": "63173747-a5b2-4cdb-942c-032a122631ad",
        "label": "Android Tablets",
        "slug": "android-tablets",
        "description": "",
        "image_url": "https://media.s-bol.com/3mg7WJvQKJMM/1w3nyvP/550x408.jpg",
        "parent_id": "8eb82d64-fb66-4657-9add-14bc2b31c00e",
        "children": [],
        "attributes": [
            "vendor",
            "brand",
            "price_tier",
            "material",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive",
            "leather",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 3,
        "total_count": 3
    },
    "appliances": {
        "id": "c2d10e28-892f-4532-9d36-0e5d8868fbd0",
        "label": "Appliances",
        "slug": "appliances",
        "description": "Home Appliances",
        "image_url": "https://t3.ftcdn.net/jpg/03/29/32/18/360_F_329321873_tWphXnKQHwtZzj4xHUvFRsnaL6cEoLtX.jpg",
        "parent_id": null,
        "children": [
            "large_appliances",
            "power_solutions",
            "small_appliances"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "automobile": {
        "id": "03c12991-9fb9-45cb-820e-249e51c7eb19",
        "label": "Automobile",
        "slug": "automobile",
        "description": "",
        "image_url": null,
        "parent_id": null,
        "children": [
            "car_care",
            "car_electronics",
            "interior_accessories"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "baby_care": {
        "id": "cd4c4c77-2e4a-4978-9be1-9db0c10533bc",
        "label": "Baby Care",
        "slug": "baby-care",
        "description": "",
        "image_url": null,
        "parent_id": "100746ef-7dba-452b-9ddd-b0c782557c35",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "bed_&_bath": {
        "id": "fa3c8fd5-90ec-4d43-b1f6-c46bd5ebe66a",
        "label": "Bed & Bath",
        "slug": "bed-bath",
        "description": "",
        "image_url": null,
        "parent_id": "577c0281-bccb-4a16-9692-b73714c77299",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "bedroom_furniture": {
        "id": "fac7a592-ad43-4a64-ab17-29234e03e90f",
        "label": "Bedroom Furniture",
        "slug": "bedroom-furniture",
        "description": "",
        "image_url": null,
        "parent_id": "3aa527e0-a871-413f-b8ed-050e28c49da5",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "beverages": {
        "id": "cec978e0-5909-4e7f-940f-b4bf66062460",
        "label": "Beverages",
        "slug": "beverages",
        "description": "",
        "image_url": "https://media.istockphoto.com/id/1468173966/photo/cocktail-party-bright-fruity-and-citrus-alcoholic-drinks-with-gin-vodka-vermouth-and-juice.jpg?s=612x612&w=0&k=20&c=I3vNEqwuk4OzK0bdosqpmlowLb2MYlonHTbDwQvX1tk=",
        "parent_id": "9569c36b-343d-47b2-9aac-1f2046c82b0e",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 4,
        "total_count": 4
    },
    "blenders": {
        "id": "d661c954-861a-4496-85e1-14760610f367",
        "label": "Blenders",
        "slug": "blenders",
        "description": "",
        "image_url": "https://www.shutterstock.com/image-photo/electric-blender-standing-on-kitchen-600nw-2698751239.jpg",
        "parent_id": "06a03588-da4c-4121-83f5-227760c70cc9",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies"
        ],
        "product_count": 2,
        "total_count": 2
    },
    "boots": {
        "id": "765dd3f3-40e7-4b58-8fec-9a6d5f891386",
        "label": "Boots",
        "slug": "boots",
        "description": "",
        "image_url": null,
        "parent_id": "bfa02d36-7c1e-45f4-aa9a-8ea38ca689a8",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "bottoms_&_pants": {
        "id": "f998e18c-4dd1-4710-b9b5-049922965bf2",
        "label": "Bottoms & Pants",
        "slug": "bottoms-pants",
        "description": "",
        "image_url": null,
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "business_laptops": {
        "id": "4915517b-7943-4eb7-a79c-ce941177ddd6",
        "label": "Business Laptops",
        "slug": "business-laptops",
        "description": "",
        "image_url": "https://static3.webx.pk/files/35368/Images/dsc01549-35368-1024756-160625101447596.jpg",
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [],
        "attributes": [
            "vendor",
            "brand",
            "price_tier",
            "color"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cameras_&_photography": {
        "id": "a12f0075-3d04-49c6-aa0a-c3d2400f3bf5",
        "label": "Cameras & Photography",
        "slug": "cameras-photography",
        "description": "",
        "image_url": null,
        "parent_id": "2ff218a6-65e9-456e-878a-300f1217798f",
        "children": [
            "cctv",
            "drones"
        ],
        "attributes": [
            "vendor",
            "size",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "canned_&_packaged_foods": {
        "id": "6dff4ca6-0ec7-430f-8357-0e172e59230b",
        "label": "Canned & Packaged Foods",
        "slug": "canned-packaged-foods",
        "description": "",
        "image_url": "https://w0.peakpx.com/wallpaper/71/83/HD-wallpaper-food-shelf-pretty-item-scenic-object-cg-objects-box-sweet-nice-anime-package-scenery-realistic-lovely-food-items-shelf-cute-kawaii-3d-snack-scene.jpg",
        "parent_id": "9569c36b-343d-47b2-9aac-1f2046c82b0e",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "car_care": {
        "id": "c0adbb1d-2ae0-42e7-a079-3019f9d00951",
        "label": "Car Care",
        "slug": "car-care",
        "description": "",
        "image_url": null,
        "parent_id": "03c12991-9fb9-45cb-820e-249e51c7eb19",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "car_electronics": {
        "id": "65208cd3-9064-404c-ab7e-af9eda095f6b",
        "label": "Car Electronics",
        "slug": "car-electronics",
        "description": "",
        "image_url": null,
        "parent_id": "03c12991-9fb9-45cb-820e-249e51c7eb19",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cases_&_covers": {
        "id": "b83cefb6-9a66-4da2-92fd-800c5df4a171",
        "label": "Cases & Covers",
        "slug": "cases-covers",
        "description": "",
        "image_url": null,
        "parent_id": "c28c4ba9-8160-4905-84d4-dc8f30bd070f",
        "children": [],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cctv": {
        "id": "3782b6b7-61f8-4374-a8cc-aa49186dd3c6",
        "label": "CCTV",
        "slug": "cctv",
        "description": "",
        "image_url": null,
        "parent_id": "a12f0075-3d04-49c6-aa0a-c3d2400f3bf5",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "chargers_&_cables": {
        "id": "c4b78614-181d-47a3-9d15-08ccdf9eac30",
        "label": "Chargers & Cables",
        "slug": "chargers-cables",
        "description": "",
        "image_url": null,
        "parent_id": "c28c4ba9-8160-4905-84d4-dc8f30bd070f",
        "children": [],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cleaning_appliances": {
        "id": "b7219b73-d600-4802-9527-6fce07b65926",
        "label": "Cleaning Appliances",
        "slug": "cleaning-appliances",
        "description": "",
        "image_url": null,
        "parent_id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "clothing": {
        "id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "label": "clothing",
        "slug": "clothing",
        "description": "quality clothes for everyone",
        "image_url": "https://media.istockphoto.com/id/653003428/photo/fashionable-clothes-in-a-boutique-store-in-london.jpg?s=612x612&w=0&k=20&c=UafU4a4xSbepJow4kvNu0q-LD4hFUoli7q3fvwkp79s=",
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [
            "activewear",
            "bottoms_&_pants",
            "jackets_&_outerwear",
            "jersey",
            "shirts",
            "sleepwear_&_loungewear",
            "tops_&_t-shirts"
        ],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 5,
        "total_count": 11
    },
    "components": {
        "id": "d64b240e-3146-4386-a98a-418057f66614",
        "label": "Components",
        "slug": "components",
        "description": "",
        "image_url": "https://m.media-amazon.com/images/I/51TGATS1qdL._AC_UF350,350_QL80_.jpg",
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [
            "cooling_system",
            "graphics_card",
            "motherboards",
            "pc_cases_&_fans",
            "power_supplies_(psus)",
            "processors_(cpus)",
            "ram_&_storage"
        ],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "computing_accessories": {
        "id": "48aeb370-7623-4f17-85c3-ce12eb7d579e",
        "label": "Computing Accessories",
        "slug": "computing-accessories",
        "description": "",
        "image_url": null,
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "controller_&_game_pads": {
        "id": "4d33b22c-be78-4717-8a92-eb631165994a",
        "label": "Controller & Game Pads",
        "slug": "controller-game-pads",
        "description": "",
        "image_url": "https://www.bitro.de/wp-content/uploads/2025/06/real_controller_ps5_basic_new_TMR_hallsticks_scull_v3_paddle_grip_BLACK_swap_sticks.jpg",
        "parent_id": "49c8b316-57b1-44b2-a168-9cff68a03d4f",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cooking_appliances": {
        "id": "8a67f198-9da4-4ccd-a4da-c5b1208a58ea",
        "label": "Cooking Appliances",
        "slug": "cooking-appliances",
        "description": "",
        "image_url": null,
        "parent_id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cookware_sets": {
        "id": "b5f2919c-6bc4-4883-9940-b154af0e6773",
        "label": "Cookware Sets",
        "slug": "cookware-sets",
        "description": "",
        "image_url": "https://www.lecreuset.co.za/on/demandware.static/-/Sites-LeCreuset_SA-Library/default/dw773ada47/fff-colourful-cookware.jpg",
        "parent_id": "06a03588-da4c-4121-83f5-227760c70cc9",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "cooling": {
        "id": "35c76cbb-b3ba-4e0c-8c82-c71ac5bc8ded",
        "label": "Cooling",
        "slug": "cooling",
        "description": "",
        "image_url": null,
        "parent_id": "2380f970-7bbf-484f-a124-c314e78d0076",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "cooling_system": {
        "id": "349f5c65-17ea-4de0-ba85-6079bbca62ab",
        "label": "Cooling System",
        "slug": "cooling-system",
        "description": "",
        "image_url": "https://upload.wikimedia.org/wikipedia/commons/2/25/AMD_heatsink_and_fan.jpg",
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "data_storage": {
        "id": "fefb5e13-31a5-47fd-a859-2d9768188f11",
        "label": "Data Storage",
        "slug": "data-storage",
        "description": "",
        "image_url": null,
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "desktops": {
        "id": "cca00d97-3125-4dc3-9141-e6d459764b76",
        "label": "Desktops",
        "slug": "desktops",
        "description": "",
        "image_url": "https://notebooks.com/wp-content/uploads/2016/02/81fYv-T3h1L._SL1500_.jpg",
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [
            "all_in_one_pcs",
            "gaming_desktops",
            "workstations"
        ],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "dishwashing_supplies": {
        "id": "b926ec8d-03dd-48cf-873c-97c0bd75fcf4",
        "label": "Dishwashing Supplies",
        "slug": "dishwashing-supplies",
        "description": "",
        "image_url": null,
        "parent_id": "2887cda1-7435-4a60-aaa1-33ef26eff22b",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "drones": {
        "id": "cb8ee303-35b3-40d5-bc00-c3a16c708f1f",
        "label": "Drones",
        "slug": "drones",
        "description": "",
        "image_url": null,
        "parent_id": "a12f0075-3d04-49c6-aa0a-c3d2400f3bf5",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "e-readers": {
        "id": "523679ed-9096-424c-9e28-79661d8e3f9f",
        "label": "E-Readers",
        "slug": "e-readers",
        "description": "",
        "image_url": "https://platform.theverge.com/wp-content/uploads/sites/2/chorus/uploads/chorus_asset/file/25821061/247464_Kindle_Paperwhite_ALiszewski_0002.jpg?quality=90&strip=all&crop=0,0,100,100",
        "parent_id": "d8aed750-6164-4065-881c-652ef888179f",
        "children": [],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "educational_toys": {
        "id": "c06fb836-7950-44b6-a511-ffea5ad7595a",
        "label": "Educational Toys",
        "slug": "educational-toys",
        "description": "",
        "image_url": null,
        "parent_id": "100746ef-7dba-452b-9ddd-b0c782557c35",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "electronics": {
        "id": "2ff218a6-65e9-456e-878a-300f1217798f",
        "label": "Electronics",
        "slug": "electronics",
        "description": "a good category na",
        "image_url": "https://static.independent.co.uk/2025/08/27/16/02/Best-laptops-Indybest-review.png",
        "parent_id": "95bd9c7a-4c90-4d9e-950b-d27a12113c4b",
        "children": [
            "cameras_&_photography",
            "home_audio",
            "sound_gadget",
            "television_&_video"
        ],
        "attributes": [
            "vendor",
            "size",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 2,
        "total_count": 3
    },
    "fashion": {
        "id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "label": "Fashion",
        "slug": "fashion",
        "description": "Get all kinds of clothes and wears",
        "image_url": "https://burst.shopifycdn.com/photos/model-in-gold-fashion.jpg?width=1000&format=pjpg&exif=0&iptc=0",
        "parent_id": null,
        "children": [
            "accessories",
            "clothing",
            "footwear",
            "handbags",
            "handbags_&_bags",
            "jewellery",
            "watches_&_eyewear"
        ],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 38
    },
    "feature_phones": {
        "id": "045389eb-03ba-4466-bed3-3343870d547a",
        "label": "Feature Phones",
        "slug": "feature-phones",
        "description": "",
        "image_url": null,
        "parent_id": "d8aed750-6164-4065-881c-652ef888179f",
        "children": [],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "fitness_&_exercise": {
        "id": "353dfd7a-4445-4169-987d-45002fb6fc27",
        "label": "Fitness & Exercise",
        "slug": "fitness-exercise",
        "description": "",
        "image_url": null,
        "parent_id": "066f4171-55af-4577-9b7b-1ecf7368988f",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "flight_stick": {
        "id": "383d8882-9177-48ec-a21f-d560d1f5b6f5",
        "label": "Flight Stick",
        "slug": "flight-stick",
        "description": "",
        "image_url": "https://www.thrustmaster.com/wp-content/uploads/2021/09/UTH-t-flight-hotas-4-flight-sim-1-3.png",
        "parent_id": "49c8b316-57b1-44b2-a168-9cff68a03d4f",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "food": {
        "id": "9569c36b-343d-47b2-9aac-1f2046c82b0e",
        "label": "Food",
        "slug": "food",
        "description": "Food items",
        "image_url": "https://www.shengkee.com/cdn/shop/collections/IMG_1823_1_800x.jpg?v=1678816894",
        "parent_id": null,
        "children": [
            "beverages",
            "canned_&_packaged_foods",
            "snacks_&_confectionery"
        ],
        "attributes": [
            "vendor",
            "size",
            "color"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 10,
        "total_count": 19
    },
    "food_preparation": {
        "id": "fcd8b89f-0fac-4019-a8c2-8fd8fa23e277",
        "label": "Food Preparation",
        "slug": "food-preparation",
        "description": "",
        "image_url": null,
        "parent_id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "footwear": {
        "id": "cb51fbab-9386-46e6-a14a-210cce5ce24a",
        "label": "Footwear",
        "slug": "footwear",
        "description": "",
        "image_url": "https://hips.hearstapps.com/hmg-prod/images/singlemarket-indexcomp-1551214427.jpg?crop=1.00xw:1.00xh;0,0&resize=640:*",
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [
            "sandals_&_slippers",
            "shoes"
        ],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 11
    },
    "formal_&_dress_shoes": {
        "id": "d56e7819-9c38-4da7-a80f-a58f9d05f1f0",
        "label": "Formal & Dress Shoes",
        "slug": "formal-dress-shoes",
        "description": "",
        "image_url": null,
        "parent_id": "bfa02d36-7c1e-45f4-aa9a-8ea38ca689a8",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "fragrances": {
        "id": "be903ec4-4672-48b9-ba34-86a592402042",
        "label": "Fragrances",
        "slug": "fragrances",
        "description": "",
        "image_url": "https://wallpapers.com/images/hd/fragrance-1500-x-1000-wallpaper-d4zq5v3ise7eh1gr.jpg",
        "parent_id": "36071d35-6c9c-4fcb-ac5c-c543b938173b",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "furniture_&_organization": {
        "id": "3aa527e0-a871-413f-b8ed-050e28c49da5",
        "label": "Furniture & Organization",
        "slug": "furniture-organization",
        "description": "",
        "image_url": "https://cdn.mos.cms.futurecdn.net/7W2n5T4Wki9YVHUnprVUaM.jpg",
        "parent_id": null,
        "children": [
            "bedroom_furniture",
            "living_room_furniture",
            "office_furniture"
        ],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "gadgets": {
        "id": "95bd9c7a-4c90-4d9e-950b-d27a12113c4b",
        "label": "Gadgets",
        "slug": "gadgets",
        "description": "very good cat sha",
        "image_url": "https://www.ul.com/sites/default/files/styles/hero_boxed_width/public/2019-05/Image18_Quadcopter-drone_Caban_022819-Hero-1000x715.jpg?itok=6WSk4wNj",
        "parent_id": null,
        "children": [
            "electronics"
        ],
        "attributes": [
            "vendor",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 7,
        "total_count": 10
    },
    "game_consoles": {
        "id": "2c86882a-c069-47c3-bdb6-9af4849672bb",
        "label": "Game Consoles",
        "slug": "game-consoles",
        "description": "",
        "image_url": "https://media-cldnry.s-nbcnews.com/image/upload/t_fit-1500w,f_auto,q_auto:best/newscms/2021_03/3423237/201026-playstation5-xbox-2x1-tease-v2-ac-1120p.jpg",
        "parent_id": "63efd70e-2daf-46f9-b801-d9da53209930",
        "children": [
            "nintendo_switch",
            "playstation",
            "xbox"
        ],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 1
    },
    "gaming": {
        "id": "63efd70e-2daf-46f9-b801-d9da53209930",
        "label": "Gaming",
        "slug": "gaming",
        "description": "",
        "image_url": "https://eu.aimcontrollers.com/wp-content/uploads/2023/09/3-3.jpg",
        "parent_id": null,
        "children": [
            "game_consoles",
            "gaming_accessories",
            "gaming_chairs_&_furnitures",
            "vr_&_ar_headset"
        ],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 6,
        "total_count": 8
    },
    "gaming_accessories": {
        "id": "49c8b316-57b1-44b2-a168-9cff68a03d4f",
        "label": "Gaming Accessories",
        "slug": "gaming-accessories",
        "description": "",
        "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSM9glc8suo1_hEBhWqKZde0ajNeXiWaFmSXQ&s",
        "parent_id": "63efd70e-2daf-46f9-b801-d9da53209930",
        "children": [
            "controller_&_game_pads",
            "flight_stick",
            "racing_wheels"
        ],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "gaming_chairs_&_furnitures": {
        "id": "69170eef-e834-4803-97aa-69dd84c76ea6",
        "label": "Gaming Chairs & Furnitures",
        "slug": "gaming-chairs-furnitures",
        "description": "",
        "image_url": "https://d21d281c1yd2en.cloudfront.net/media/product_images/quality-gaming-relaxation-leather-chair_1.0.webp",
        "parent_id": "63efd70e-2daf-46f9-b801-d9da53209930",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "gaming_desktops": {
        "id": "c33ecdbd-9840-425d-9eae-f6fd00116d8d",
        "label": "Gaming Desktops",
        "slug": "gaming-desktops",
        "description": "",
        "image_url": "https://anphat.com.vn/media/lib/27-03-2024/danhmucpcgaming1.jpg",
        "parent_id": "cca00d97-3125-4dc3-9141-e6d459764b76",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "gaming_laptops": {
        "id": "2538245c-6b41-4a66-acf4-2af88fc2783b",
        "label": "Gaming Laptops",
        "slug": "gaming-laptops",
        "description": "",
        "image_url": "https://i.rtings.com/assets/pages/6dRuEBex/best-gaming-laptops-20242028-medium.jpg?format=auto",
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "graphics_card": {
        "id": "2ca7dc14-667b-4050-adbf-8ef3615ec1a9",
        "label": "Graphics Card",
        "slug": "graphics-card",
        "description": "",
        "image_url": "https://www.pcworld.com/wp-content/uploads/2024/01/best-graphics-cards-banner-100815257-orig.jpg?quality=50&strip=all&w=1024",
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "hair_care": {
        "id": "68a32693-6365-47ad-8505-6f119b8c8bae",
        "label": "Hair Care",
        "slug": "hair-care",
        "description": "",
        "image_url": "https://img.freepik.com/free-photo/combs-scissors-copy-space_23-2148352839.jpg?semt=ais_hybrid&w=740&q=80",
        "parent_id": "36071d35-6c9c-4fcb-ac5c-c543b938173b",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "handbags": {
        "id": "16b1db22-fd3e-4fa2-921b-517daa5da40d",
        "label": "Handbags",
        "slug": "handbags",
        "description": "Handbags of all kinds",
        "image_url": "https://wallpapers.com/images/hd/various-luxury-handbags-45zou3jvkev6xmgs.jpg",
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "handbags_&_bags": {
        "id": "90edb1eb-00a3-4c07-b2df-b13a86652baa",
        "label": "Handbags & Bags",
        "slug": "handbags-bags",
        "description": "",
        "image_url": null,
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "health_&_beauty": {
        "id": "36071d35-6c9c-4fcb-ac5c-c543b938173b",
        "label": "Health & Beauty",
        "slug": "health-beauty",
        "description": "",
        "image_url": "https://m.media-amazon.com/images/I/713F-y8GylL._AC_UF1000,1000_QL80_.jpg",
        "parent_id": null,
        "children": [
            "fragrances",
            "hair_care",
            "makeup",
            "personal_care"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 23
    },
    "home_audio": {
        "id": "7f24ccd0-1309-4bbe-a252-5bfc7e613d29",
        "label": "Home Audio",
        "slug": "home-audio",
        "description": "",
        "image_url": null,
        "parent_id": "2ff218a6-65e9-456e-878a-300f1217798f",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "home_decor": {
        "id": "577c0281-bccb-4a16-9692-b73714c77299",
        "label": "Home Decor",
        "slug": "home-decor",
        "description": "",
        "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSCFa3WkM-CRwBTHErXi8VIjttQoQv3zToAVw&s",
        "parent_id": null,
        "children": [
            "bed_&_bath",
            "lighting",
            "rugs_&_carpets",
            "wall_art"
        ],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 7,
        "total_count": 7
    },
    "household_cleaning": {
        "id": "2887cda1-7435-4a60-aaa1-33ef26eff22b",
        "label": "Household Cleaning",
        "slug": "household-cleaning",
        "description": "",
        "image_url": null,
        "parent_id": "f46b0f38-9c96-4a42-b0e7-9921d8dfaaef",
        "children": [
            "dishwashing_supplies",
            "laundry_detergents",
            "surface_&_floor_cleaners"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "interior_accessories": {
        "id": "b94fd43a-58e0-4c6b-91ce-7017b9292f15",
        "label": "Interior Accessories",
        "slug": "interior-accessories",
        "description": "",
        "image_url": null,
        "parent_id": "03c12991-9fb9-45cb-820e-249e51c7eb19",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "ipad": {
        "id": "62327f48-39a3-49b8-8182-295b87342a21",
        "label": "Ipad",
        "slug": "ipad",
        "description": "",
        "image_url": "https://i0.wp.com/thedisconnekt.com/wp-content/uploads/2024/03/Apple-iPad-10.jpg?resize=1600%2C1067&ssl=1",
        "parent_id": "8eb82d64-fb66-4657-9add-14bc2b31c00e",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "iphones": {
        "id": "9407551c-0204-4ffb-a054-1709177ebafc",
        "label": "Iphones",
        "slug": "iphones",
        "description": "Good and luxurious phones",
        "image_url": "https://m-cdn.phonearena.com/images/hub/550-wide-two_1200/iPhone-17-Pro-Max-release-date-price-and-features.jpg",
        "parent_id": "7b8b5bb4-7878-4203-a550-a0941e1e3eb9",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "material",
            "storage",
            "size",
            "price_tier",
            "brand"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "neutrals",
            "leather",
            "small_storage",
            "xl",
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product"
        ],
        "product_count": 6,
        "total_count": 6
    },
    "irons_&_steamers": {
        "id": "b0ac7ac4-5dbc-466f-9f17-b1741c73f057",
        "label": "Irons & Steamers",
        "slug": "irons-steamers",
        "description": "",
        "image_url": null,
        "parent_id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "jackets_&_outerwear": {
        "id": "ea3e2db4-5e9b-414d-9b0e-c8564d8f41f5",
        "label": "Jackets & Outerwear",
        "slug": "jackets-outerwear",
        "description": "",
        "image_url": null,
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "jersey": {
        "id": "64b148b4-6a9c-4e2a-82c8-1b54f43a0445",
        "label": "Jersey",
        "slug": "jersey",
        "description": "jerseys of all kinds",
        "image_url": "https://i.etsystatic.com/11813826/r/il/186a29/6689856418/il_fullxfull.6689856418_n4oj.jpg",
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 2,
        "total_count": 2
    },
    "jewellery": {
        "id": "b23501dc-60f2-4651-9ce6-e00e2647466a",
        "label": "Jewellery",
        "slug": "jewellery",
        "description": "Jewellery of all kinds",
        "image_url": "https://imgs.search.brave.com/m_ViX2OWSS9Yf85aZDfnkAqcRa-A40IG8ZaBf48POv8/rs:fit:860:0:0:0/g:ce/aHR0cHM6Ly93YWxs/cGFwZXJjYXQuY29t/L3cvZnVsbC84L2Ev/ZC84MDY3NjQtMTky/MHgxMDgwLWRlc2t0/b3AtMTA4MHAtamV3/ZWxyeS1iYWNrZ3Jv/dW5kLXBob3RvLmpw/Zw",
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 6,
        "total_count": 6
    },
    "kitchen": {
        "id": "06a03588-da4c-4121-83f5-227760c70cc9",
        "label": "Kitchen",
        "slug": "kitchen",
        "description": "",
        "image_url": "https://cdn.magicdecor.in/com/2023/11/15141824/Wooden-Spoons-and-Spices-Wallpaper-for-Restaurants-Kitchens-M.jpg",
        "parent_id": null,
        "children": [
            "blenders",
            "cookware_sets",
            "kitchen_appliances"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies"
        ],
        "product_count": 0,
        "total_count": 12
    },
    "kitchen_appliances": {
        "id": "3e5781a6-5500-476f-8612-bdd1c2eeeb27",
        "label": "Kitchen Appliances",
        "slug": "kitchen-appliances",
        "description": "Everything kitchen related",
        "image_url": "https://majesticchef.pk/cdn/shop/files/GlSet.jpg",
        "parent_id": "06a03588-da4c-4121-83f5-227760c70cc9",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "quality",
            "material",
            "size"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "neutrals",
            "high_quality",
            "leather",
            "xl"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "laptops_&_computers": {
        "id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "label": "Laptops & Computers",
        "slug": "laptops-computers",
        "description": "",
        "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT4rNMJb0G_OKctjvN-6ey-EDBu5j2aPosARQ&s",
        "parent_id": null,
        "children": [
            "business_laptops",
            "components",
            "computing_accessories",
            "data_storage",
            "desktops",
            "gaming_laptops",
            "printers_&_scanners",
            "ultrabooks"
        ],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 6,
        "total_count": 7
    },
    "large_appliances": {
        "id": "2380f970-7bbf-484f-a124-c314e78d0076",
        "label": "Large Appliances",
        "slug": "large-appliances",
        "description": "",
        "image_url": null,
        "parent_id": "c2d10e28-892f-4532-9d36-0e5d8868fbd0",
        "children": [
            "air_conditioners",
            "cooling",
            "laundry",
            "refrigerators_&_freezers",
            "washing_machines_&_dryers"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "laundry": {
        "id": "0262de8b-206f-4cba-8109-4446b7d5df5d",
        "label": "Laundry",
        "slug": "laundry",
        "description": "",
        "image_url": null,
        "parent_id": "2380f970-7bbf-484f-a124-c314e78d0076",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "laundry_detergents": {
        "id": "0cfa27ee-d66b-4c94-93b2-6c70ad28cafa",
        "label": "Laundry Detergents",
        "slug": "laundry-detergents",
        "description": "",
        "image_url": null,
        "parent_id": "2887cda1-7435-4a60-aaa1-33ef26eff22b",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "lighting": {
        "id": "ac332f55-4f39-4163-9be0-8807bab27db8",
        "label": "Lighting",
        "slug": "lighting",
        "description": "",
        "image_url": null,
        "parent_id": "577c0281-bccb-4a16-9692-b73714c77299",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "living_room_furniture": {
        "id": "11cc7579-0306-46d3-a218-1b0e1deedeb6",
        "label": "Living Room Furniture",
        "slug": "living-room-furniture",
        "description": "",
        "image_url": null,
        "parent_id": "3aa527e0-a871-413f-b8ed-050e28c49da5",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "makeup": {
        "id": "f774f528-abb6-43b7-924d-11d7bb4d0217",
        "label": "Makeup",
        "slug": "makeup",
        "description": "",
        "image_url": "https://png.pngtree.com/thumb_back/fw800/background/20251229/pngtree-makeup-brushes-and-cosmetic-bag-on-pink-background-image_20723638.webp",
        "parent_id": "36071d35-6c9c-4fcb-ac5c-c543b938173b",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "microwaves": {
        "id": "0dea8ad5-d898-4445-a78b-58421b87d6a4",
        "label": "Microwaves",
        "slug": "microwaves",
        "description": "",
        "image_url": null,
        "parent_id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "motherboards": {
        "id": "5248d15a-8a00-4bae-9104-dc1ee81b3584",
        "label": "Motherboards",
        "slug": "motherboards",
        "description": "",
        "image_url": null,
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men",
            "affordable",
            "apple_product"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "nintendo_switch": {
        "id": "d3ef8b79-d7a8-4925-9f94-677a74e400e5",
        "label": "Nintendo Switch",
        "slug": "nintendo-switch",
        "description": "",
        "image_url": "https://cdn.mos.cms.futurecdn.net/XyAaqBEtYtb8YffjKZ68Gb.jpg",
        "parent_id": "2c86882a-c069-47c3-bdb6-9af4849672bb",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "office_furniture": {
        "id": "3dc4380f-19be-4edf-8b13-c8e74f40c16d",
        "label": "Office Furniture",
        "slug": "office-furniture",
        "description": "",
        "image_url": null,
        "parent_id": "3aa527e0-a871-413f-b8ed-050e28c49da5",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "outdoor_sports": {
        "id": "1c415305-1d12-4ae0-b1fc-e98b1491f704",
        "label": "Outdoor Sports",
        "slug": "outdoor-sports",
        "description": "",
        "image_url": null,
        "parent_id": "066f4171-55af-4577-9b7b-1ecf7368988f",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "paper_&_plastic_products": {
        "id": "9c5bf999-e495-4730-bf2d-32511f644fca",
        "label": "Paper & Plastic Products",
        "slug": "paper-plastic-products",
        "description": "",
        "image_url": null,
        "parent_id": "f46b0f38-9c96-4a42-b0e7-9921d8dfaaef",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "pc_cases_&_fans": {
        "id": "74849414-8e11-4e22-b5a6-cf1110eedda8",
        "label": "PC Cases & Fans",
        "slug": "pc-cases-fans",
        "description": "",
        "image_url": null,
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men",
            "affordable",
            "apple_product"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "personal_care": {
        "id": "c9dca9ef-48e4-4c15-9601-f09fbd19a6c5",
        "label": "Personal Care",
        "slug": "personal-care",
        "description": "",
        "image_url": "https://images.everydayhealth.com/images/healthy-living/health-benefits-of-taking-a-bath-plus-healthy-add-ins-for-your-next-soak-1440x810.jpg?sfvrsn=fabc5394_5",
        "parent_id": "36071d35-6c9c-4fcb-ac5c-c543b938173b",
        "children": [
            "skin_care"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 3,
        "total_count": 8
    },
    "pet_supplies": {
        "id": "0fb7a563-5be7-4ec0-a168-bc6d545380dc",
        "label": "Pet Supplies",
        "slug": "pet-supplies",
        "description": "",
        "image_url": null,
        "parent_id": "f46b0f38-9c96-4a42-b0e7-9921d8dfaaef",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "phone_accessories": {
        "id": "c28c4ba9-8160-4905-84d4-dc8f30bd070f",
        "label": "Phone Accessories",
        "slug": "phone-accessories",
        "description": "",
        "image_url": "https://i.ytimg.com/vi/xq7Z5fXpKL8/hq720.jpg?sqp=-oaymwEhCK4FEIIDSFryq4qpAxMIARUAAAAAGAElAADIQj0AgKJD&rs=AOn4CLBG994a2YhKIUsCAqBy9oGKQxCUPw",
        "parent_id": "d8aed750-6164-4065-881c-652ef888179f",
        "children": [
            "cases_&_covers",
            "chargers_&_cables",
            "power_banks",
            "wearable_tech"
        ],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "playstation": {
        "id": "51a55403-8aa7-43fb-a479-12c3b7a91fae",
        "label": "Playstation",
        "slug": "playstation",
        "description": "",
        "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTspaS76A2qfsXK2Lf0WdEpZgfp-lEU_AHf7w&s",
        "parent_id": "2c86882a-c069-47c3-bdb6-9af4849672bb",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "power_banks": {
        "id": "fb91d756-eaaa-4cfa-85e8-3218511afff4",
        "label": "Power Banks",
        "slug": "power-banks",
        "description": "",
        "image_url": null,
        "parent_id": "c28c4ba9-8160-4905-84d4-dc8f30bd070f",
        "children": [],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "power_solutions": {
        "id": "42cecc95-569b-4a33-83c6-ed10ae92cc6a",
        "label": "Power Solutions",
        "slug": "power-solutions",
        "description": "",
        "image_url": null,
        "parent_id": "c2d10e28-892f-4532-9d36-0e5d8868fbd0",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "power_supplies_(psus)": {
        "id": "209235d5-9cd8-44f4-bfc3-321cf3aa0425",
        "label": "Power Supplies (PSUs)",
        "slug": "power-supplies-psus-",
        "description": "",
        "image_url": null,
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men",
            "affordable",
            "apple_product"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "printers_&_scanners": {
        "id": "35ce6407-3cc4-4c33-b6ae-ce9214209fd0",
        "label": "Printers & Scanners",
        "slug": "printers-scanners",
        "description": "",
        "image_url": null,
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "processors_(cpus)": {
        "id": "2ee4decd-fba7-43eb-be25-63bf81cbf590",
        "label": "Processors (CPUs)",
        "slug": "processors-cpus-",
        "description": "",
        "image_url": null,
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men",
            "affordable",
            "apple_product"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "racing_wheels": {
        "id": "eacde19a-fec2-4cab-a19a-57e22c89f0cf",
        "label": "Racing Wheels",
        "slug": "racing-wheels",
        "description": "",
        "image_url": "https://gamebroslb.com/cdn/shop/products/222_a62969ad-c249-4d3d-bc11-2bd8153f515e.jpg?v=1660421244&width=1445",
        "parent_id": "49c8b316-57b1-44b2-a168-9cff68a03d4f",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "ram_&_storage": {
        "id": "3e010193-84c6-4a1b-8e8d-77f63fdec648",
        "label": "RAM & Storage",
        "slug": "ram-storage",
        "description": "",
        "image_url": "https://www.seagate.com/content/dam/seagate/assets/products/external-hard-drives/one-touch-external-drives/images/one-touch-external-drives-row4-image.png/_jcr_content/renditions/16-10-large-1440x900.png",
        "parent_id": "d64b240e-3146-4386-a98a-418057f66614",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "expensive",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "refrigerators_&_freezers": {
        "id": "3088cd7c-73c0-496b-aebd-bb9276eb4a3a",
        "label": "Refrigerators & Freezers",
        "slug": "refrigerators-freezers",
        "description": "",
        "image_url": null,
        "parent_id": "2380f970-7bbf-484f-a124-c314e78d0076",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "rugs_&_carpets": {
        "id": "c6f5b180-e074-4476-824a-de4ce3f1ff14",
        "label": "Rugs & Carpets",
        "slug": "rugs-carpets",
        "description": "",
        "image_url": null,
        "parent_id": "577c0281-bccb-4a16-9692-b73714c77299",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "sandals_&_slippers": {
        "id": "5dbd4dfe-3681-444d-b8a8-4f5b36e9d007",
        "label": "Sandals & Slippers",
        "slug": "sandals-slippers",
        "description": "",
        "image_url": "https://img.freepik.com/free-photo/flip-flops-wooden-blue-background_1101-1051.jpg?semt=ais_hybrid&w=740&q=80",
        "parent_id": "cb51fbab-9386-46e6-a14a-210cce5ce24a",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "shirts": {
        "id": "a0a28520-d394-48ae-8cfb-4411171fe227",
        "label": "Shirts",
        "slug": "shirts",
        "description": "Shirts of all kinds",
        "image_url": "https://static.vecteezy.com/system/resources/thumbnails/051/935/463/small/yellow-t-shirt-hanging-on-a-rack-with-other-colored-shirts-in-a-store-free-photo.jpeg",
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [
            "tshirts"
        ],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 3
    },
    "shoes": {
        "id": "bfa02d36-7c1e-45f4-aa9a-8ea38ca689a8",
        "label": "Shoes",
        "slug": "shoes",
        "description": "Quality footwear for everyone",
        "image_url": "https://static0.therichestimages.com/wordpress/wp-content/uploads/2021/07/Some-Of-The-Most-Expensive-Shoes-Ever-Sold.jpg?w=1600&h=1200&fit=crop",
        "parent_id": "cb51fbab-9386-46e6-a14a-210cce5ce24a",
        "children": [
            "boots",
            "formal_&_dress_shoes",
            "sneakers_&_athletic"
        ],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 6,
        "total_count": 6
    },
    "skin_care": {
        "id": "da3ab8a2-6c3d-4b83-8d12-65726d442eaa",
        "label": "Skin Care",
        "slug": "skin-care",
        "description": "",
        "image_url": "https://www.ualberta.ca/en/youalberta/media-library/2023/03/skincare.jpg",
        "parent_id": "c9dca9ef-48e4-4c15-9601-f09fbd19a6c5",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 5,
        "total_count": 5
    },
    "sleepwear_&_loungewear": {
        "id": "9d0b9255-48e2-4090-a388-fa04f4133a67",
        "label": "Sleepwear & Loungewear",
        "slug": "sleepwear-loungewear",
        "description": "",
        "image_url": null,
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "gender",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "neutrals",
            "male",
            "female",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 1,
        "total_count": 1
    },
    "small_appliances": {
        "id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "label": "Small Appliances",
        "slug": "small-appliances",
        "description": "",
        "image_url": null,
        "parent_id": "c2d10e28-892f-4532-9d36-0e5d8868fbd0",
        "children": [
            "cleaning_appliances",
            "cooking_appliances",
            "food_preparation",
            "irons_&_steamers",
            "microwaves",
            "vacuum_cleaners"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "smartphones": {
        "id": "7b8b5bb4-7878-4203-a550-a0941e1e3eb9",
        "label": "Smartphones",
        "slug": "smartphones",
        "description": "",
        "image_url": "https://m-cdn.phonearena.com/images/hubs/4954-image/BK6A9199-2.webp",
        "parent_id": "d8aed750-6164-4065-881c-652ef888179f",
        "children": [
            "android_phones",
            "iphones"
        ],
        "attributes": [
            "vendor",
            "material",
            "price_tier",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 12
    },
    "smartphones_&_tablets": {
        "id": "d8aed750-6164-4065-881c-652ef888179f",
        "label": "Smartphones & Tablets",
        "slug": "smartphones-tablets",
        "description": "",
        "image_url": "https://images.macrumors.com/article-new/2013/09/pink-10th-generation-ipad.jpg",
        "parent_id": null,
        "children": [
            "e-readers",
            "feature_phones",
            "phone_accessories",
            "smartphones",
            "tablets"
        ],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 6,
        "total_count": 21
    },
    "snacks_&_confectionery": {
        "id": "a62475cb-87ad-49d6-a005-8b9c5331e631",
        "label": "Snacks & Confectionery",
        "slug": "snacks-confectionery",
        "description": "",
        "image_url": null,
        "parent_id": "9569c36b-343d-47b2-9aac-1f2046c82b0e",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "sneakers_&_athletic": {
        "id": "5afbb422-1807-43a9-b499-171f426bc1d9",
        "label": "Sneakers & Athletic",
        "slug": "sneakers-athletic",
        "description": "",
        "image_url": null,
        "parent_id": "bfa02d36-7c1e-45f4-aa9a-8ea38ca689a8",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "sound_gadget": {
        "id": "95bdfdb6-47ee-4faf-8f92-d3887ad4cf6b",
        "label": "Sound Gadget",
        "slug": "sound-gadget",
        "description": "Headphones and quality airpods",
        "image_url": "https://media-ik.croma.com/prod/https://media.tatacroma.com/Croma%20Assets/Entertainment/Headphones%20and%20Earphones/Images/308673_jxaozj.png",
        "parent_id": "2ff218a6-65e9-456e-878a-300f1217798f",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "material",
            "storage",
            "size"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "neutrals",
            "leather",
            "xl"
        ],
        "product_count": 1,
        "total_count": 1
    },
    "sporting_goods": {
        "id": "066f4171-55af-4577-9b7b-1ecf7368988f",
        "label": "Sporting Goods",
        "slug": "sporting-goods",
        "description": "",
        "image_url": null,
        "parent_id": null,
        "children": [
            "fitness_&_exercise",
            "outdoor_sports",
            "team_sports"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "supermarket_essentials": {
        "id": "f46b0f38-9c96-4a42-b0e7-9921d8dfaaef",
        "label": "Supermarket Essentials",
        "slug": "supermarket-essentials",
        "description": "",
        "image_url": null,
        "parent_id": null,
        "children": [
            "household_cleaning",
            "paper_&_plastic_products",
            "pet_supplies"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "surface_&_floor_cleaners": {
        "id": "554ea406-6537-4c24-ac14-dfdf4928104e",
        "label": "Surface & Floor Cleaners",
        "slug": "surface-floor-cleaners",
        "description": "",
        "image_url": null,
        "parent_id": "2887cda1-7435-4a60-aaa1-33ef26eff22b",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "tablets": {
        "id": "8eb82d64-fb66-4657-9add-14bc2b31c00e",
        "label": "Tablets",
        "slug": "tablets",
        "description": "",
        "image_url": "https://images.macrumors.com/t/mWJ9VDcO5ei93XTdd_eFrG2C6W8=/800x0/smart/article-new/2013/09/ipad-mini-7-colors.jpg?lossy",
        "parent_id": "d8aed750-6164-4065-881c-652ef888179f",
        "children": [
            "android_tablets",
            "ipad",
            "windows_tablets"
        ],
        "attributes": [
            "vendor",
            "price_tier",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 3
    },
    "team_sports": {
        "id": "3141e80d-2a4c-42ea-a010-2397f76bcf3c",
        "label": "Team Sports",
        "slug": "team-sports",
        "description": "",
        "image_url": null,
        "parent_id": "066f4171-55af-4577-9b7b-1ecf7368988f",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "television_&_video": {
        "id": "6b48db63-3ff7-4f5a-bf5b-f651a0d45a52",
        "label": "Television & Video",
        "slug": "television-video",
        "description": "",
        "image_url": null,
        "parent_id": "2ff218a6-65e9-456e-878a-300f1217798f",
        "children": [],
        "attributes": [
            "vendor",
            "size",
            "color",
            "material",
            "storage"
        ],
        "allowed_clauses": [
            "xl",
            "color_for_ladies",
            "color_for_men",
            "leather",
            "small_storage"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "tops_&_t-shirts": {
        "id": "a1d9b795-960e-49aa-b069-3fdecba567e8",
        "label": "Tops & T-Shirts",
        "slug": "tops-t-shirts",
        "description": "",
        "image_url": null,
        "parent_id": "7a8f8f3e-1221-4409-a223-e3b09b3f8f1b",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "toys,_kids_&_babies": {
        "id": "100746ef-7dba-452b-9ddd-b0c782557c35",
        "label": "Toys, Kids & Babies",
        "slug": "toys-kids-babies",
        "description": "",
        "image_url": null,
        "parent_id": null,
        "children": [
            "action_figures_&_collectibles",
            "baby_care",
            "educational_toys"
        ],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "tshirts": {
        "id": "e4fe9700-854f-4e2d-a643-5d80c66c1b72",
        "label": "TShirts",
        "slug": "tshirts",
        "description": "shirts for men",
        "image_url": "https://img.freepik.com/premium-photo/tshirt-hanging-rainbowcolored-brick-wall_644450-16710.jpg?semt=ais_incoming&w=740&q=80",
        "parent_id": "a0a28520-d394-48ae-8cfb-4411171fe227",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 3,
        "total_count": 3
    },
    "ultrabooks": {
        "id": "8bc87612-cc22-41c4-9800-b616c787056d",
        "label": "ultrabooks",
        "slug": "ultrabooks",
        "description": "",
        "image_url": "https://laptopsking.com/cdn/shop/files/Untitleddesign_20.png?v=1706878592",
        "parent_id": "dfa80cc4-f95a-4c87-949b-8b0438b28949",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "neutrals",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 1,
        "total_count": 1
    },
    "vacuum_cleaners": {
        "id": "c58878d7-37b9-44e7-849e-1e34ba9c5060",
        "label": "Vacuum Cleaners",
        "slug": "vacuum-cleaners",
        "description": "",
        "image_url": null,
        "parent_id": "fd925a14-6d8a-43c9-a67e-4d20582016ba",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "vr_&_ar_headset": {
        "id": "efb14888-9617-44c4-9081-aa22d1cf1ed3",
        "label": "VR & AR Headset",
        "slug": "vr-ar-headset",
        "description": "",
        "image_url": "https://production-static.mobilesyrup.com/uploads/2023/06/Vision-pro-header3-scaled.jpg",
        "parent_id": "63efd70e-2daf-46f9-b801-d9da53209930",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 1,
        "total_count": 1
    },
    "wall_art": {
        "id": "d2782899-5809-4cbd-b5c7-1d8f038b88f9",
        "label": "Wall Art",
        "slug": "wall-art",
        "description": "",
        "image_url": null,
        "parent_id": "577c0281-bccb-4a16-9692-b73714c77299",
        "children": [],
        "attributes": [
            "vendor"
        ],
        "allowed_clauses": [],
        "product_count": 0,
        "total_count": 0
    },
    "washing_machines_&_dryers": {
        "id": "855cf784-3501-4238-b398-1309b24b68a9",
        "label": "Washing Machines & Dryers",
        "slug": "washing-machines-dryers",
        "description": "",
        "image_url": null,
        "parent_id": "2380f970-7bbf-484f-a124-c314e78d0076",
        "children": [],
        "attributes": [
            "vendor",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "watches_&_eyewear": {
        "id": "c8519e0a-41ad-44b2-b30c-a58f7ab529e6",
        "label": "Watches & Eyewear",
        "slug": "watches-eyewear",
        "description": "",
        "image_url": null,
        "parent_id": "5f0a09a7-7f88-4d9f-a6d9-a18311b3387e",
        "children": [],
        "attributes": [
            "vendor",
            "gender",
            "color",
            "quality",
            "material",
            "brand",
            "size"
        ],
        "allowed_clauses": [
            "male",
            "female",
            "neutrals",
            "high_quality",
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "xl"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "wearable_tech": {
        "id": "ba1e63bf-63b1-4589-83ac-2482ec79c37a",
        "label": "Wearable Tech",
        "slug": "wearable-tech",
        "description": "",
        "image_url": null,
        "parent_id": "c28c4ba9-8160-4905-84d4-dc8f30bd070f",
        "children": [],
        "attributes": [
            "vendor",
            "material",
            "brand",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "leather",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "windows_tablets": {
        "id": "0534dfd3-7f1b-47bb-8891-c0bf6033425e",
        "label": "Windows Tablets",
        "slug": "windows-tablets",
        "description": "",
        "image_url": "https://sm.pcmag.com/pcmag_uk/photo/m/microsoft-/microsoft-surface-pro-2024_4tey.jpg",
        "parent_id": "8eb82d64-fb66-4657-9add-14bc2b31c00e",
        "children": [],
        "attributes": [
            "vendor",
            "brand",
            "price_tier",
            "material",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive",
            "leather",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "workstations": {
        "id": "8a65f0f3-a543-480a-acb3-64c502ab38cd",
        "label": "Workstations",
        "slug": "workstations",
        "description": "",
        "image_url": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQiMiUifp6R_aGJgepxIE5BkyDhQUktcxd6BQ&s",
        "parent_id": "cca00d97-3125-4dc3-9141-e6d459764b76",
        "children": [],
        "attributes": [
            "vendor",
            "price_tier",
            "brand",
            "color"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 0,
        "total_count": 0
    },
    "xbox": {
        "id": "1ea00631-9dba-468e-92b2-a48dd3ed6f77",
        "label": "Xbox",
        "slug": "xbox",
        "description": "",
        "image_url": "https://xboxwire.thesourcemediaassets.com/sites/2/2024/06/Consoles-eb36182249206cefa827.jpg",
        "parent_id": "2c86882a-c069-47c3-bdb6-9af4849672bb",
        "children": [],
        "attributes": [
            "vendor",
            "color",
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men",
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 1,
        "total_count": 1
    }
};

const ATTRIBUTES = {
    "gender": {
        "id": "90016e0f-dff9-49f5-92c6-e9b2775200be",
        "code": "gender",
        "label": "Gender",
        "type": "select",
        "predefined_values": [
            {
                "label": "MALE",
                "value": "male"
            },
            {
                "label": "FEMALE",
                "value": "female"
            }
        ],
        "clauses": [
            {
                "name": "m",
                "label": "male",
                "matches": [
                    "male"
                ],
                "operator": "=",
                "prefix": "Men's",
                "suffix": ""
            },
            {
                "name": "f",
                "label": "female",
                "matches": [
                    "female"
                ],
                "operator": "=",
                "prefix": "Women's",
                "suffix": ""
            }
        ],
        "categories": [
            "fashion",
            "handbags",
            "accessories",
            "activewear",
            "boots",
            "bottoms_&_pants",
            "clothing",
            "footwear",
            "formal_&_dress_shoes",
            "handbags_&_bags",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "sleepwear_&_loungewear",
            "sneakers_&_athletic",
            "tops_&_t-shirts",
            "tshirts",
            "watches_&_eyewear"
        ]
    },
    "material": {
        "id": "9925207b-ca88-4be2-bee7-cd402c9ee98f",
        "code": "m",
        "label": "material",
        "type": "text",
        "predefined_values": [],
        "clauses": [
            {
                "name": "l",
                "label": "leather",
                "matches": [
                    "leather"
                ],
                "operator": "=",
                "prefix": "leather",
                "suffix": ""
            }
        ],
        "categories": [
            "iphones",
            "sound_gadget",
            "smartphones_&_tablets",
            "gadgets",
            "smartphones",
            "fashion",
            "kitchen_appliances",
            "accessories",
            "activewear",
            "android_phones",
            "android_tablets",
            "boots",
            "bottoms_&_pants",
            "cameras_&_photography",
            "cases_&_covers",
            "cctv",
            "chargers_&_cables",
            "clothing",
            "drones",
            "e-readers",
            "electronics",
            "feature_phones",
            "footwear",
            "formal_&_dress_shoes",
            "handbags",
            "handbags_&_bags",
            "home_audio",
            "ipad",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "phone_accessories",
            "power_banks",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "sleepwear_&_loungewear",
            "sneakers_&_athletic",
            "tablets",
            "television_&_video",
            "tops_&_t-shirts",
            "tshirts",
            "watches_&_eyewear",
            "wearable_tech",
            "windows_tablets"
        ]
    },
    "price_tier": {
        "id": "7b125323-a6eb-47a5-9c5d-3fd98ca31dca",
        "code": "p",
        "label": "price tier",
        "type": "select",
        "predefined_values": [
            {
                "label": "budget",
                "value": "budget"
            },
            {
                "label": "midrange",
                "value": "midrange"
            },
            {
                "label": "premium",
                "value": "premium"
            },
            {
                "label": "flagship",
                "value": "flagship"
            }
        ],
        "clauses": [
            {
                "name": "p",
                "label": "affordable",
                "matches": [
                    "budget",
                    "midrange"
                ],
                "operator": "LIKE",
                "prefix": "cheap",
                "suffix": ""
            },
            {
                "name": "e",
                "label": "expensive",
                "matches": [
                    "premium",
                    "flagship"
                ],
                "operator": "LIKE",
                "prefix": "High End",
                "suffix": ""
            }
        ],
        "categories": [
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "tablets",
            "desktops",
            "smartphones",
            "laptops_&_computers",
            "ultrabooks",
            "gaming",
            "all_in_one_pcs",
            "android_phones",
            "android_tablets",
            "business_laptops",
            "computing_accessories",
            "controller_&_game_pads",
            "data_storage",
            "flight_stick",
            "game_consoles",
            "gaming_accessories",
            "gaming_chairs_&_furnitures",
            "gaming_desktops",
            "gaming_laptops",
            "ipad",
            "iphones",
            "motherboards",
            "nintendo_switch",
            "pc_cases_&_fans",
            "playstation",
            "power_supplies_(psus)",
            "printers_&_scanners",
            "processors_(cpus)",
            "racing_wheels",
            "vr_&_ar_headset",
            "windows_tablets",
            "workstations",
            "xbox"
        ]
    },
    "quality": {
        "id": "4d7af189-7f57-405a-8cc3-d9e87eadacdc",
        "code": "q",
        "label": "quality",
        "type": "text",
        "predefined_values": [],
        "clauses": [
            {
                "name": "t",
                "label": "High quality",
                "matches": [
                    "Grade A"
                ],
                "operator": "=",
                "prefix": "High quality",
                "suffix": ""
            }
        ],
        "categories": [
            "fashion",
            "kitchen_appliances",
            "accessories",
            "activewear",
            "boots",
            "bottoms_&_pants",
            "clothing",
            "footwear",
            "formal_&_dress_shoes",
            "handbags",
            "handbags_&_bags",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "sleepwear_&_loungewear",
            "sneakers_&_athletic",
            "tops_&_t-shirts",
            "tshirts",
            "watches_&_eyewear"
        ]
    },
    "brand": {
        "id": "2eaf76d8-8872-46f3-8f96-e56e36b9a32c",
        "code": "b",
        "label": "brand",
        "type": "select",
        "predefined_values": [
            {
                "label": "Apple",
                "value": "apple"
            },
            {
                "label": "Samsung",
                "value": "samsung"
            },
            {
                "label": "Dell",
                "value": "dell"
            },
            {
                "label": "Lenovo",
                "value": "lenovo"
            },
            {
                "label": "HP",
                "value": "hp"
            },
            {
                "label": "Infinix",
                "value": "infinix"
            },
            {
                "label": "Microsoft",
                "value": "microsoft"
            },
            {
                "label": "Tecno",
                "value": "tecno"
            },
            {
                "label": "Itel",
                "value": "itel"
            }
        ],
        "clauses": [
            {
                "name": "a",
                "label": "apple product",
                "matches": [
                    "apple"
                ],
                "operator": "LIKE",
                "prefix": "",
                "suffix": "by apple"
            },
            {
                "name": "i",
                "label": "infinix product",
                "matches": [
                    "infinix"
                ],
                "operator": "LIKE",
                "prefix": "",
                "suffix": "by infinix"
            },
            {
                "name": "m",
                "label": "Microsoft product",
                "matches": [
                    "microsoft"
                ],
                "operator": "LIKE",
                "prefix": "Microsoft",
                "suffix": ""
            }
        ],
        "categories": [
            "components",
            "cooling_system",
            "graphics_card",
            "ram_&_storage",
            "smartphones_&_tablets",
            "business_laptops",
            "fashion",
            "laptops_&_computers",
            "ultrabooks",
            "gaming",
            "android_phones",
            "android_tablets",
            "windows_tablets",
            "accessories",
            "activewear",
            "all_in_one_pcs",
            "boots",
            "bottoms_&_pants",
            "cases_&_covers",
            "chargers_&_cables",
            "clothing",
            "computing_accessories",
            "controller_&_game_pads",
            "data_storage",
            "desktops",
            "e-readers",
            "feature_phones",
            "flight_stick",
            "footwear",
            "formal_&_dress_shoes",
            "game_consoles",
            "gaming_accessories",
            "gaming_chairs_&_furnitures",
            "gaming_desktops",
            "gaming_laptops",
            "handbags",
            "handbags_&_bags",
            "ipad",
            "iphones",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "motherboards",
            "nintendo_switch",
            "pc_cases_&_fans",
            "phone_accessories",
            "playstation",
            "power_banks",
            "power_supplies_(psus)",
            "printers_&_scanners",
            "processors_(cpus)",
            "racing_wheels",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "sleepwear_&_loungewear",
            "smartphones",
            "sneakers_&_athletic",
            "tablets",
            "tops_&_t-shirts",
            "tshirts",
            "vr_&_ar_headset",
            "watches_&_eyewear",
            "wearable_tech",
            "workstations",
            "xbox"
        ]
    },
    "storage": {
        "id": "a15ebfba-3bc6-4819-867c-ae57b74ce4b6",
        "code": "j",
        "label": "storage",
        "type": "number",
        "predefined_values": [],
        "clauses": [
            {
                "name": "u",
                "label": "small storage",
                "matches": [
                    "200"
                ],
                "operator": "<",
                "prefix": "small storage",
                "suffix": ""
            }
        ],
        "categories": [
            "android_phones",
            "iphones",
            "smartphones_&_tablets",
            "gadgets",
            "sound_gadget",
            "android_tablets",
            "cameras_&_photography",
            "cases_&_covers",
            "cctv",
            "chargers_&_cables",
            "drones",
            "e-readers",
            "electronics",
            "feature_phones",
            "home_audio",
            "ipad",
            "phone_accessories",
            "power_banks",
            "smartphones",
            "tablets",
            "television_&_video",
            "wearable_tech",
            "windows_tablets"
        ]
    },
    "size": {
        "id": "4b41a785-a8f1-46e4-ae95-9b0957f00f0d",
        "code": "s",
        "label": "size",
        "type": "text",
        "predefined_values": [],
        "clauses": [
            {
                "name": "x",
                "label": "xl",
                "matches": [
                    "xl"
                ],
                "operator": "=",
                "prefix": "xl size",
                "suffix": ""
            }
        ],
        "categories": [
            "fashion",
            "electronics",
            "iphones",
            "sound_gadget",
            "food",
            "kitchen_appliances",
            "accessories",
            "activewear",
            "beverages",
            "boots",
            "bottoms_&_pants",
            "cameras_&_photography",
            "canned_&_packaged_foods",
            "cctv",
            "clothing",
            "drones",
            "footwear",
            "formal_&_dress_shoes",
            "handbags",
            "handbags_&_bags",
            "home_audio",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "sleepwear_&_loungewear",
            "snacks_&_confectionery",
            "sneakers_&_athletic",
            "television_&_video",
            "tops_&_t-shirts",
            "tshirts",
            "watches_&_eyewear"
        ]
    },
    "color": {
        "id": "b078374b-efeb-412e-8a46-bc6c383fb5e8",
        "code": "c",
        "label": "color",
        "type": "text",
        "predefined_values": [],
        "clauses": [
            {
                "name": "v",
                "label": "color for ladies",
                "matches": [
                    "red",
                    "green",
                    "blue",
                    "yellow",
                    "pink",
                    "grey",
                    "white"
                ],
                "operator": "LIKE",
                "prefix": "vibrant",
                "suffix": "for ladies"
            },
            {
                "name": "c",
                "label": "color for men",
                "matches": [
                    "black",
                    "brown"
                ],
                "operator": "LIKE",
                "prefix": "",
                "suffix": "for men"
            },
            {
                "name": "d",
                "label": "Neutrals",
                "matches": [
                    "black",
                    "grey",
                    "white",
                    "tan",
                    "navy",
                    "beige",
                    "silver"
                ],
                "operator": "LIKE",
                "prefix": "Classic Neutral",
                "suffix": ""
            }
        ],
        "categories": [
            "kitchen_appliances",
            "sound_gadget",
            "iphones",
            "ultrabooks",
            "fashion",
            "gadgets",
            "gaming",
            "sleepwear_&_loungewear",
            "kitchen",
            "laptops_&_computers",
            "smartphones_&_tablets",
            "appliances",
            "automobile",
            "food",
            "health_&_beauty",
            "supermarket_essentials",
            "sporting_goods",
            "toys,_kids_&_babies",
            "accessories",
            "action_figures_&_collectibles",
            "activewear",
            "air_conditioners",
            "all_in_one_pcs",
            "android_phones",
            "android_tablets",
            "baby_care",
            "beverages",
            "blenders",
            "boots",
            "bottoms_&_pants",
            "business_laptops",
            "cameras_&_photography",
            "canned_&_packaged_foods",
            "car_care",
            "car_electronics",
            "cases_&_covers",
            "cctv",
            "chargers_&_cables",
            "cleaning_appliances",
            "clothing",
            "components",
            "computing_accessories",
            "controller_&_game_pads",
            "cooking_appliances",
            "cookware_sets",
            "cooling",
            "cooling_system",
            "data_storage",
            "desktops",
            "dishwashing_supplies",
            "drones",
            "e-readers",
            "educational_toys",
            "electronics",
            "feature_phones",
            "fitness_&_exercise",
            "flight_stick",
            "food_preparation",
            "footwear",
            "formal_&_dress_shoes",
            "fragrances",
            "game_consoles",
            "gaming_accessories",
            "gaming_chairs_&_furnitures",
            "gaming_desktops",
            "gaming_laptops",
            "graphics_card",
            "hair_care",
            "handbags",
            "handbags_&_bags",
            "home_audio",
            "household_cleaning",
            "interior_accessories",
            "ipad",
            "irons_&_steamers",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "large_appliances",
            "laundry",
            "laundry_detergents",
            "makeup",
            "microwaves",
            "motherboards",
            "nintendo_switch",
            "outdoor_sports",
            "paper_&_plastic_products",
            "pc_cases_&_fans",
            "personal_care",
            "pet_supplies",
            "phone_accessories",
            "playstation",
            "power_banks",
            "power_solutions",
            "power_supplies_(psus)",
            "printers_&_scanners",
            "processors_(cpus)",
            "racing_wheels",
            "ram_&_storage",
            "refrigerators_&_freezers",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "skin_care",
            "small_appliances",
            "smartphones",
            "snacks_&_confectionery",
            "sneakers_&_athletic",
            "surface_&_floor_cleaners",
            "tablets",
            "team_sports",
            "television_&_video",
            "tops_&_t-shirts",
            "tshirts",
            "vacuum_cleaners",
            "vr_&_ar_headset",
            "washing_machines_&_dryers",
            "watches_&_eyewear",
            "wearable_tech",
            "windows_tablets",
            "workstations",
            "xbox"
        ]
    },
    "vendor": {
        "id": "daf35101-63ed-4937-8609-cc9c14e65fbe",
        "code": "vendor",
        "label": "vendor",
        "type": "text",
        "predefined_values": [],
        "clauses": [],
        "categories": [
            "accessories",
            "action_figures_&_collectibles",
            "activewear",
            "air_conditioners",
            "all_in_one_pcs",
            "android_phones",
            "android_tablets",
            "appliances",
            "automobile",
            "baby_care",
            "bed_&_bath",
            "bedroom_furniture",
            "beverages",
            "blenders",
            "boots",
            "bottoms_&_pants",
            "business_laptops",
            "cameras_&_photography",
            "canned_&_packaged_foods",
            "car_care",
            "car_electronics",
            "cases_&_covers",
            "cctv",
            "chargers_&_cables",
            "cleaning_appliances",
            "clothing",
            "components",
            "computing_accessories",
            "controller_&_game_pads",
            "cooking_appliances",
            "cookware_sets",
            "cooling",
            "cooling_system",
            "data_storage",
            "desktops",
            "dishwashing_supplies",
            "drones",
            "e-readers",
            "educational_toys",
            "electronics",
            "fashion",
            "feature_phones",
            "fitness_&_exercise",
            "flight_stick",
            "food",
            "food_preparation",
            "footwear",
            "formal_&_dress_shoes",
            "fragrances",
            "furniture_&_organization",
            "gadgets",
            "game_consoles",
            "gaming",
            "gaming_accessories",
            "gaming_chairs_&_furnitures",
            "gaming_desktops",
            "gaming_laptops",
            "graphics_card",
            "hair_care",
            "handbags",
            "handbags_&_bags",
            "health_&_beauty",
            "home_audio",
            "home_decor",
            "household_cleaning",
            "interior_accessories",
            "ipad",
            "iphones",
            "irons_&_steamers",
            "jackets_&_outerwear",
            "jersey",
            "jewellery",
            "kitchen",
            "kitchen_appliances",
            "laptops_&_computers",
            "large_appliances",
            "laundry",
            "laundry_detergents",
            "lighting",
            "living_room_furniture",
            "makeup",
            "microwaves",
            "motherboards",
            "nintendo_switch",
            "office_furniture",
            "outdoor_sports",
            "paper_&_plastic_products",
            "pc_cases_&_fans",
            "personal_care",
            "pet_supplies",
            "phone_accessories",
            "playstation",
            "power_banks",
            "power_solutions",
            "power_supplies_(psus)",
            "printers_&_scanners",
            "processors_(cpus)",
            "racing_wheels",
            "ram_&_storage",
            "refrigerators_&_freezers",
            "rugs_&_carpets",
            "sandals_&_slippers",
            "shirts",
            "shoes",
            "skin_care",
            "sleepwear_&_loungewear",
            "small_appliances",
            "smartphones",
            "smartphones_&_tablets",
            "snacks_&_confectionery",
            "sneakers_&_athletic",
            "sound_gadget",
            "sporting_goods",
            "supermarket_essentials",
            "surface_&_floor_cleaners",
            "tablets",
            "team_sports",
            "television_&_video",
            "tops_&_t-shirts",
            "toys,_kids_&_babies",
            "tshirts",
            "ultrabooks",
            "vacuum_cleaners",
            "vr_&_ar_headset",
            "wall_art",
            "washing_machines_&_dryers",
            "watches_&_eyewear",
            "wearable_tech",
            "windows_tablets",
            "workstations",
            "xbox"
        ]
    }
};

const COLLECTIONS = {
    "darey": {
        "id": "d8f0ca6c-a56f-4bb9-a6cd-c2aa1f296c43",
        "label": "Darey",
        "slug": "darey",
        "rules": [
            {
                "field": "category",
                "value": [
                    "63173747-a5b2-4cdb-942c-032a122631ad"
                ],
                "operator": "in"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "bola_foods": {
        "id": "ce4cbfbf-3222-40fb-9ba8-e8b578c4d729",
        "label": "Bola Foods",
        "slug": "bola-foods-bb039752-collection",
        "rules": [
            {
                "field": "tag",
                "value": "Bola Foods",
                "operator": "eq"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "taye's_home_decor": {
        "id": "51e5a21b-eaa3-4a4b-977a-898fdba414dc",
        "label": "Taye's Home Decor",
        "slug": "taye-s-home-decor-afe03e4b-collection",
        "rules": [
            {
                "field": "tag",
                "value": "Taye's Home Decor",
                "operator": "eq"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "pressy_store": {
        "id": "c216d176-5187-4f5c-bf46-fae1fcf0ee6f",
        "label": "Pressy Store",
        "slug": "pressy-store-284a6311-collection",
        "rules": [
            {
                "field": "attribute",
                "value": "Pressy Store",
                "operator": "eq",
                "attribute_code": "vendor"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "new_arrivals": {
        "id": "3aad4ac6-2d17-4965-a501-edc5f2ac923c",
        "label": "New Arrivals",
        "slug": "new-arrivals",
        "rules": [
            {
                "field": "tag",
                "value": "new",
                "operator": "has",
                "attribute_code": ""
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "drey_tech": {
        "id": "17fcd211-7cf3-4c8f-844d-83d5189e86da",
        "label": "Drey Tech",
        "slug": "drey-tech-5b708d12-collection",
        "rules": [
            {
                "field": "tag",
                "value": "Drey Tech",
                "operator": "eq"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "test": {
        "id": "1b2cdf32-e214-49ef-a5e7-1204f516d24f",
        "label": "Test",
        "slug": "",
        "rules": [
            {
                "field": "attribute_clause",
                "value": "m",
                "operator": "in",
                "attribute_code": "gender"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    },
    "anthy_wears_store": {
        "id": "cebfe6aa-c659-471d-9c36-441865cdb276",
        "label": "Anthy Wears Store",
        "slug": "anthy-wears-store-be114e10-collection",
        "rules": [
            {
                "field": "attribute",
                "value": "Anthy Wears Store",
                "operator": "eq",
                "attribute_code": "vendor"
            }
        ],
        "manual_product_ids": [],
        "excluded_product_ids": [],
        "is_dynamic": true,
        "categories": null
    }
};

const VENDORS = {
    "bola_foods": {
        "id": "bb039752-7b82-45ab-a512-5872f2fcda38",
        "business_name": "Bola Foods",
        "tag": "Bola Foods",
        "checkout_style": "inhouse",
        "whatsapp_phone": null,
        "delivery_scope": "Local & National",
        "product_count": 10,
        "categories": []
    },
    "pressy_store": {
        "id": "284a6311-a791-47b5-bbef-689eb6c505f6",
        "business_name": "Pressy Store",
        "tag": "Pressy Store",
        "checkout_style": "inhouse",
        "whatsapp_phone": null,
        "delivery_scope": "Local & National",
        "product_count": 15,
        "categories": []
    },
    "dareymi": {
        "id": "397b6118-2a98-4144-aa18-88ef225f69bb",
        "business_name": "Dareymi",
        "tag": "Dareymi",
        "checkout_style": "whatsapp",
        "whatsapp_phone": "2347031017216",
        "delivery_scope": "Local & National",
        "product_count": 29,
        "categories": []
    },
    "anthy_wears_store": {
        "id": "be114e10-2e84-443e-bb4d-6af5535368db",
        "business_name": "Anthy Wears Store",
        "tag": "Anthy Wears Store",
        "checkout_style": "inhouse",
        "whatsapp_phone": null,
        "delivery_scope": "Local & National",
        "product_count": 32,
        "categories": []
    },
    "taye's_home_decor": {
        "id": "afe03e4b-2a3c-4d40-b25b-b2e299174116",
        "business_name": "Taye's Home Decor",
        "tag": "Taye's Home Decor",
        "checkout_style": "whatsapp",
        "whatsapp_phone": "2349078484751",
        "delivery_scope": "Local & National",
        "product_count": 2,
        "categories": []
    }
};

const BUSINESSES = { ...VENDORS };

const CATEGORY_INVENTORY = {
    "accessories": 5,
    "action-figures-collectibles": 0,
    "activewear": 0,
    "air-conditioners": 0,
    "all-in-one-pcs": 0,
    "android-phones": 6,
    "android-tablets": 3,
    "appliances": 0,
    "automobile": 0,
    "baby-care": 0,
    "bed-bath": 0,
    "bedroom-furniture": 0,
    "beverages": 4,
    "blenders": 2,
    "boots": 0,
    "bottoms-pants": 0,
    "business-laptops": 0,
    "cameras-photography": 0,
    "canned-packaged-foods": 5,
    "car-care": 0,
    "car-electronics": 0,
    "cases-covers": 0,
    "cctv": 0,
    "chargers-cables": 0,
    "cleaning-appliances": 0,
    "clothing": 5,
    "components": 0,
    "computing-accessories": 0,
    "controller-game-pads": 0,
    "cooking-appliances": 0,
    "cookware-sets": 5,
    "cooling": 0,
    "cooling-system": 0,
    "data-storage": 0,
    "desktops": 0,
    "dishwashing-supplies": 0,
    "drones": 0,
    "e-readers": 0,
    "educational-toys": 0,
    "electronics": 2,
    "fashion": 0,
    "feature-phones": 0,
    "fitness-exercise": 0,
    "flight-stick": 0,
    "food": 10,
    "food-preparation": 0,
    "footwear": 0,
    "formal-dress-shoes": 0,
    "fragrances": 5,
    "furniture-organization": 0,
    "gadgets": 7,
    "game-consoles": 0,
    "gaming": 6,
    "gaming-accessories": 0,
    "gaming-chairs-furnitures": 0,
    "gaming-desktops": 0,
    "gaming-laptops": 0,
    "graphics-card": 0,
    "hair-care": 5,
    "handbags": 5,
    "handbags-bags": 0,
    "health-beauty": 0,
    "home-audio": 0,
    "home-decor": 7,
    "household-cleaning": 0,
    "interior-accessories": 0,
    "ipad": 0,
    "iphones": 6,
    "irons-steamers": 0,
    "jackets-outerwear": 0,
    "jersey": 2,
    "jewellery": 6,
    "kitchen": 0,
    "kitchen-appliances": 5,
    "laptops-computers": 6,
    "large-appliances": 0,
    "laundry": 0,
    "laundry-detergents": 0,
    "lighting": 0,
    "living-room-furniture": 0,
    "makeup": 5,
    "microwaves": 0,
    "motherboards": 0,
    "nintendo-switch": 0,
    "office-furniture": 0,
    "outdoor-sports": 0,
    "paper-plastic-products": 0,
    "pc-cases-fans": 0,
    "personal-care": 3,
    "pet-supplies": 0,
    "phone-accessories": 0,
    "playstation": 0,
    "power-banks": 0,
    "power-solutions": 0,
    "power-supplies-psus-": 0,
    "printers-scanners": 0,
    "processors-cpus-": 0,
    "racing-wheels": 0,
    "ram-storage": 0,
    "refrigerators-freezers": 0,
    "rugs-carpets": 0,
    "sandals-slippers": 5,
    "shirts": 0,
    "shoes": 6,
    "skin-care": 5,
    "sleepwear-loungewear": 1,
    "small-appliances": 0,
    "smartphones": 0,
    "smartphones-tablets": 6,
    "snacks-confectionery": 0,
    "sneakers-athletic": 0,
    "sound-gadget": 1,
    "sporting-goods": 0,
    "supermarket-essentials": 0,
    "surface-floor-cleaners": 0,
    "tablets": 0,
    "team-sports": 0,
    "television-video": 0,
    "tops-t-shirts": 0,
    "toys-kids-babies": 0,
    "tshirts": 3,
    "ultrabooks": 1,
    "vacuum-cleaners": 0,
    "vr-ar-headset": 1,
    "wall-art": 0,
    "washing-machines-dryers": 0,
    "watches-eyewear": 0,
    "wearable-tech": 0,
    "windows-tablets": 0,
    "workstations": 0,
    "xbox": 1
};

const helpers = initContextHelpers(CATEGORIES, ATTRIBUTES, COLLECTIONS, VENDORS);

module.exports = { 
    CATEGORIES, 
    ATTRIBUTES,
    COLLECTIONS, 
    VENDORS, 
    BUSINESSES, 
    CATEGORY_INVENTORY,
    ...helpers
};
