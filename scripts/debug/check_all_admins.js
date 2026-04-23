/**
 * Script to check and clean up admin records
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function checkAdmins() {
    console.log('🔍 Checking admin records...\n');
    
    try {
        // Get all admins
        const { data: admins, error } = await supabase
            .from('admins')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        console.log(`📊 Found ${admins?.length || 0} admin records:\n`);
        
        if (!admins || admins.length === 0) {
            console.log('❌ No admin records found!');
            return;
        }
        
        admins.forEach((admin, index) => {
            console.log(`${index + 1}. Email: ${admin.email}`);
            console.log(`   ID: ${admin.id}`);
            console.log(`   Role: ${admin.role}`);
            console.log(`   Name: ${admin.name || 'N/A'}`);
            console.log(`   Created: ${admin.created_at}\n`);
        });
        
        // Check for duplicates
        const emailCounts = {};
        admins.forEach(admin => {
            emailCounts[admin.email] = (emailCounts[admin.email] || 0) + 1;
        });
        
        const duplicates = Object.entries(emailCounts)
            .filter(([email, count]) => count > 1);
        
        if (duplicates.length > 0) {
            console.log('⚠️  WARNING: Duplicate admin emails found!\n');
            duplicates.forEach(([email, count]) => {
                console.log(`   ${email}: ${count} records`);
            });
            console.log('\n💡 Recommendation: Remove duplicate records\n');
        } else {
            console.log('✅ No duplicate emails found\n');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Details:', error);
    }
}

checkAdmins();
