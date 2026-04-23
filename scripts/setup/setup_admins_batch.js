const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

const adminsToSetup = [
    {
        email: 'kabirmore8904@gmail.com',
        password: 'Connect41',
        role: 'SUPER_ADMIN'
    },
    {
        email: 'samarthshendge20@gmail.com',
        password: 'Connect123!',
        role: 'ADMIN'
    },
    {
        email: 'rohanyp1592007@gmail.com',
        password: 'Connect123!',
        role: 'ADMIN'
    }
];

async function setupAdmins() {
    console.log('--- Starting Batch Admin Setup ---');

    // 1. Get ALL users to find them reliably
    let allUsers = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const { data: { users }, error, nextPage } = await supabase.auth.admin.listUsers({
            page,
            perPage: 1000
        });
        if (error) throw error;
        allUsers = allUsers.concat(users);
        if (users.length < 1000) hasMore = false;
        page++;
    }

    console.log(`Found ${allUsers.length} total users in Auth.`);

    for (const target of adminsToSetup) {
        try {
            console.log(`\nProcessing: ${target.email}...`);

            let user = allUsers.find(u => u.email.toLowerCase() === target.email.toLowerCase());
            let userId;

            if (!user) {
                console.log(`User ${target.email} not found in Auth. Creating...`);
                // double check in case of race condition or delay
                const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                    email: target.email,
                    password: target.password,
                    email_confirm: true
                });
                
                if (createError) {
                    if (createError.message.includes('already been registered')) {
                        console.log('User registered in the meantime. Retrying lookup...');
                        // This shouldn't happen with paginated list, but just in case
                        const { data: { users: retryUsers } } = await supabase.auth.admin.listUsers();
                        user = retryUsers.find(u => u.email.toLowerCase() === target.email.toLowerCase());
                        if (!user) throw new Error('User still not found after separate creation attempt logic.');
                        userId = user.id;
                    } else {
                        throw createError;
                    }
                } else {
                    userId = newUser.user.id;
                    console.log(`Created new user with ID: ${userId}`);
                }
            } else {
                userId = user.id;
                console.log(`User exists with ID: ${userId}. Updating password...`);
                const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
                    password: target.password
                });
                if (updateError) throw updateError;
            }

            // 2. Remove from conflicting tables (profiles, users)
            console.log(`Cleaning up legacy data for ${userId}...`);
            const { error: pDel } = await supabase.from('profiles').delete().eq('user_id', userId);
            const { error: uDel } = await supabase.from('users').delete().eq('id', userId);
            if (pDel) console.warn('Warning: profile deletion error:', pDel.message);
            if (uDel) console.warn('Warning: user deletion error:', uDel.message);

            // 3. Upsert into admins table
            console.log(`Registering as ${target.role} in admins table...`);
            const { error: adminError } = await supabase
                .from('admins')
                .upsert({
                    id: userId,
                    email: target.email,
                    role: target.role
                });

            if (adminError) throw adminError;

            console.log(`Successfully set up ${target.email} as ${target.role}.`);

        } catch (error) {
            console.error(`Error processing ${target.email}:`, error.message);
        }
    }

    console.log('\n--- Batch Admin Setup Complete ---');
}

setupAdmins();
