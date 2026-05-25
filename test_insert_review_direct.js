const adminClient = require('./supabase/adminClient');

async function test() {
    // Let's grab the first contract ID and user IDs
    const { data: contracts } = await adminClient
        .from('contracts')
        .select('id, client_id, freelancer_id')
        .limit(1);
    
    if (!contracts || contracts.length === 0) {
        console.error('No contracts found');
        return;
    }
    
    const contract = contracts[0];
    console.log('Testing with contract:', contract);
    
    // Attempt to insert a review directly
    const { data, error } = await adminClient
        .from('reviews')
        .insert([{
            reviewer_id: contract.client_id,
            reviewee_id: contract.freelancer_id,
            contract_id: contract.id,
            rating: 5,
            comment: 'Test review trigger'
        }]);
    
    if (error) {
        console.error('Error inserting review:', error);
    } else {
        console.log('Insert review succeeded! Result:', data);
        
        // Clean up
        const { error: delErr } = await adminClient
            .from('reviews')
            .delete()
            .eq('contract_id', contract.id)
            .eq('reviewer_id', contract.client_id);
        console.log('Cleaned up review:', !delErr);
    }
}

test();
