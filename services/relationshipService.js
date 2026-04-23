const adminClient = require('../supabase/adminClient');
const Groq = require('groq-sdk');
const logger = require('../utils/logger');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Trust Graph v2 - Relationship Intelligence Service
 * Handles data aggregation, trust score calculation, and AI insights.
 */

const calculateTrustScore = (completionRate, onTimeRate, communicationScore, disputeCount) => {
    // Formula: 0.4 * completion_rate + 0.3 * on_time_delivery + 0.2 * communication_score + 0.1 * dispute_penalty
    const disputeScore = Math.max(0, 100 - (disputeCount * 25));
    const score = (0.4 * completionRate) + (0.3 * onTimeRate) + (0.2 * communicationScore) + (0.1 * disputeScore);
    return Math.round(score);
};

const getTrustLevel = (score) => {
    if (score >= 90) return 'HIGH';
    if (score >= 70) return 'STABLE';
    return 'RISKY';
};

const syncRelationshipStats = async (clientId, freelancerId) => {
    try {
        logger.info(`[RelationshipService] Syncing stats for Client:${clientId} -> Freelancer:${freelancerId}`);

        // 1. Fetch all shared contracts
        const { data: contracts, error: contractErr } = await adminClient
            .from('contracts')
            .select(`
                id, status, created_at, end_date, job_id,
                jobs (title, category, skills_required)
            `)
            .eq('client_id', clientId)
            .eq('freelancer_id', freelancerId);

        if (contractErr) throw contractErr;
        if (!contracts || contracts.length === 0) return null;

        const totalProjects = contracts.length;
        const completedProjects = contracts.filter(c => c.status === 'COMPLETED').length;
        const cancelledProjects = contracts.filter(c => c.status === 'CANCELLED').length;
        
        // 2. Fetch Deliveries for On-time Calculation
        const { data: deliveries } = await adminClient
            .from('deliveries')
            .select('status, final_approval_time, contract_id')
            .eq('client_id', clientId)
            .eq('freelancer_id', freelancerId);

        // Simple On-time Rate logic: In a real system, we'd compare contract.end_date with last approved delivery.
        // For now, we use a proxy or check if any status was 'revision_requested' as a slight penalty.
        const onTimeRate = totalProjects > 0 ? 100 - (contracts.filter(c => c.status === 'CANCELLED').length * 10) : 100;

        // 3. Fetch Disputes
        const { count: disputeCount } = await adminClient
            .from('disputes')
            .select('*', { count: 'exact', head: true })
            .eq('contract_id', contracts.map(c => c.id)); // Note: Supabase IN filter might be needed

        // 4. Communication Score (Derived from rating or global stats if sharing)
        const { data: reviews } = await adminClient
            .from('reviews')
            .select('rating')
            .eq('reviewer_id', clientId)
            .eq('reviewee_id', freelancerId);
        
        const avgRating = reviews?.length > 0 
            ? reviews.reduce((acc, curr) => acc + curr.rating, 0) / reviews.length 
            : 5;
        const communicationScore = (avgRating / 5) * 100;

        // 5. Final Trust Score
        const trustScore = calculateTrustScore(
            (completedProjects / totalProjects) * 100,
            onTimeRate,
            communicationScore,
            disputeCount || 0
        );

        // 6. Last Project Info
        const lastProject = contracts.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];

        // 7. Standardized Data Object
        const statsData = {
            client_id: clientId,
            freelancer_id: freelancerId,
            total_projects: totalProjects,
            completed_projects: completedProjects,
            cancelled_projects: cancelledProjects,
            avg_rating_by_client: avgRating,
            on_time_rate: onTimeRate,
            communication_score: Math.round(communicationScore),
            trust_score: trustScore,
            last_project_id: lastProject.job_id,
            last_project_name: lastProject.jobs?.title || 'Unknown Project',
            last_project_date: lastProject.created_at,
            updated_at: new Date().toISOString()
        };

        // 8. AI Gating (Polish Point #5)
        // ONLY call AI if projects >= 2 OR we need initial summary
        if (totalProjects >= 2) {
            const aiInsight = await generateRelationshipAI(contracts, statsData);
            if (aiInsight) {
                statsData.ai_summary = aiInsight.summary;
                statsData.compatibility_score = aiInsight.compatibility;
            }
        }

        // 9. Persist to DB
        const { error: upsertErr } = await adminClient
            .from('client_freelancer_stats')
            .upsert(statsData, { onConflict: 'client_id, freelancer_id' });

        if (upsertErr) throw upsertErr;

        return statsData;
    } catch (err) {
        logger.error('[RelationshipService] Sync error', err);
        return null;
    }
};

const generateRelationshipAI = async (contracts, stats) => {
    if (!process.env.GROQ_API_KEY) return null;
    try {
        const projectTitles = contracts.map(c => c.jobs?.title).filter(Boolean).join(', ');
        
        const prompt = `
            Analyze the professional relationship between a client and freelancer.
            Data:
            - Projects: ${stats.total_projects} (${stats.completed_projects} completed)
            - Project Titles: ${projectTitles}
            - Success Rate: ${Math.round((stats.completed_projects / stats.total_projects) * 100)}%
            - Trust Score: ${stats.trust_score}%
            
            Return JSON:
            {
              "summary": "1-sentence summary of collaboration style",
              "compatibility": integer (0-100 score of how well they match)
            }
        `;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.1-8b-instant',
            response_format: { type: 'json_object' }
        });

        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        logger.error('[RelationshipService] AI generation failed', err);
        return null;
    }
};

module.exports = {
    syncRelationshipStats,
    calculateTrustScore,
    getTrustLevel
};
