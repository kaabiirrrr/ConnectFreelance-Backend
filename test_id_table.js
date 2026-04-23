const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function test() {
    const { data, error } = await supabase.from('identity_verifications').select('*').limit(1);
    console.log("Error:", error);
    console.log("Data:", data);
}
test();
