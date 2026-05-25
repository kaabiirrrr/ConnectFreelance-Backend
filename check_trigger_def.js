const adminClient = require('./supabase/adminClient');

async function test() {
    const { data, error } = await adminClient.rpc('execute_sql_raw', {
        query: "SELECT prosrc FROM pg_proc WHERE proname = 'update_profile_rating';"
    });
    
    if (error) {
        console.error('Error running raw sql:', error);
        // Fallback: query via general select or check
        const { data: triggerDef, error: err2 } = await adminClient
            .from('profiles')
            .select('user_id')
            .limit(1);
        console.log('Fall back check connection ok:', !err2);
    } else {
        console.log('Function definition:', data);
    }
}
test();
