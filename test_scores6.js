const adminClient = require('./supabase/adminClient');
require('dotenv').config();

async function run() {
    const freelancerId = 'aa5251e3-3faa-4121-9276-17d71d2341e8'; // Kabir
    
    const { data: profile, error } = await adminClient
        .from('profiles')
        .select('user_id, skills, category, hourly_rate, reliability_score, risk_score, preferred_categories')
        .eq('user_id', freelancerId)
        .single();
    if (error) console.error('Error:', error.message, error.code);
}
run();
