const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifySetup() {
    console.log('🔍 Verifying Identity Verification System Setup...\n');

    try {
        // 1. Check if table exists and get columns
        const { data: columns, error: tableError } = await supabase
            .rpc('get_table_columns', { table_name: 'identity_verifications' });

        if (tableError) {
            // Fallback: Try a simple query
            const { error: queryError } = await supabase
                .from('identity_verifications')
                .select('*')
                .limit(0);

            if (queryError) {
                if (queryError.code === '42P01') {
                    console.error('❌ Error: Table "identity_verifications" does not exist.');
                    console.log('👉 ACTION: Run the creation script in your Supabase SQL Editor.');
                } else {
                    console.error('❌ Error checking table:', queryError.message);
                }
                return;
            }
            console.log('✅ Table "identity_verifications" exists.');
        } else {
            console.log('✅ Table "identity_verifications" exists.');
            
            // Check for specific columns
            const requiredColumns = ['user_id', 'user_role', 'status', 'document_front_url'];
            const columnNames = columns.map(c => c.column_name);
            
            requiredColumns.forEach(reqCol => {
                if (columnNames.includes(reqCol)) {
                    console.log(`   - Column "${reqCol}" is present.`);
                } else {
                    console.error(`   - ❌ Column "${reqCol}" is MISSING.`);
                }
            });
        }

        // 2. Check indexes (optional check via query performance or raw sql but harder via JS)
        console.log('\n✅ Script complete. If you saw any ❌ markers above, please run the SQL migration script provided.');
        
    } catch (err) {
        console.error('❌ Unexpected error during verification:', err.message);
    }
}

// NOTE: This depends on having a get_table_columns RPC, which might not exist by default.
// Let's use a simpler approach that works out of the box.

async function verifySimple() {
    console.log('🔍 Verifying Identity Verification System (Simple Check)...\n');

    // Test query to check for user_role column
    const { error } = await supabase
        .from('identity_verifications')
        .select('user_role')
        .limit(0);

    if (error) {
        if (error.code === '42P01') {
            console.error('❌ FAIL: Table "identity_verifications" is MISSING.');
        } else if (error.code === '42703') {
            console.error('❌ FAIL: Column "user_role" is MISSING from "identity_verifications".');
        } else {
            console.error(`❌ FAIL: Database error: ${error.message} (Code: ${error.code})`);
        }
        console.log('\n👉 HOW TO FIX: Run backend/supabase/fix_idv_schema.sql in your Supabase SQL Editor.');
    } else {
        console.log('✅ SUCCESS: Table and "user_role" column are correctly configured.');
        console.log('🚀 Your Admin Dashboard should now work perfectly.');
    }
}

verifySimple();
