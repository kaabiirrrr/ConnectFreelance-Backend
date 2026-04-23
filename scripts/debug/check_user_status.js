const supabase = require('./supabase/client');

async function checkUser() {
    const email = 'moresamrat822@gmail.com';
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            console.log(`User ${email} NOT found in public.users table.`);
        } else {
            console.error('Error checking user:', error);
        }
    } else {
        console.log('User found in public.users:', data);
    }

    const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
    if (authError) {
        console.error('Error listing auth users:', authError);
    } else {
        const authUser = authData.users.find(u => u.email === email);
        if (authUser) {
            console.log('User found in Supabase Auth:', authUser.id);
        } else {
            console.log('User NOT found in Supabase Auth.');
        }
    }
}

checkUser();
