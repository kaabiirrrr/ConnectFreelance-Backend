const supabase = require('./supabase/client');

async function listUsers() {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) console.error(error);
    else {
        console.log('Supabase Auth Users:');
        users.forEach(u => console.log(`- ${u.email} (ID: ${u.id})`));
    }
}

listUsers();
