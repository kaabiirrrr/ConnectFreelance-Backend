const supabase = require('./supabase/client');

async function testSignup() {
    const email = `test_${Date.now()}@example.com`;
    const password = 'Password123!';

    console.log('Testing signUp with email:', email);
    const { data, error } = await supabase.auth.signUp({ email, password });
    console.log('Data:', JSON.stringify(data?.user?.id));
    console.log('Error:', JSON.stringify(error));
}

testSignup();
