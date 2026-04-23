const adminClient = require('./supabase/adminClient');

async function checkSchema() {
    const { data, error } = await adminClient
        .from('profiles')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching profile:', error);
    } else {
        console.log('Columns in profiles table:', Object.keys(data[0] || {}));
    }
}

checkSchema();
