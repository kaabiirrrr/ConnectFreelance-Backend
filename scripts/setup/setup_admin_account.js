/**
 * Script to create or update admin account
 * Usage: node setup_admin_account.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

// Admin credentials - CHANGE THESE IF NEEDED
const ADMIN_EMAIL = 'lets.connectbro@gmail.com';
const ADMIN_PASSWORD = 'AdminConnect41!';
const ADMIN_NAME = 'Platform Owner';
const ADMIN_ROLE = 'SUPER_ADMIN';

async function setupAdminAccount() {
    console.log('🔧 Setting up admin account...\n');
    
    try {
        // Step 1: Check if user exists in auth.users
        console.log('📋 Checking if user exists...');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) throw listError;
        
        const existingUser = users.find(u => u.email === ADMIN_EMAIL);
        
        if (existingUser) {
            console.log(`✅ User already exists: ${existingUser.email}`);
            console.log(`   User ID: ${existingUser.id}`);
            
            // Step 2: Check if already an admin
            const { data: adminRecord } = await supabase
                .from('admins')
                .select('*')
                .eq('id', existingUser.id)
                .single();
            
            if (adminRecord) {
                console.log(`✅ User is already an admin with role: ${adminRecord.role}`);
                
                // Update password
                console.log('🔄 Updating password...');
                const { error: updateError } = await supabase.auth.admin.updateUserById(existingUser.id, {
                    password: ADMIN_PASSWORD
                });
                
                if (updateError) {
                    console.log('⚠️  Failed to update password:', updateError.message);
                } else {
                    console.log('✅ Password updated successfully');
                }
                
                return { userId: existingUser.id, isAdmin: true };
            }
            
        } else {
            // Step 3: Create new user
            console.log('➕ Creating new user account...');
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
            
            existingUser = newUser.user;
        }
        
        // Step 4: Add to admins table
        console.log('\n📝 Adding user to admins table...');
        const { data: newAdmin, error: insertError } = await supabase
            .from('admins')
            .upsert({
                id: existingUser.id,
                email: existingUser.email,
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
        
        // Step 5: Create profile
        console.log('\n👤 Creating user profile...');
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: existingUser.id,
                name: ADMIN_NAME,
                email: ADMIN_EMAIL,
                role: 'CLIENT', // Admins can also be clients
                avatar_url: null,
                profile_completion_percentage: 100
            });
        
        if (profileError) {
            console.log('⚠️  Profile creation warning:', profileError.message);
        } else {
            console.log('✅ Profile created/updated');
        }
        
        console.log('\n🎉 Admin account setup complete!\n');
        console.log('📊 Login Credentials:');
        console.log(`   Email: ${ADMIN_EMAIL}`);
        console.log(`   Password: ${ADMIN_PASSWORD}`);
        console.log(`   Role: ${ADMIN_ROLE}`);
        console.log('\n🚀 You can now login at http://localhost:5174/login\n');
        
        return { userId: existingUser.id, isAdmin: true };
        
    } catch (error) {
        console.error('\n❌ Error setting up admin account:', error.message);
        console.error('Details:', error);
        throw error;
    }
}

// Run the script
setupAdminAccount()
    .then(() => {
        console.log('✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    });
