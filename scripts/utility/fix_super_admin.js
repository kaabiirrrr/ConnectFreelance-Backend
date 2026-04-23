/**
 * Script to fix admin account - ensure it's SUPER_ADMIN
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

async function fixSuperAdmin() {
    console.log('🔧 Fixing admin account to ensure SUPER_ADMIN role...\n');
    
    try {
        // Step 1: Find existing user
        console.log('📋 Checking for existing user...');
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        
        if (listError) throw listError;
        
        const existingUser = users.find(u => u.email === ADMIN_EMAIL);
        
        if (!existingUser) {
            console.log('❌ User not found. Please create the account first.\n');
            return;
        }
        
        console.log(`✅ Found user: ${existingUser.email}`);
        console.log(`   User ID: ${existingUser.id}\n`);
        
        // Step 2: Update password
        console.log('🔄 Updating password...');
        const { error: updateAuthError } = await supabase.auth.admin.updateUserById(existingUser.id, {
            password: ADMIN_PASSWORD
        });
        
        if (updateAuthError) {
            console.log('⚠️  Warning updating password:', updateAuthError.message);
        } else {
            console.log('✅ Password updated successfully');
        }
        
        // Step 3: Check admins table
        console.log('\n📝 Checking admins table...');
        const { data: adminData } = await supabase
            .from('admins')
            .select('*')
            .eq('id', existingUser.id);
        
        if (adminData && adminData.length > 0) {
            console.log(`✅ User exists in admins table with role: ${adminData[0].role}`);
            
            // Update to SUPER_ADMIN if different
            if (adminData[0].role !== ADMIN_ROLE) {
                console.log(`🔄 Updating role from ${adminData[0].role} to ${ADMIN_ROLE}...`);
                const { error: updateRoleError } = await supabase
                    .from('admins')
                    .update({ 
                        role: ADMIN_ROLE,
                        name: ADMIN_NAME,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', existingUser.id);
                
                if (updateRoleError) {
                    console.log('⚠️  Error updating role:', updateRoleError.message);
                } else {
                    console.log('✅ Role updated to SUPER_ADMIN');
                }
            } else {
                console.log('✅ Role is already SUPER_ADMIN');
            }
        } else {
            console.log('➕ Adding user to admins table...');
            const { error: insertError } = await supabase
                .from('admins')
                .insert({
                    id: existingUser.id,
                    email: existingUser.email,
                    role: ADMIN_ROLE,
                    name: ADMIN_NAME
                });
            
            if (insertError) {
                console.log('⚠️  Error adding to admins:', insertError.message);
                throw insertError;
            }
            console.log('✅ Added to admins table as SUPER_ADMIN');
        }
        
        // Step 4: Check profiles table
        console.log('\n👤 Checking profiles table...');
        const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', existingUser.id);
        
        if (!profileData || profileData.length === 0) {
            console.log('➕ Creating profile...');
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: existingUser.id,
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
        } else {
            console.log('✅ Profile already exists');
        }
        
        console.log('\n🎉 SUPER_ADMIN account verified!\n');
        console.log('📊 Login Credentials:');
        console.log(`   Email: ${ADMIN_EMAIL}`);
        console.log(`   Password: ${ADMIN_PASSWORD}`);
        console.log(`   Role: ${ADMIN_ROLE}`);
        console.log('\n🚀 You can now login at http://localhost:5174/login\n');
        console.log('💡 After login, you should be redirected to /admin/dashboard\n');
        
        return { userId: existingUser.id, isAdmin: true };
        
    } catch (error) {
        console.error('\n❌ Error fixing admin account:', error.message);
        console.error('Details:', error);
        throw error;
    }
}

// Run the script
fixSuperAdmin()
    .then(() => {
        console.log('✅ Script completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Script failed:', error.message);
        process.exit(1);
    });
