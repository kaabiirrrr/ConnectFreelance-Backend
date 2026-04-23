const adminClient = require('../supabase/adminClient');

const seedAnalytics = async () => {
    try {
        console.log('🚀 Starting Analytics Seeding...');

        // 1. Fetch Users and Jobs to make data linked
        const { data: users } = await adminClient.from('profiles').select('user_id, role');
        const { data: jobs } = await adminClient.from('jobs').select('id, client_id');

        if (!users || users.length === 0) {
            console.log('❌ No users found, skipping seeding.');
            return;
        }

        const userIds = users.map(u => u.user_id);
        const freelancerIds = users.filter(u => u.role === 'FREELANCER').map(u => u.user_id);
        const clientIds = users.filter(u => u.role === 'CLIENT').map(u => u.user_id);

        // 2. Generate Activity Logs (Visits)
        const paths = ['/', '/find-work', '/find-freelancers', '/messages', '/client/dashboard', '/profile', '/settings'];
        const logs = [];
        const now = new Date();

        for (let i = 0; i < 200; i++) {
            const randomUser = userIds[Math.floor(Math.random() * userIds.length)];
            const randomPath = paths[Math.floor(Math.random() * paths.length)];
            const randomDate = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);

            logs.push({
                user_id: randomUser,
                action_type: 'visit',
                page_path: randomPath,
                created_at: randomDate.toISOString()
            });
        }

        // 3. Generate Feature Usage
        const features = ['Post Job', 'Submit Proposal', 'Withdraw Funds', 'Message Sent', 'Profile Updated'];
        for (let i = 0; i < 100; i++) {
            const randomUser = userIds[Math.floor(Math.random() * userIds.length)];
            const randomFeature = features[Math.floor(Math.random() * features.length)];
            const randomDate = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);

            logs.push({
                user_id: randomUser,
                action_type: 'feature_use',
                feature_name: randomFeature,
                created_at: randomDate.toISOString()
            });
        }

        const { error: logError } = await adminClient.from('user_activity_logs').insert(logs);
        if (logError) throw logError;
        console.log(`✅ Seeded ${logs.length} activity logs.`);

        // 4. Generate Revenue (Payments)
        const { data: contracts } = await adminClient.from('contracts').select('id, client_id, freelancer_id');
        const payments = [];
        if (contracts && contracts.length > 0) {
            for (let i = 0; i < 20; i++) {
                const randomContract = contracts[Math.floor(Math.random() * contracts.length)];
                const randomAmount = Math.floor(Math.random() * 1000) + 100;
                const randomDate = new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);

                payments.push({
                    contract_id: randomContract.id,
                    payer_id: randomContract.client_id,
                    payee_id: randomContract.freelancer_id,
                    amount: randomAmount,
                    status: Math.random() > 0.3 ? 'released' : 'escrow',
                    currency: 'USD',
                    created_at: randomDate.toISOString()
                });
            }

            const { error: payError } = await adminClient.from('payments').insert(payments);
            if (payError) throw payError;
            console.log(`✅ Seeded ${payments.length} payment records.`);
        }

        // 5. Generate Admin Logs for "Recent Activities" (ActivityPanel)
        const adminId = '3538ce9d-f2a7-4995-8e5f-31b1c2b117a7';
        const { data: admin } = await adminClient.from('admins').select('email').eq('id', adminId).maybeSingle();
        const adminEmail = admin?.email || 'admin@freelance.com';

        const auditActions = [
            { action: 'Admin logged in', type: 'SYSTEM', desc: 'Admin session started' },
            { action: 'User verified', type: 'USER_VERIFICATION', desc: 'Verified 3 user profiles' },
            { action: 'Job approved', type: 'JOB_MODERATION', desc: 'Approved Senior React Dev job' },
            { action: 'Settings updated', type: 'SYSTEM', desc: 'Updated commission to 10%' },
            { action: 'Withdrawal processed', type: 'PAYMENT', desc: 'Approved withdrawal of $450' },
            { action: 'Dispute closed', type: 'SYSTEM', desc: 'Resolved dispute #4282' }
        ];

        const legacyLogs = [];
        const newAuditLogs = [];

        for (let i = 0; i < 15; i++) {
            const actionInfo = auditActions[Math.floor(Math.random() * auditActions.length)];
            const randomDate = new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000);

            legacyLogs.push({
                admin_id: adminId,
                admin_email: adminEmail,
                action_type: actionInfo.type,
                description: actionInfo.desc,
                created_at: randomDate.toISOString()
            });

            newAuditLogs.push({
                admin_id: adminId,
                action: actionInfo.action,
                target_type: actionInfo.type,
                details: { info: actionInfo.desc },
                created_at: randomDate.toISOString()
            });
        }

        await adminClient.from('admin_logs').insert(legacyLogs);
        await adminClient.from('admin_audit_logs').insert(newAuditLogs);
        console.log(`✅ Seeded 15 logs into both admin_logs and admin_audit_logs.`);



        console.log('✨ Seeding Completed Successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seeding Failed:', err.message);
        process.exit(1);
    }
};

seedAnalytics();
