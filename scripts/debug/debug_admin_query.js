const supabase = require('./supabase/client');

async function debug() {
    const email = 'lets.connectbro@gmail.com';
    console.log(`Checking admins table for: "${email}"`);
    
    const { data, error } = await supabase
        .from('admins')
        .select('*')
        .ilike('email', email);
    
    console.log('Data:', JSON.stringify(data, null, 2));
    console.log('Error:', error);
    
    if (data && data.length > 0) {
        console.log('✅ Admin found!');
    } else {
        console.log('❌ Admin NOT found!');
    }
    
    // Check if there are any admins at all
    const { data: allAdmins } = await supabase.from('admins').select('email');
    console.log('All admin emails:', allAdmins);
}

debug();
