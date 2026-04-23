const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function checkProfiles() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, serviceKey);

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .limit(1);
        
        if (error) {
            console.error('Error fetching profiles:', error.message);
            return;
        }

        console.log('Sample Profile Data:');
        console.log(JSON.stringify(data[0], null, 2));

        // Check columns specifically
        const { data: cols, error: colError } = await supabase.rpc('get_column_names', { table_name: 'profiles' });
        if (colError) {
             // Fallback: check keys in data
             console.log('Available columns in profiles:', Object.keys(data[0]));
        } else {
             console.log('Columns:', cols);
        }

    } catch (error) {
        console.error('Fatal error:', error.message);
    }
}

checkProfiles();
