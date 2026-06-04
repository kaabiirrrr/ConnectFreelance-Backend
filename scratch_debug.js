const adminClient = require('./supabase/adminClient');
const logger = require('./utils/logger');

async function testWorkspaceData() {
    const jobId = '5b7ec13c-909e-45b0-a83b-8a054c0d7ca8';
    const userId = '8272917d-d670-4977-8251-06cb2b1c4098'; // Client ID
    console.log('=== RUNNING WORKSPACE DATA DIAGNOSTIC ===');

    // 1. Fetch job members
    let membersRaw = [];
    try {
        const { data, error } = await adminClient
            .from('job_members')
            .select('*')
            .eq('job_id', jobId)
            .eq('status', 'active');
        
        console.log('1. job_members from DB:', data);
        if (error) console.error('job_members error:', error);
        membersRaw = data || [];
    } catch (e) {
        console.error('job_members fetch crash', e);
    }

    // 2. Fetch profiles
    const userIds = membersRaw.map(m => m.user_id);
    console.log('User IDs in workspace:', userIds);
    let profiles = [];
    if (userIds.length > 0) {
        try {
            const { data: profileData, error: pErr } = await adminClient
                .from('profiles')
                .select('user_id, name, avatar_url')
                .in('user_id', userIds);
            console.log('2. profiles from DB:', profileData);
            if (pErr) console.error('profiles error:', pErr);
            profiles = profileData || [];
        } catch (e) {
            console.error('profiles fetch crash', e);
        }
    }

    const members = membersRaw.map(m => ({
        ...m,
        profile: profiles.find(p => p.user_id === m.user_id) || null
    }));
    console.log('3. Resulting members array:', JSON.stringify(members, null, 2));

    // 3. Deliveries
    try {
        const { data: deliveries, error: delError } = await adminClient
            .from('deliveries')
            .select('id, status, freelancer_id')
            .eq('job_id', jobId);
        console.log('4. Deliveries count:', deliveries?.length || 0);
        if (delError) console.error('deliveries error:', delError);
    } catch (e) {
        console.error('deliveries fetch crash', e);
    }
}

testWorkspaceData();
