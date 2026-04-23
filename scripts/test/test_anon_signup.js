const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Test with ANON key (simulates frontend/user-facing sign-up)
const anonKey = 'sb_publishable_hfieBk7SPohWyemFhU6qqQ__hDc-zYb';
const supabaseUrl = process.env.SUPABASE_URL;

const supabaseAnon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function testAnonSignup() {
    const email = `anon_test_${Date.now()}@example.com`;
    console.log('Testing ANON signUp with email:', email);
    const { data, error } = await supabaseAnon.auth.signUp({
        email,
        password: 'Password123!'
    });
    console.log('User ID:', data?.user?.id);
    console.log('Error:', JSON.stringify(error));
}

testAnonSignup();
