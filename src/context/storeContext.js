
/**
 * AUTO-GENERATED Comprehensive Store Context
 * Generated: 2026-02-13T06:25:38.438Z
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

const CATEGORIES = {
    "all_in_one_pcs": {
        "id": "f564122f-2ee3-4af9-b998-b42d72d56ccd",
        "label": "All in one PCs",
        "slug": "all-in-one-pcs",
        "description": "",
        "image_url": "https://www.techjunkie.com/wp-content/uploads/2013/09/20130924_2013imac.jpg",
        "parent_id": "cca00d97-3125-4dc3-9141-e6d459764b76",
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
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
            "brand",
            "storage"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage"
        ],
        "product_count": 4,
        "total_count": 4
    },
    "android_tablets": {
        "id": "63173747-a5b2-4cdb-942c-032a122631ad",
        "label": "Android Tablets",
        "slug": "android-tablets",
        "description": "",
        "image_url": "https://media.s-bol.com/3mg7WJvQKJMM/1w3nyvP/550x408.jpg",
        "parent_id": "8eb82d64-fb66-4657-9add-14bc2b31c00e",
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
        "product_count": 3,
        "total_count": 3
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
            "brand"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product"
        ],
        "product_count": 0,
        "total_count": 0
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
            "ram_&_storage"
        ],
        "attributes": [
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
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
        "attributes": [],
        "allowed_clauses": [],
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
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
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
            "price_tier"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive"
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
        "attributes": [],
        "allowed_clauses": [],
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
            "sound_gadget"
        ],
        "attributes": [
            "size"
        ],
        "allowed_clauses": [],
        "product_count": 2,
        "total_count": 3
    },
    "flight_stick": {
        "id": "383d8882-9177-48ec-a21f-d560d1f5b6f5",
        "label": "Flight Stick",
        "slug": "flight-stick",
        "description": "",
        "image_url": "https://www.thrustmaster.com/wp-content/uploads/2021/09/UTH-t-flight-hotas-4-flight-sim-1-3.png",
        "parent_id": "49c8b316-57b1-44b2-a168-9cff68a03d4f",
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
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
        "children": [],
        "attributes": [
            "size",
            "color"
        ],
        "allowed_clauses": [
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 10,
        "total_count": 10
    },
    "gadgets": {
        "id": "95bd9c7a-4c90-4d9e-950b-d27a12113c4b",
        "label": "Gadgets",
        "slug": "gadgets",
        "description": "very good cat sha",
        "image_url": null,
        "parent_id": null,
        "children": [
            "electronics",
            "kitchen_appliances"
        ],
        "attributes": [
            "material",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 7,
        "total_count": 11
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
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
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
        "attributes": [],
        "allowed_clauses": [],
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
            "size",
            "material",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 4,
        "total_count": 4
    },
    "kitchen_appliances": {
        "id": "3e5781a6-5500-476f-8612-bdd1c2eeeb27",
        "label": "Kitchen Appliances",
        "slug": "kitchen-appliances",
        "description": "Everything kitchen related",
        "image_url": "https://majesticchef.pk/cdn/shop/files/GlSet.jpg",
        "parent_id": "95bd9c7a-4c90-4d9e-950b-d27a12113c4b",
        "children": [],
        "attributes": [
            "size",
            "quality",
            "material",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "high_quality",
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 1,
        "total_count": 1
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
            "desktops",
            "gaming_laptops",
            "ultrabooks"
        ],
        "attributes": [
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
        ],
        "product_count": 6,
        "total_count": 7
    },
    "new_cat": {
        "id": "577c0281-bccb-4a16-9692-b73714c77299",
        "label": "New Cat",
        "slug": "new-cat",
        "description": "",
        "image_url": null,
        "parent_id": null,
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
        "product_count": 7,
        "total_count": 7
    },
    "nintendo_switch": {
        "id": "d3ef8b79-d7a8-4925-9f94-677a74e400e5",
        "label": "Nintendo Switch",
        "slug": "nintendo-switch",
        "description": "",
        "image_url": "https://cdn.mos.cms.futurecdn.net/XyAaqBEtYtb8YffjKZ68Gb.jpg",
        "parent_id": "2c86882a-c069-47c3-bdb6-9af4849672bb",
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
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
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
            "brand",
            "price_tier"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "affordable",
            "expensive"
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
            "price_tier"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive"
        ],
        "product_count": 0,
        "total_count": 8
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
            "phone_accessories",
            "smartphones",
            "tablets"
        ],
        "attributes": [
            "brand",
            "storage"
        ],
        "allowed_clauses": [
            "apple_product",
            "infinix_product",
            "microsoft_product",
            "small_storage"
        ],
        "product_count": 6,
        "total_count": 17
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
            "size",
            "material",
            "storage",
            "color"
        ],
        "allowed_clauses": [
            "small_storage",
            "color_for_ladies",
            "color_for_men"
        ],
        "product_count": 1,
        "total_count": 1
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
            "price_tier"
        ],
        "allowed_clauses": [
            "affordable",
            "expensive"
        ],
        "product_count": 0,
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
        "product_count": 1,
        "total_count": 1
    },
    "vr_&_ar_headset": {
        "id": "efb14888-9617-44c4-9081-aa22d1cf1ed3",
        "label": "VR & AR Headset",
        "slug": "vr-ar-headset",
        "description": "",
        "image_url": "https://production-static.mobilesyrup.com/uploads/2023/06/Vision-pro-header3-scaled.jpg",
        "parent_id": "63efd70e-2daf-46f9-b801-d9da53209930",
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
        "product_count": 1,
        "total_count": 1
    },
    "windows_tablets": {
        "id": "0534dfd3-7f1b-47bb-8891-c0bf6033425e",
        "label": "Windows Tablets",
        "slug": "windows-tablets",
        "description": "",
        "image_url": "https://sm.pcmag.com/pcmag_uk/photo/m/microsoft-/microsoft-surface-pro-2024_4tey.jpg",
        "parent_id": "8eb82d64-fb66-4657-9add-14bc2b31c00e",
        "children": [],
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
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
        "attributes": [],
        "allowed_clauses": [],
        "product_count": 1,
        "total_count": 1
    }
};

const ATTRIBUTES = {
    "size": {
        "id": "4b41a785-a8f1-46e4-ae95-9b0957f00f0d",
        "code": "s",
        "label": "size",
        "type": "text",
        "predefined_values": [],
        "clauses": [],
        "categories": [
            "electronics",
            "iphones",
            "food",
            "sound_gadget",
            "kitchen_appliances"
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
                "prefix": "expensive",
                "suffix": ""
            }
        ],
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
        ]
    },
    "material": {
        "id": "9925207b-ca88-4be2-bee7-cd402c9ee98f",
        "code": "m",
        "label": "material",
        "type": "text",
        "predefined_values": [],
        "clauses": [],
        "categories": [
            "iphones",
            "gadgets",
            "sound_gadget",
            "kitchen_appliances"
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
            "kitchen_appliances"
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
            }
        ],
        "categories": [
            "food",
            "gadgets",
            "sound_gadget",
            "iphones",
            "kitchen_appliances",
            "ultrabooks",
            "gaming"
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
            "gadgets",
            "sound_gadget",
            "iphones",
            "kitchen_appliances",
            "smartphones_&_tablets"
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
    }
};

const VENDORS = {
    "taye's_home_decor": {
        "id": "afe03e4b-2a3c-4d40-b25b-b2e299174116",
        "business_name": "Taye's Home Decor",
        "tag": "Taye's Home Decor",
        "checkout_style": "whatsapp",
        "whatsapp_phone": "2349078484751",
        "delivery_scope": "Local & National",
        "product_count": 1,
        "categories": []
    },
    "dareymi": {
        "id": "397b6118-2a98-4144-aa18-88ef225f69bb",
        "business_name": "Dareymi",
        "tag": "Dareymi",
        "checkout_style": "whatsapp",
        "whatsapp_phone": "2347031017216",
        "delivery_scope": "Local & National",
        "product_count": 1,
        "categories": []
    },
    "bola_foods": {
        "id": "bb039752-7b82-45ab-a512-5872f2fcda38",
        "business_name": "Bola Foods",
        "tag": "Bola Foods",
        "checkout_style": "inhouse",
        "whatsapp_phone": null,
        "delivery_scope": "Local & National",
        "product_count": 1,
        "categories": []
    }
};

const BUSINESSES = { ...VENDORS };

const CATEGORY_INVENTORY = {
    "all-in-one-pcs": 0,
    "android-phones": 4,
    "android-tablets": 3,
    "business-laptops": 0,
    "components": 0,
    "controller-game-pads": 0,
    "cooling-system": 0,
    "desktops": 0,
    "e-readers": 0,
    "electronics": 2,
    "flight-stick": 0,
    "food": 10,
    "gadgets": 7,
    "game-consoles": 0,
    "gaming": 6,
    "gaming-accessories": 0,
    "gaming-chairs-furnitures": 0,
    "gaming-desktops": 0,
    "gaming-laptops": 0,
    "graphics-card": 0,
    "ipad": 0,
    "iphones": 4,
    "kitchen-appliances": 1,
    "laptops-computers": 6,
    "new-cat": 7,
    "nintendo-switch": 0,
    "phone-accessories": 0,
    "playstation": 0,
    "racing-wheels": 0,
    "ram-storage": 0,
    "smartphones": 0,
    "smartphones-tablets": 6,
    "sound-gadget": 1,
    "tablets": 0,
    "ultrabooks": 1,
    "vr-ar-headset": 1,
    "windows-tablets": 0,
    "workstations": 0,
    "xbox": 1
};


/**
 * Tree Navigation & Context Helpers
 */
