const supabase = require('./supabase/client');

async function testInsert() {
    console.log('--- Testing Manual Insert into Users ---');
    const { data, error } = await supabase
        .from('users')
        .insert([{ id: '73a517ea-a1d4-45cf-bf38-a1abf143803e', email: 'kabirmore8904@gmail.com', role: 'FREELANCER' }]);

    if (error) {
        console.error('Insert Error:', error);
    } else {
        console.log('Insert Success:', data);
    }
}

testInsert();
