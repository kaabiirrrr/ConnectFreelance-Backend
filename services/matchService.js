const adminClient = require('../supabase/adminClient');
const { calculateReliabilityFromData } = require('../utils/reliabilityCalculator');
const { predictRisk } = require('../utils/riskPredictor');
const Groq = require('groq-sdk');
const logger = require('../utils/logger');
const crypto = require('crypto');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MAX_PROPOSALS_PER_RECALC = 200; // Scalability safety ceiling

/**
 * Enterprise AI Smart Matching Engine (v2.2 - Final Polish Edition)
 * Complexity: O(1) Database Queries | O(N) In-Memory Processing
 */
class MatchService {
    constructor() {
        this.recomputeLock = new Set();
    }

    /**
     * Invalidate cache for a specific role (Event-driven)
     */
    async invalidateRoleCache(roleId) {
        logger.info(`[MatchEngine] Marking role for recompute: ${roleId}`);
        // Instead of hard delete, we update existing or insert a placeholder
        // to tell the UI "AI is working..."
        await adminClient.from('matching_cache')
            .update({ is_recomputing: true })
            .eq('role_id', roleId);
    }

    /**
     * Invalidate cache for a specific freelancer across all roles
     */
    async invalidateFreelancerCache(freelancerId) {
        logger.info(`[MatchEngine] Invalidating cache for freelancer: ${freelancerId}`);
        await adminClient.from('matching_cache').delete().eq('freelancer_id', freelancerId);
    }

