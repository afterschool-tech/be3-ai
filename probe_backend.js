const axios = require('axios');

async function testSlug() {
    const slug = 'minimal-storagesmartphonesfor-students';
    const url = `http://localhost:3000/search/resolve-slug/${slug}`;
    console.log(`Testing URL: ${url}`);

    try {
        const response = await axios.get(url, {
            headers: {
                'X-Tenant-ID': 'cbe1df05-45ed-455a-9ce6-156b0bd45713'
            }
        });
        console.log('Response Status:', response.status);
        console.log('Response Data Structure:', JSON.stringify(response.data, null, 2).substring(0, 1000));

        if (response.data.results) console.log('results is array:', Array.isArray(response.data.results));
        else if (response.data.data) console.log('data is array:', Array.isArray(response.data.data));
        else console.log('root data is array:', Array.isArray(response.data));

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Error Data:', error.response.data);
        }
    }
}

testSlug();
