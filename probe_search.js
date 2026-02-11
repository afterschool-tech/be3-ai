const axios = require('axios');

async function testFilter() {
    const filter = 'category_id=7b8b5bb4-7878-4203-a550-a0941e1e3eb9&attribute.j:u=1000';
    const url = `http://localhost:3000/search?${filter}&per_page=10`;
    console.log(`Testing Filter URL: ${url}`);

    try {
        const response = await axios.get(url, {
            headers: {
                'X-Tenant-ID': 'cbe1df05-45ed-455a-9ce6-156b0bd45713'
            }
        });
        console.log('Response Status:', response.status);
        console.log('Response Data Structure:', JSON.stringify(response.data, null, 2).substring(0, 500));

        const products = response.data.results || response.data.data || response.data.products || (Array.isArray(response.data) ? response.data : []);
        console.log('Products extracted count:', products.length);
        if (products.length > 0) {
            console.log('First product keys:', Object.keys(products[0]));
        }

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Data:', error.response.data);
        }
    }
}

testFilter();
