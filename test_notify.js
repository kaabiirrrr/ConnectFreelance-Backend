const supabase = require('./supabase/client');

async function testNotification() {
    try {
        console.log("Testing notification insert...");
        // Use the freelancer ID from earlier
        const freelancerId = 'aa5251e3-3faa-4121-9276-17d71d2341e8';
        const { data, error } = await supabase
            .from('notifications')
            .insert([{
                user_id: freelancerId,
                title: 'Proposal Accepted! (Test)',
                content: `Your proposal for a test job has been accepted.`,
                type: 'PROPOSAL',
                link: '/freelancer/projects'
            }])
            .select()
            .single();
        
        if (error) {
            console.error("Supabase Error:", JSON.stringify(error, null, 2));
        } else {
            console.log("Success:", data);
        }
    } catch (e) {
        console.error("Exception:", e);
    }
}

testNotification();
