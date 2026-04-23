const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    try {
        console.log("Testing DB connection...");
        const { data: users, error: dbError } = await supabase
            .from('users')
            .select('count')
            .limit(1);

        if (dbError) {
            console.error("DB Error:", dbError.message);
        } else {
            console.log("DB connected OK. Users table exists.");
        }

        console.log("Testing Auth creation...");
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: `test_${Date.now()}@example.com`,
            password: 'Password1!',
        });

        if (authError) {
            console.error("Auth Error:", authError.message);
        } else {
            console.log("Auth User created OK:", authData.user.id);
            // clean up
            await supabase.auth.admin.deleteUser(authData.user.id);
        }
    } catch (e) {
        console.error("Exception:", e);
    }
}

test();
