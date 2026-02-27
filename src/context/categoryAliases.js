module.exports = {
    // One category -> many aliases
    // Values can be either category IDs or a slug/key that exists in storeContext.CATEGORIES.
    // Keep aliases lowercase.
    //
    // Example:
    // "7b8b5bb4-7878-4203-a550-a0941e1e3eb9": ["phone", "phones", "smart phone", "smart phones"],

    // Phones (generic) should map to Smartphones
    'Smartphones': [
        'phone',
        'phones',
        'smartphone',
        'smartphones',
        'smart phone',
        'smart phones',
        'mobile phone',
        'mobile phones',
        'mobile',
        'mobiles',
        'cell phone',
        'cell phones',
        'cellphone',
        'cellphones'
    ],

    'laptops_&_computers': [
        'laptop',
        'laptops'
    ],
};
