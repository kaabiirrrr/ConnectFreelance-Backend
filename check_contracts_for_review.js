const adminClient = require('./supabase/adminClient');

async function test() {
    const { data: contracts, error } = await adminClient
        .from('contracts')
        .select('id, client_id, freelancer_id, status')
        .limit(10);
    
    if (error) {
        console.error('Error fetching contracts:', error);
    } else {
        console.log('Contracts:', contracts);
    }
}
test();
