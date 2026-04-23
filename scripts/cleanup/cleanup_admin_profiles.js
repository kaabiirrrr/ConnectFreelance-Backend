/**
 * CRITICAL FIX: Remove admin profiles from profiles table
 * This ensures admins are ONLY in the admins table
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function cleanupAdminProfiles() {
    console.log('🔧 Cleaning up admin profiles from profiles table...\n');
    
    try {
        // Find all admins
        const { data: admins } = await supabase
            .from('admins')
            .select('id, email, role');
        
        if (!admins || admins.length === 0) {
            console.log('❌ No admins found!');
            return;
        }
        
        console.log(`📊 Found ${admins.length} admin(s):\n`);
        admins.forEach(admin => {
            console.log(`   - ${admin.email} (${admin.role})`);
        });
        console.log('');
        
        // Delete each admin from profiles table
        let deletedCount = 0;
        for (const admin of admins) {
            console.log(`🗑️  Deleting ${admin.email} from profiles table...`);
            
            const { error } = await supabase
                .from('profiles')
                .delete()
                .eq('id', admin.id);
            
            if (error) {
                console.log(`   ⚠️  Error: ${error.message}`);
            } else {
                console.log(`   ✅ Deleted successfully`);
                deletedCount++;
            }
        }
        
        console.log(`\n🎉 Cleanup complete! Removed ${deletedCount}/${admins.length} admin profiles.`);
        console.log('\n💡 Admins will now be properly detected via admins table only.\n');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        throw error;
    }
}

cleanupAdminProfiles()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