function getCategoryTree() {
    const roots = Object.keys(CATEGORIES).filter(k => !CATEGORIES[k].parent_id);

    const getAncestors = (categoryKey) => {
        const ancestors = [];
        let current = CATEGORIES[categoryKey];
        while (current && current.parent_id) {
            const parentKey = Object.keys(CATEGORIES).find(k => CATEGORIES[k].id === current.parent_id);
            if (parentKey) {
                ancestors.unshift(parentKey);
                current = CATEGORIES[parentKey];
            } else break;
        }
        return ancestors;
    };

    const getDescendants = (categoryKey) => {
        const descendants = [];
        const queue = [...(CATEGORIES[categoryKey]?.children || [])];
        while (queue.length > 0) {
            const child = queue.shift();
            descendants.push(child);
            queue.push(...(CATEGORIES[child]?.children || []));
        }
        return descendants;
    };

    const getSiblings = (categoryKey) => {
        const cat = CATEGORIES[categoryKey];
        if (!cat || !cat.parent_id) return [];
        const parentKey = Object.keys(CATEGORIES).find(k => CATEGORIES[k].id === cat.parent_id);
        if (!parentKey) return [];
        return CATEGORIES[parentKey].children.filter(c => c !== categoryKey);
    };

    const getPath = (categoryKey) => {
        const ancestors = getAncestors(categoryKey);
        return [...ancestors, categoryKey].map(k => CATEGORIES[k]?.label).filter(Boolean).join(' > ');
    };

    const findBySlug = (slug) => {
        return Object.keys(CATEGORIES).find(k => CATEGORIES[k].slug === slug);
    };

    return {
        roots,
        getAncestors,
        getDescendants,
        getSiblings,
        getPath,
        findBySlug
    };
}

