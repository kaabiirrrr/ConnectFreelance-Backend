/**
 * Script to delete and recreate admin account as SUPER_ADMIN
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

// Admin credentials
const ADMIN_EMAIL = 'lets.connectbro@gmail.com';
const ADMIN_PASSWORD = 'AdminConnect41!';
const ADMIN_NAME = 'Platform Owner';
const ADMIN_ROLE = 'SUPER_ADMIN';

async function recreateSuperAdmin() {
    console.log('🔧 Recreating admin account as SUPER_ADMIN...\n');
    
    try {
        // Step 1: Find existing user
        console.log('📋 Checking for existing user...');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) throw listError;
        
        const existingUser = users.find(u => u.email === ADMIN_EMAIL);
        
        if (existingUser) {
            console.log(`✅ Found existing user: ${existingUser.email}`);
            console.log(`   User ID: ${existingUser.id}\n`);
            
            // Step 2: Delete from admins table
            console.log('🗑️  Deleting from admins table...');
            const { error: deleteAdminError } = await supabase
                .from('admins')
                .delete()
                .eq('id', existingUser.id);
            
            if (deleteAdminError) {
                console.log('⚠️  Warning deleting from admins:', deleteAdminError.message);
            } else {
                console.log('✅ Deleted from admins table');
            }
            
            // Step 3: Delete from profiles table
            console.log('\n🗑️  Deleting from profiles table...');
            const { error: deleteProfileError } = await supabase
                .from('profiles')
                .delete()
                .eq('id', existingUser.id);
            
            if (deleteProfileError) {
                console.log('⚠️  Warning deleting from profiles:', deleteProfileError.message);
            } else {
                console.log('✅ Deleted from profiles table');
            }
            
            // Step 4: Delete auth user
            console.log('\n🗑️  Deleting auth user...');
            const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(existingUser.id);
            
            if (deleteAuthError) {
                console.log('⚠️  Error deleting auth user:', deleteAuthError.message);
                throw deleteAuthError;
            } else {
                console.log('✅ Auth user deleted successfully');
            }
            
            console.log('\n✨ Old user completely removed\n');
        } else {
            console.log('ℹ️  No existing user found, will create new one\n');
        }
        
        // Step 5: Create new SUPER_ADMIN
        console.log('➕ Creating new SUPER_ADMIN account...');
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
        
        console.log(`✅ User created successfully!`);
        console.log(`   User ID: ${newUser.user.id}`);
        
        // Step 6: Add to admins table with SUPER_ADMIN role
        console.log('\n📝 Adding to admins table as SUPER_ADMIN...');
        const { data: newAdmin, error: insertError } = await supabase
            .from('admins')
            .insert({
                id: newUser.user.id,
                email: newUser.user.email,
                role: ADMIN_ROLE,
                name: ADMIN_NAME
            })
            .select()
            .single();
        
        if (insertError) {
            console.log('⚠️  Error adding to admins:', insertError.message);
            throw insertError;
        }
        
        console.log('✅ Successfully added to admins table!');
        console.log(`   Role: ${newAdmin.role}`);
        
        // Step 7: Create profile
        console.log('\n👤 Creating user profile...');
        const { error: profileError } = await supabase
            .from('profiles')
            .insert({
                id: newUser.user.id,
                name: ADMIN_NAME,
                email: ADMIN_EMAIL,
                role: 'CLIENT',
                avatar_url: null,
                profile_completion_percentage: 100
            });
        
        if (profileError) {
            console.log('⚠️  Profile creation warning:', profileError.message);
        } else {
            console.log('✅ Profile created');
        }
        
        console.log('\n🎉 SUPER_ADMIN account setup complete!\n');
        console.log('📊 Login Credentials:');
        console.log(`   Email: ${ADMIN_EMAIL}`);
        console.log(`   Password: ${ADMIN_PASSWORD}`);
        console.log(`   Role: ${ADMIN_ROLE}`);
        console.log('\n🚀 You can now login at http://localhost:5174/login\n');
        console.log('💡 After login, you should be redirected to /admin/dashboard\n');
        
        return { userId: newUser.user.id, isAdmin: true };
        
    } catch (error) {
        console.error('\n❌ Error recreating admin account:', error.message);
        console.error('Details:', error);
        throw error;
    }
}

// Run the script
recreateSuperAdmin()
    .then(() => {
        console.log('✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    });
