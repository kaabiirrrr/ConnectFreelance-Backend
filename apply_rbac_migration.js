const adminClient = require('./supabase/adminClient');
const fs = require('fs');
const path = require('path');

async function run() {
    try {
        const sqlPath = path.resolve(__dirname, 'migrations', '20260521_enterprise_rbac_system.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Attempting to apply RBAC migration...');
        
        const { error } = await adminClient.rpc('exec_sql', { sql });

        if (error) {
            console.error('Migration failed:', error.message);
            console.log('Full error:', JSON.stringify(error, null, 2));
            process.exit(1);
        }

        console.log('RBAC Migration applied successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Script failed:', err.message);
        process.exit(1);
    }
}

run();