/**
 * Get comprehensive context summary for AI prompts
 */
function getContextSummary() {
    const tree = getCategoryTree();

    return {
        categories: {
            total: Object.keys(CATEGORIES).length,
            roots: tree.roots.map(k => ({
                key: k,
                label: CATEGORIES[k].label,
                total_products: CATEGORIES[k].total_count,
                children: CATEGORIES[k].children.length
            })),
            available: Object.entries(CATEGORIES)
                .filter(([k, c]) => c.total_count > 0)
                .map(([k, c]) => ({
                    path: tree.getPath(k),
                    products: c.total_count,
                    attributes: c.attributes
                })),
            unavailable: Object.entries(CATEGORIES)
                .filter(([k, c]) => c.total_count === 0)
                .map(([k, c]) => tree.getPath(k))
        },

        attributes: {
            total: Object.keys(ATTRIBUTES).length,
            list: Object.entries(ATTRIBUTES).map(([k, a]) => ({
                label: a.label,
                has_predefined_values: a.has_predefined_values,
                supported_by: a.categories.length,
                example_categories: a.categories.slice(0, 3)
            }))
        },

        collections: {
            total: Object.keys(COLLECTIONS).length,
            dynamic: Object.entries(COLLECTIONS).filter(([k, c]) => c.is_dynamic).length,
            list: Object.entries(COLLECTIONS).map(([k, c]) => ({
                label: c.label,
                rules_count: c.rules.length,
                manual_count: c.manual_product_ids.length
            }))
        },

        vendors: {
            total: Object.keys(VENDORS).length,
            list: Object.values(VENDORS).map(v => ({
                name: v.business_name,
                products: v.product_count,
                checkout_style: v.checkout_style,
                whatsapp: v.whatsapp_phone
            }))
        }
    };
}

/**
 * Get LEAN context for System Prompts (Token Efficient)
 * Only exposes Roots, Vendors, and Collections.
 * Forces AI to use tools for deep dives.
 */
function getLeanContext() {
    const tree = getCategoryTree();

    // 1. Root Categories (Structure)
    const roots = tree.roots.map(k => CATEGORIES[k].label);

    // 1b. Active Categories (Where products actually live)
    // Flattened list of ANY category with products > 0
    const activeCategories = Object.values(CATEGORIES)
        .filter(c => c.total_count > 0)
        .map(c => ({
            name: c.label,
            count: c.total_count
        }));

    // 2. Vendors (with details)
    const vendors = Object.values(VENDORS).map(v => ({
        name: v.business_name,
        checkout: v.checkout_style,
        phone: v.whatsapp_phone
    }));

    // 3. Collections (Names only)
    const collections = Object.values(COLLECTIONS).map(c => c.label);

    // 4. Attributes (Names only, no details)
    const attributes = Object.values(ATTRIBUTES).map(a => a.label);

    return {
        store_scope: {
            root_departments: roots,
            active_departments: activeCategories,
            partners: vendors,
            featured_collections: collections,
            filters: attributes
        },
        policy: "Use 'category.list' to see sub-departments. Use 'product.search' to find items."
    };
}


const CATEGORY_TREE = getCategoryTree();

module.exports = {
    CATEGORIES,
    ATTRIBUTES,
    COLLECTIONS,
    VENDORS,
    BUSINESSES,
    CATEGORY_INVENTORY,
    CATEGORY_TREE,
    CATEGORY_TREE,
    getContextSummary,
    getLeanContext
};
