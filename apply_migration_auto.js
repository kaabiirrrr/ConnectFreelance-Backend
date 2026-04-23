const adminClient = require('./supabase/adminClient');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const sqlPath = path.resolve(__dirname, 'supabase', 'migration_role_system.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Attempting to apply migration via rpc("exec_sql")...');
        
        const { error } = await adminClient.rpc('exec_sql', { sql });

        if (error) {
            if (error.message.includes('function rpc.exec_sql') || error.code === 'PGRST202') {
                console.error('The "exec_sql" RPC function does not exist in your Supabase project.');
                console.log('\n--- MANUAL ACTION REQUIRED ---');
                console.log('Please copy the content of backend/supabase/migration_role_system.sql');
                console.log('and run it manually in your Supabase SQL Editor.');
                console.log('------------------------------');
            } else {
                console.error('Migration failed:', error.message);
                console.log('Full error:', JSON.stringify(error, null, 2));
            }
            process.exit(1);
        }

        console.log('Migration applied successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Script failed:', err.message);
        process.exit(1);
    }
}

run();
