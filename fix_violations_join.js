const adminClient = require('./supabase/adminClient');
const fs = require('fs');
const path = require('path');

async function fixViolationsJoin() {
    try {
        const sqlPath = path.resolve(__dirname, 'scripts', 'ensure_moderation_relationship.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Attempting to fix violations relationship via RPC...');
        
        const { error } = await adminClient.rpc('exec_sql', { sql });

        if (error) {
            console.error('RPC Execution failed. You must run the SQL manually.');
            console.log('\n--- PLEASE RUN THIS SQL IN SUPABASE SQL EDITOR ---');
            console.log(sql);
            console.log('------------------------------------------------');
        } else {
            console.log('Successfully applied database fix!');
        }
        
    } catch (err) {
        console.error('Script failed:', err.message);
    }
}

fixViolationsJoin();
