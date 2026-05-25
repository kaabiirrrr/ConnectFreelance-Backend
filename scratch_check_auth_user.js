const adminClient = require('./supabase/adminClient');

async function checkAuth() {
    console.log('--- Querying Supabase Auth User ---');
    const { data: { user }, error } = await adminClient.auth.admin.getUserById('da8331db-b702-46f4-b880-f8ee67db50ea');

    if (error) {
        console.error('Error fetching auth user:', error);
    } else {
        console.log('Successfully fetched Auth User!');
        console.log('User Email:', user.email);
        console.log('User Metadata:', JSON.stringify(user.user_metadata, null, 2));
    }
}

checkAuth();
