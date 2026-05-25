const supabase = require('./supabase/adminClient');
require('dotenv').config();

async function testUpdate() {
    try {
        const id = 'b41e26a0-9639-4be8-82ca-33a02e9a3258';
        
        console.log("Trying VERIFICATION");
        const { data, error } = await supabase
            .from('admins')
            .update({ role: 'VERIFICATION' })
            .eq('id', id)
            .select()
            .single();
            
        if (error) {
            console.error("Supabase Error:", error);
        } else {
            console.log("Update success:", data);
        }
    } catch (e) {
        console.error("Catch Error:", e);
    }
}

testUpdate();
