const adminClient = require('./supabase/adminClient');

async function checkColumns() {
    console.log('--- Checking profiles columns ---');
    const { data, error } = await adminClient
        .from('profiles')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching profiles:', error);
    } else {
        const row = data[0] || {};
        console.log('Profile row keys:', Object.keys(row));
        console.log('Is user_id present:', 'user_id' in row);
        console.log('Is id present:', 'id' in row);
    }
}

checkColumns();
