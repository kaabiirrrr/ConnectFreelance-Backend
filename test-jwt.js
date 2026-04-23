require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabaseUrl = process.env.SUPABASE_URL;
const jwtSecret = process.env.JWT_SECRET;

console.log('Using JWT Secret:', jwtSecret);

// Generate legacy anon key
const anonToken = jwt.sign(
    { role: 'anon', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) }, // 10 years
    jwtSecret
);

const serviceRoleToken = jwt.sign(
    { role: 'service_role', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60) },
    jwtSecret
);

const anonClient = createClient(supabaseUrl, anonToken);
const adminClient = createClient(supabaseUrl, serviceRoleToken);

async function runTest() {
    console.log('--- Testing Generated Anon Client ---');
    const anonRes = await anonClient.from('profiles').select('user_id').limit(1);
    console.log('Anon Result:', anonRes.error ? anonRes.error.message : 'SUCCESS');

    console.log('--- Testing Generated Admin Client ---');
    const adminRes = await adminClient.from('profiles').select('user_id').limit(1);
    console.log('Admin Result:', adminRes.error ? adminRes.error.message : 'SUCCESS');
}

runTest();
