const supabase = require('./supabase/client');

// This checks if there are any auth hooks that could be causing issues
// We'll try to query auth settings via Supabase management approach
async function checkAuthHooks() {
    // Try to check if there's a trigger on auth.users from the public schema
    const { data, error } = await supabase.rpc('check_auth_hooks');
    console.log('Data:', data);
    console.log('Error:', error);

    // Alternative: query pg_trigger
    const { data: triggers, error: tErr } = await supabase
        .from('pg_trigger')
        .select('*')
        .limit(10);
    console.log('Triggers data:', triggers);
    console.log('Triggers error:', tErr);
}

checkAuthHooks();
