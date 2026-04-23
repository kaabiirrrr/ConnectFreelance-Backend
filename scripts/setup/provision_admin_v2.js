/**
 * Script to provision a new standard admin account
 * Credentials:
 *   Email: samarthshendge20@gmail.com
 *   Password: StanadarAdmin41!
 *   Role: ADMIN
 * 
 * Usage: node provision_admin_v2.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const ADMIN_EMAIL = 'samarthshendge20@gmail.com';
const ADMIN_PASSWORD = 'StanadarAdmin41!';
const ADMIN_ROLE = 'ADMIN';
const ADMIN_NAME = 'Samarth Shendge'; // Defaulting to email name if not specified

async function provisionAdmin() {
    console.log(`🔧 Provisioning Admin account for: ${ADMIN_EMAIL}\n`);
    
    try {
        // Step 1: Check for existing Auth User
        console.log('📋 Checking if auth user exists...');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) throw listError;
        
        let targetAuthUser = users.find(u => u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
        
        if (targetAuthUser) {
            console.log(`✅ Auth user found with ID: ${targetAuthUser.id}`);
            // Update password to ensure it matches requirement
            console.log('🔄 Updating password...');
            const { error: updateError } = await supabase.auth.admin.updateUserById(targetAuthUser.id, {
                password: ADMIN_PASSWORD,
                email_confirm: true
            });
            if (updateError) console.warn('⚠️ Warning updating auth user:', updateError.message);
        } else {
            console.log('➕ Creating new auth user...');
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                email: ADMIN_EMAIL,
                password: ADMIN_PASSWORD,
                email_confirm: true,
                user_metadata: {
                    full_name: ADMIN_NAME,
                    role: ADMIN_ROLE
                }
            });
            if (createError) throw createError;
            targetAuthUser = newUser.user;
            console.log(`✅ New auth user created with ID: ${targetAuthUser.id}`);
        }

        const userId = targetAuthUser.id;

        // Step 2: Ensure NO record in profiles table
        console.log('\n🗑️  Cleaning up profiles table...');
        // We'll try both 'id' and 'user_id' just in case of any schema confusion, 
        // though our recent audit suggests 'id' is used in the actual DB for these queries.
        const { error: profileDeleteEmailError } = await supabase
            .from('profiles')
            .delete()
            .eq('email', ADMIN_EMAIL);
        
        if (profileDeleteEmailError) {
            console.warn('⚠️ Warning deleting profile by email:', profileDeleteEmailError.message);
        }

        const { error: profileDeleteIdError } = await supabase
            .from('profiles')
            .delete()
            .eq('id', userId);
        
        if (profileDeleteIdError) {
            console.warn('⚠️ Warning deleting profile by id:', profileDeleteIdError.message);
        }

        // Step 3: Insert into admins table
        console.log('\n📝 Inserting into admins table...');
        const { data: adminRecord, error: adminError } = await supabase
            .from('admins')
            .upsert({
                id: userId,
                email: ADMIN_EMAIL,
                role: ADMIN_ROLE,
                name: ADMIN_NAME,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (adminError) {
            console.error('❌ Error inserting into admins:', adminError.message);
            throw adminError;
        }

        console.log(`✅ Admin record created: ID=${adminRecord.id}, Role=${adminRecord.role}`);

        console.log('\n🎉 Provisioning successful!');
        console.log('-----------------------------------');
        console.log(`Email:    ${ADMIN_EMAIL}`);
        console.log(`Password: ${ADMIN_PASSWORD}`);
        console.log(`Role:     ${ADMIN_ROLE}`);
        console.log('-----------------------------------');
        console.log('🚀 Login at your admin dashboard.');

    } catch (error) {
        console.error('\n❌ Provisioning failed:', error.message);
        process.exit(1);
    }
}

provisionAdmin();
