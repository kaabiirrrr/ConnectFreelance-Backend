const adminClient = require('./supabase/adminClient');

async function inspectSchema() {
    try {
        console.log('--- Inspecting work_logs ---');
        const { data: log, error: logError } = await adminClient.from('work_logs').select('*').limit(1);
        if (logError) console.error('Error fetching work_logs:', logError);
        else console.log('work_logs sample:', log);

        console.log('\n--- Inspecting notifications ---');
        const { data: note, error: noteError } = await adminClient.from('notifications').select('*').limit(1);
        if (noteError) console.error('Error fetching notifications:', noteError);
        else console.log('notifications sample:', note);

        console.log('\n--- Inspecting work_log_queries ---');
        const { data: query, error: queryError } = await adminClient.from('work_log_queries').select('*').limit(1);
        if (queryError) console.error('Error fetching work_log_queries:', queryError);
        else console.log('work_log_queries sample:', query);

    } catch (err) {
        console.error('Fatal error:', err);
    }
}

inspectSchema();
