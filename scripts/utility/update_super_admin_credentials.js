/**
 * Script to update SUPER_ADMIN credentials
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

// New credentials
const NEW_EMAIL = 'kabirmore8296@gmail.com';
const NEW_PASSWORD = 'ConnectPassword41!';
const ADMIN_NAME = 'Platform Owner';
const ADMIN_ROLE = 'SUPER_ADMIN';

async function updateSuperAdminCredentials() {
    console.log('🔧 Updating SUPER_ADMIN credentials...\n');
    
    try {
        // Step 1: Find existing SUPER_ADMIN
        console.log('📋 Finding current SUPER_ADMIN...');
        const { data: admins } = await supabase
            .from('admins')
            .select('*')
            .eq('role', 'SUPER_ADMIN');
        
        if (!admins || admins.length === 0) {
            console.log('❌ No SUPER_ADMIN found in database!');
            return;
        }
        
        console.log(`✅ Found ${admins.length} SUPER_ADMIN(s)\n`);
        
        // Use the first one (should be the main admin)
        const currentAdmin = admins[0];
        const userId = currentAdmin.id;
        const oldEmail = currentAdmin.email;
        
        console.log(`Current SUPER_ADMIN:`);
        console.log(`  ID: ${userId}`);
        console.log(`  Email: ${oldEmail}\n`);
        
        // Step 2: Update auth email
        console.log('🔄 Updating authentication email...');
        const { data: authUpdate, error: authError } = await supabase.auth.admin.updateUserById(userId, {
            email: NEW_EMAIL,
            password: NEW_PASSWORD,
            email_confirm: true
        });
        
        if (authError) {
            console.log('⚠️  Error updating auth:', authError.message);
            throw authError;
        }
        
        console.log('✅ Auth credentials updated');
        console.log(`   New Email: ${authUpdate.user.email}\n`);
        
        // Step 3: Update admins table email
        console.log('📝 Updating admins table...');
        const { error: adminUpdateError } = await supabase
            .from('admins')
            .update({ 
                email: NEW_EMAIL,
                name: ADMIN_NAME,
                role: ADMIN_ROLE,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (adminUpdateError) {
            console.log('⚠️  Error updating admins table:', adminUpdateError.message);
        } else {
            console.log('✅ Admins table updated');
        }
        
        // Step 4: Update profiles table email
        console.log('\n📝 Updating profiles table...');
        const { error: profileUpdateError } = await supabase
            .from('profiles')
            .update({ 
                email: NEW_EMAIL,
                name: ADMIN_NAME,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (profileUpdateError) {
            console.log('⚠️  Error updating profiles table:', profileUpdateError.message);
        } else {
            console.log('✅ Profiles table updated');
        }
        
        // Step 5: Update users table email
        console.log('\n📝 Updating users table...');
        const { error: usersUpdateError } = await supabase
            .from('users')
            .update({ 
                email: NEW_EMAIL,
                role: ADMIN_ROLE
            })
            .eq('id', userId);
        
        if (usersUpdateError) {
            console.log('⚠️  Error updating users table:', usersUpdateError.message);
        } else {
            console.log('✅ Users table updated');
        }
        
        console.log('\n🎉 SUPER_ADMIN credentials updated successfully!\n');
        console.log('📊 NEW Login Credentials:');
        console.log(`   Email: ${NEW_EMAIL}`);
        console.log(`   Password: ${NEW_PASSWORD}`);
        console.log(`   Role: ${ADMIN_ROLE}`);
        console.log('\n🚀 You can now login at http://localhost:5174/login\n');
        console.log('💡 After login, you should be redirected to /admin/dashboard\n');
        
        return { success: true };
        
    } catch (error) {
        console.error('\n❌ Error updating credentials:', error.message);
        console.error('Details:', error);
        throw error;
    }
}

// Run the script
updateSuperAdminCredentials()
    .then(() => {
        console.log('✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    });
