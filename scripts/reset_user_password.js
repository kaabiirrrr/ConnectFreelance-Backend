require('dotenv').config();
const adminClient = require('../supabase/adminClient');
const axios = require('axios');

const EMAIL = 'rohanyp1592007@gmail.com';
const NEW_PASSWORD = 'Qw@1592007';

(async () => {
    try {
        // Find user by email
        const res = await axios.get(
            `${process.env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(EMAIL)}`,
            {
                headers: {
                    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
                }
            }
        );

        const users = res.data?.users || [];
        const user = users.find(u => u.email === EMAIL);

        if (!user) {
            console.error('User not found:', EMAIL);
            process.exit(1);
        }

        console.log('Found user:', user.id, user.email);

        // Reset password
        const update = await axios.put(
            `${process.env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
            { password: NEW_PASSWORD },
            {
                headers: {
                    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
                    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('Password reset successfully for:', EMAIL);
    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
})();
