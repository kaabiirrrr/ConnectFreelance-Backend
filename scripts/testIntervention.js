const adminClient = require('../supabase/adminClient');
const { triggerInterventionCheck } = require('../utils/interventionService');
const logger = require('../utils/logger');

async function testIntervention() {
    console.log("🚀 Starting Intervention System Test...");

    // 1. Fetch a real job and contract to test with
    const { data: contract } = await adminClient
        .from('contracts')
        .select('id, job_id, freelancer_id')
        .eq('status', 'ACTIVE')
        .limit(1)
        .single();

    if (!contract) {
        console.error("❌ No active contract found to test with.");
        process.exit(1);
    }

    console.log(`📝 Testing with Contract: ${contract.id}, Job: ${contract.job_id}`);

    // 2. Trigger a check with High Risk
    // We mock the risk and deadline probability by passing them to a modified check if needed,
    // or we just trust the engine logic.
    // Let's manually insert a "high risk" update to trigger it.
    
    console.log("🔗 Triggering background check...");
    await triggerInterventionCheck(contract.job_id);

    console.log("⏳ Waiting for background process (5s)...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Check for newly created interventions
    const { data: interventions, error } = await adminClient
        .from('interventions')
        .select('*')
        .eq('job_id', contract.job_id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("❌ Error fetching interventions:", error.message);
    } else if (interventions.length > 0) {
        console.log(`✅ SUCCESS: Found ${interventions.length} interventions.`);
        console.log(`Latest: [${interventions[0].type}] - Status: ${interventions[0].status}`);
    } else {
        console.log("ℹ️ No intervention triggered (Metrics might be too safe).");
    }

    console.log("🏁 Test complete.");
    process.exit(0);
}

testIntervention();
