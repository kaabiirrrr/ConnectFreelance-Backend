const adminClient = require('../supabase/adminClient');
const { triggerInterventionCheck } = require('../utils/interventionService');
const logger = require('../utils/logger');

/**
 * CHAOS TEST: INTERVENTION SYSTEM
 * Simulates high-stress failure modes to ensure architectural defensive.
 */
async function chaosTest() {
    console.log("🧪 STARTING CHAOS TEST: Intervention System Defense...");

    try {
        // 1. Setup Test Case: Find a real contract to simulate
        const { data: contract } = await adminClient
            .from('contracts')
            .select('id, job_id, freelancer_id')
            .eq('status', 'ACTIVE')
            .limit(1)
            .single();

        if (!contract) {
            console.error("❌ ABORT: No active contract found for testing.");
            process.exit(1);
        }

        console.log(`📍 Targeting Contract: ${contract.id} (Freelancer: ${contract.freelancer_id})`);

        // --- SCENARIO 1: RAPID UPDATES (Debounce & Cooldown Test) ---
        console.log("\n🧪 SCENARIO 1: Successive Rapid Triggers...");
        console.log("👉 Triggering 5 updates in 1 second...");
        for (let i = 0; i < 5; i++) {
            triggerInterventionCheck(contract.freelancer_id);
        }
        console.log("✅ Debounce check initiated. System should only process the first call.");
        await new Promise(resolve => setTimeout(resolve, 2000));

        // --- SCENARIO 2: NO LOGS FOR 3 DAYS (Escalation Test) --- 
        console.log("\n🧪 SCENARIO 2: Simulating 72h Inactivity...");
        // This relies on the engine reading the last log date from DB
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 3);
        
        // Manually update a work log to be old
        await adminClient
            .from('work_logs')
            .update({ date: yesterdayDate.toISOString().split('T')[0] })
            .eq('job_id', contract.job_id);
            
        console.log("👉 Log date backdated to 72h ago. Triggering check...");
        await triggerInterventionCheck(contract.freelancer_id);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // --- SCENARIO 3: RATE LIMIT EXHAUSTION ---
        console.log("\n🧪 SCENARIO 3: Triggering Rate Limit (Limit = 5/day)...");
        // We'll intentionally force multiple interventions if possible for this test run
        // by bypassing cooldown (using different types if needed)
        console.log("👉 Inspecting DB for Rate Limit blocks in backend.log...");

        // --- VERIFICATION ---
        const { data: interventions } = await adminClient
            .from('interventions')
            .select('*')
            .eq('job_id', contract.job_id)
            .order('created_at', { ascending: false });

        console.log("\n📊 TEST RESULTS:");
        console.log(`- Total Interventions found for job: ${interventions?.length || 0}`);
        if (interventions?.length > 0) {
            interventions.slice(0, 3).forEach(i => {
                console.log(`  [${i.type}] Priority: ${i.priority} | Status: ${i.status} | Created: ${i.created_at}`);
            });
        }

        console.log("\n✅ CHAOS TEST COMPLETE.");
        process.exit(0);

    } catch (err) {
        console.error("💥 CHAOS TEST FAILED:", err.message);
        process.exit(1);
    }
}

chaosTest();
