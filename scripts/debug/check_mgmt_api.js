const axios = require('axios');
require('dotenv').config();

// Try to look at auth hooks via management API
// The Supabase management API can be queried at https://api.supabase.com
// But this requires a management API key, not a service role key.
// Let's instead try to use a raw SQL query via the Postgres REST endpoint

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function checkHooksViaSQL() {
    console.log('Trying to query triggers via REST...');

    // Try querying information_schema via Supabase REST API (needs service role and pg_extensions)
    try {
        const resp = await axios.get(
            `${supabaseUrl}/rest/v1/`,
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
        );
        console.log('REST API works, schemas:', Object.keys(resp.data || {}));
    } catch (e) {
        console.log('REST API error:', e.response?.status, e.response?.data);
    }

    // Try using pg_catalog via REST
    try {
        const resp = await axios.post(
            `${supabaseUrl}/rest/v1/rpc/version`,
            {},
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
        );
        console.log('Version:', resp.data);
    } catch (e) {
        console.log('RPC version error:', e.response?.data);
    }
}

checkHooksViaSQL();