    /**
     * Bulk recalculate matches for a role with high efficiency and resilience.
     */
    async recalculateRoleMatches(roleId) {
        if (this.recomputeLock.has(roleId)) return;
        this.recomputeLock.add(roleId);

        try {
            logger.info(`[MatchEngine] Starting batch recompute for role: ${roleId}`);

            // 1. Fetch Role Constraints & Version Hash (Security/Integrity)
            const { data: role } = await adminClient
                .from('job_roles')
                .select('budget, skills, job_id, updated_at')
                .eq('id', roleId)
                .single();

            if (!role) {
                logger.warn(`[MatchEngine] Recalculate aborted: Role ${roleId} not found. It may have been deleted.`);
                return;
            }

            // Version hash derived from role update time to ensure cache integrity
            const versionHash = crypto.createHash('md5').update(role.updated_at).digest('hex').substring(0, 8);

            // 2. Fetch Proposals with Scalability Limit (Top 200 latest/pending)
            const { data: proposals } = await adminClient
                .from('proposals')
                .select('id, freelancer_id, proposed_rate, status, created_at')
                .eq('role_id', roleId)
                .is('status', 'PENDING')
                .order('created_at', { ascending: false })
                .limit(MAX_PROPOSALS_PER_RECALC);

            if (!proposals || proposals.length === 0) return;

            const freelancerIds = [...new Set(proposals.map(p => p.freelancer_id))];
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().split('T')[0];

            // 3. --- RESILIENT BATCH DATA FETCHING (allSettled) ---
            const fetchResults = await Promise.allSettled([
                adminClient.from('profiles').select('user_id, name, skills').in('user_id', freelancerIds),
                adminClient.from('contracts').select('id, freelancer_id, start_date, end_date, status').in('freelancer_id', freelancerIds),
                adminClient.from('work_logs').select('freelancer_id, date').in('freelancer_id', freelancerIds).gte('date', thirtyDaysAgoIso).is('deleted_at', null),
                adminClient.from('work_log_queries').select('freelancer_id, created_at').in('freelancer_id', freelancerIds).gte('created_at', thirtyDaysAgoIso)
            ]);

            // Safe unpacking of settled results
            const profilesData = fetchResults[0].status === 'fulfilled' ? fetchResults[0].value.data : [];
            const contractsData = fetchResults[1].status === 'fulfilled' ? fetchResults[1].value.data : [];
            const logsData = fetchResults[2].status === 'fulfilled' ? fetchResults[2].value.data : [];
            const queriesData = fetchResults[3].status === 'fulfilled' ? fetchResults[3].value.data : [];

            if (fetchResults.some(r => r.status === 'rejected')) {
                logger.warn('[MatchEngine] Some batch queries failed. Proceeding with partial data.', {
                    failures: fetchResults.filter(r => r.status === 'rejected').map(r => r.reason)
                });
            }

            // Transform batches into lookup maps
            const profileMap = new Map((profilesData || []).map(p => [p.user_id, p]));
            const contractMap = new Map();
            const logMap = new Map();
            const queryCountMap = new Map();

            (contractsData || []).forEach(c => {
                if (!contractMap.has(c.freelancer_id)) contractMap.set(c.freelancer_id, []);
                contractMap.get(c.freelancer_id).push(c);
            });

            (logsData || []).forEach(l => {
                if (!logMap.has(l.freelancer_id)) logMap.set(l.freelancer_id, []);
                logMap.get(l.freelancer_id).push(l);
            });

            (queriesData || []).forEach(q => {
                queryCountMap.set(q.freelancer_id, (queryCountMap.get(q.freelancer_id) || 0) + 1);
            });

            // 4. --- EXECUTE WINSORIZED PRICING --
            const bids = proposals.map(p => p.proposed_rate).sort((a, b) => a - b);
            const p10Index = Math.max(0, Math.floor(bids.length * 0.1));
            const effectiveMin = bids[p10Index];

            // 5. --- IN-MEMORY SCORE COMPUTATION ---
            const results = proposals.map(proposal => {
                const fId = proposal.freelancer_id;
                const profile = profileMap.get(fId);
                const fContracts = contractMap.get(fId) || [];
                const fLogs = logMap.get(fId) || [];
                const fQueries = queryCountMap.get(fId) || 0;

                const { score: reliability, stats } = calculateReliabilityFromData(fId, fLogs, fContracts, fQueries);
                const { riskScore } = predictRisk(reliability, stats);
                const riskInverted = 100 - riskScore;

                const totalCStr = fContracts.length || 0;
                const completedCStr = fContracts.filter(c => c.status === 'COMPLETED').length || 0;
                const completionRate = totalCStr === 0 ? 100 : Math.round((completedCStr / totalCStr) * 100);

                const requiredSkills = role.skills || [];
                const profileSkills = profile?.skills || [];
                const intersection = requiredSkills.filter(s => profileSkills.some(ps => ps.toLowerCase() === s.toLowerCase()));
                const skillsMatchPct = requiredSkills.length === 0 ? 100 : (intersection.length / requiredSkills.length) * 100;

                const priceScore = Math.min(100, Math.round((effectiveMin / proposal.proposed_rate) * 100));

                const matchScore = Math.round(
                    (reliability * 0.30) +
                    (completionRate * 0.20) +
                    (skillsMatchPct * 0.20) +
                    (riskInverted * 0.20) +
                    (priceScore * 0.10)
                );

                const confidence = Math.min(1, parseFloat(((stats.logs / 30) * 0.5 + (totalCStr / 10) * 0.5).toFixed(2)));

                // Composite cache key incorporating version for anti-collision
                const cacheKeyBase = `role_${roleId}_v_${versionHash}`;
                const inputSnapshot = `${matchScore}-${reliability}-${riskScore}-${priceScore}-${effectiveMin}`;
                const recalcKey = crypto.createHash('md5').update(`${cacheKeyBase}_${inputSnapshot}`).digest('hex');

                return {
                    proposal_id: proposal.id,
                    role_id: roleId,
                    freelancer_id: fId,
                    match_score: matchScore,
                    reliability_score: reliability,
                    risk_score: riskScore,
                    completion_rate: completionRate,
                    skills_match: skillsMatchPct,
                    price_score: priceScore,
                    confidence_score: confidence,
                    recalc_key: recalcKey,
                    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                    freelancer_name: profile?.name || 'Freelancer',
                    bid: proposal.proposed_rate,
                    role_budget: role.budget
                };
            });

            // 6. --- RESILIENT BATCH CACHE UPSERT ---
            for (const res of results) {
                const { data: existing } = await adminClient.from('matching_cache')
                    .select('recalc_key').eq('proposal_id', res.proposal_id).maybeSingle();

                if (existing?.recalc_key === res.recalc_key) continue;

                await adminClient.from('matching_cache').upsert({
                    proposal_id: res.proposal_id,
                    role_id: res.role_id,
                    freelancer_id: res.freelancer_id,
                    match_score: res.match_score,
                    reliability_score: res.reliability_score,
                    risk_score: res.risk_score,
                    completion_rate: res.completion_rate,
                    skills_match: res.skills_match,
                    price_score: res.price_score,
                    confidence_score: res.confidence_score,
                    recalc_key: res.recalc_key,
                    expires_at: res.expires_at,
                    is_recomputing: false, // Reset flag
                    updated_at: new Date().toISOString()
                }, { onConflict: 'proposal_id' });

                this.generateAISummary(res);
            }

            logger.info(`[MatchEngine] Successfully recomputed ${results.length} proposals for role ${roleId}`);

        } catch (err) {
            logger.error('[MatchEngine] Fatal Batch Error:', err);
        } finally {
            this.recomputeLock.delete(roleId);
        }
    }

    /**
     * AI Qualitative Review (Background Job)
     */
    async generateAISummary(data) {
        if (!process.env.GROQ_API_KEY) return;
        try {
            const systemPrompt = `Analyze freelancer match. Score: ${data.match_score}%. Bid: ${data.bid}. Role Budget: ${data.role_budget}. Reliability: ${data.reliability_score}. Respond ONLY JSON: { "summary": "brief point", "verdict": "string" }`;
            const completion = await groq.chat.completions.create({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'system', content: systemPrompt }],
                response_format: { type: "json_object" }
            });
            const result = JSON.parse(completion.choices[0].message.content);
            await adminClient.from('matching_cache').update({ ai_summary: result.summary, ai_verdict: result.verdict }).eq('proposal_id', data.proposal_id);
        } catch (err) {
            logger.error('[MatchEngine] AI Sync Error:', err.message);
        }
    }
}

module.exports = new MatchService();
