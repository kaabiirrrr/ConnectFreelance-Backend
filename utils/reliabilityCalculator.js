const adminClient = require('../supabase/adminClient');

/**
 * Calculates reliability score using pre-fetched data.
 * Used for batch processing in Match Engine.
 */
const calculateReliabilityFromData = (freelancerId, logs, contracts, queryCount) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0,0,0,0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Filter logs for this specific freelancer
    const freelancerLogs = logs.filter(l => l.freelancer_id === freelancerId);
    
    // 2. Filter contracts for this specific freelancer
    const freelancerContracts = contracts.filter(c => c.freelancer_id === freelancerId);

    // 3. Process unique days
    const uniqueLoggedDays = new Set(freelancerLogs.map(l => l.date));
    const uniqueExpectedDays = new Set();
    
    // Loop through last 30 days
    for (let i = 0; i < 30; i++) {
        const currentDay = new Date();
        currentDay.setDate(currentDay.getDate() - i);
        currentDay.setHours(0, 0, 0, 0);
        
        const dayString = currentDay.toISOString().split('T')[0];

        // Check if ANY contract was active on this day
        const isActiveOnDay = freelancerContracts.some(c => {
            const start = new Date(c.start_date);
            start.setHours(0, 0, 0, 0);
            const end = c.end_date ? new Date(c.end_date) : today;
            end.setHours(0, 0, 0, 0);

            return currentDay >= start && currentDay <= end;
        });

        if (isActiveOnDay) {
            uniqueExpectedDays.add(dayString);
        }
    }

    const expectedDaysCount = uniqueExpectedDays.size;
    const loggedDaysInWindowCount = Array.from(uniqueLoggedDays).filter(d => uniqueExpectedDays.has(d)).length;
    const missedDaysCount = expectedDaysCount - loggedDaysInWindowCount;

    // 4. Final Calculation
    let score = 100;
    let isNew = false;

    if (expectedDaysCount > 0) {
        const consistency = (loggedDaysInWindowCount / expectedDaysCount) * 100;
        const penalty = (queryCount * 3) + (missedDaysCount * 5);
        score = Math.max(0, Math.min(100, Math.round(consistency - penalty)));
    } else {
        isNew = true;
        score = 100;
    }

    const stats = {
        logs: loggedDaysInWindowCount,
        missed: missedDaysCount,
        queries: queryCount || 0,
        expected: expectedDaysCount
    };

    return { score, stats, isNew };
};

/**
 * ORIGINAL FUNCTION (Stays for backward compatibility in other parts of the system)
 */
const calculateReliabilityScore = async (freelancerId) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().split('T')[0];

        const { data: logs } = await adminClient.from('work_logs')
            .select('freelancer_id, date').eq('freelancer_id', freelancerId).gte('date', thirtyDaysAgoIso).is('deleted_at', null);

        const { data: contracts } = await adminClient.from('contracts')
            .select('freelancer_id, start_date, end_date, status').eq('freelancer_id', freelancerId)
            .or(`status.eq.ACTIVE,and(status.in.(COMPLETED,CANCELLED),end_date.gte.${thirtyDaysAgoIso})`);

        const { count: queryCount } = await adminClient.from('work_log_queries')
            .select('id', { count: 'exact', head: true }).eq('freelancer_id', freelancerId).gte('created_at', thirtyDaysAgoIso);

        return calculateReliabilityFromData(freelancerId, logs || [], contracts || [], queryCount || 0);
    } catch (error) {
        console.error('[ReliabilityCalculator] Error:', error);
        return { score: 100, stats: { logs: 0, missed: 0, queries: 0, expected: 0 }, isNew: true };
    }
};

module.exports = { calculateReliabilityScore, calculateReliabilityFromData };
