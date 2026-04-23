const supabase = require('./supabase/client');

async function checkRoles() {
    const { data: users, error: userError } = await supabase.from('users').select('id, email, role');
    const { data: admins, error: adminError } = await supabase.from('admins').select('id, role');

    if (userError) console.error('User Error:', userError);
    if (adminError) console.error('Admin Error:', adminError);

    console.log('--- Users Table ---');
    users?.forEach(u => console.log(`${u.email} (ID: ${u.id}) -> Role: ${u.role}`));

    console.log('--- Admins Table ---');
    admins?.forEach(a => {
        const user = users?.find(u => u.id === a.id);
        console.log(`${user ? user.email : a.id} (ID: ${a.id}) -> Admin Role: ${a.role}`);
    });
}

checkRoles();
