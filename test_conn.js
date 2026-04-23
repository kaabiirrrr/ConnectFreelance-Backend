const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

console.log('Testing connection to:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
    console.time('signInWithPassword');
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: 'sitegenius41@gmail.com',
            password: 'any-password-just-testing-connection'
        });
        console.timeEnd('signInWithPassword');
        if (error) {
            console.log('Auth Error (Expected if password wrong, but reached Supabase):', error.message);
            if (error.message.includes('fetch failed')) {
                console.error('FETCH FAILED DETECTED');
            }
        } else {
            console.log('Login Success!');
        }
    } catch (err) {
        console.timeEnd('signInWithPassword');
        console.error('Caught Exception:', err);
    }
}

test();
