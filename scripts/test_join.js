const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testJoin() {
    console.log('🔍 Testing Join Query...');

    const { data, error } = await supabase
        .from('identity_verifications')
        .select(`
            *,
            user:users!user_id (
                email
            ),
            profile:profiles!user_id (
                name,
                avatar_url
            )
        `)
        .limit(1);

    if (error) {
        console.error('❌ JOIN FAILED:', error.message);
        console.error('Details:', error.details);
        console.error('Hint:', error.hint);
        console.error('Code:', error.code);
    } else {
        console.log('✅ JOIN SUCCESSFUL!');
        console.log('Data sample:', JSON.stringify(data, null, 2));
    }
}

testJoin();
