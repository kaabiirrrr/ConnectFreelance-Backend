const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');

/**
 * ══════════════════════════════════════════════════════
 *  AI Job Recommendation Engine  v1.0
 *  Scores OPEN jobs for a given freelancer.
 *  Direction: Job → Freelancer compatibility (reverse match)
 *
 *  Scoring Formula:
 *    match_score =
 *      skills_score     × 0.30
 *      trust_score      × 0.22
 *      category_score   × 0.18
 *      budget_score     × 0.12
 *      experience_score × 0.10
 *      client_quality   × 0.08
 * ══════════════════════════════════════════════════════
 */

// ─── Skill Synonym Map (Phase 1 NLP) ─────────────────────────
const SKILL_ALIASES = {
    'react': ['react.js', 'reactjs', 'react js', 'frontend react'],
    'node': ['node.js', 'nodejs', 'node js', 'express', 'express.js'],
    'python': ['python3', 'py', 'django', 'flask', 'fastapi'],
    'javascript': ['js', 'es6', 'es2015', 'vanilla js', 'typescript', 'ts'],
    'css': ['css3', 'scss', 'sass', 'tailwind', 'tailwindcss', 'styled-components'],
    'html': ['html5', 'markup'],
    'vue': ['vue.js', 'vuejs', 'nuxt', 'nuxt.js'],
    'angular': ['angular.js', 'angularjs', 'ng'],
    'next': ['next.js', 'nextjs'],
    'mongodb': ['mongo', 'mongoose'],
    'postgresql': ['postgres', 'psql', 'pg'],
    'mysql': ['sql', 'mariadb'],
    'aws': ['amazon web services', 'ec2', 's3', 'lambda'],
    'docker': ['containerization', 'kubernetes', 'k8s'],
    'git': ['github', 'gitlab', 'version control'],
    'figma': ['ui/ux', 'ui design', 'ux design', 'wireframing'],
    'photoshop': ['adobe photoshop', 'ps'],
    'flutter': ['dart'],
    'react native': ['mobile', 'rn', 'react-native'],
    'java': ['spring', 'spring boot', 'maven'],
    'php': ['laravel', 'wordpress', 'wp'],
    'wordpress': ['wp', 'elementor', 'cms'],
    'seo': ['search engine optimization', 'on-page seo', 'off-page seo'],
    'graphql': ['graph ql', 'apollo', 'relay'],
    'redis': ['cache', 'in-memory db'],
    'firebase': ['firestore', 'realtime db', 'firebase auth'],
};

/**
 * Normalize a skill string to canonical form.
 */
function normalizeSkill(skill) {
    return skill.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Check if two skills match using alias expansion.
 */
function skillsMatch(jobSkill, profileSkill) {
    const j = normalizeSkill(jobSkill);
    const p = normalizeSkill(profileSkill);
    if (j === p) return true;

    for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
        const allForms = [canonical, ...aliases].map(normalizeSkill);
        if (allForms.includes(j) && allForms.includes(p)) return true;
    }
    return false;
}

/**
 * Compute skills overlap between job requirements and freelancer skills.
 */
function computeSkillsScore(jobSkills, profileSkills) {
    if (!jobSkills || jobSkills.length === 0) return { score: 80, matched: [], missing: [] };
    if (!profileSkills || profileSkills.length === 0) return { score: 0, matched: [], missing: jobSkills };

    const matched = [];
    const missing = [];

    for (const jSkill of jobSkills) {
        const isMatched = profileSkills.some(pSkill => skillsMatch(jSkill, pSkill));
        if (isMatched) matched.push(jSkill);
        else missing.push(jSkill);
    }

    const score = Math.round((matched.length / jobSkills.length) * 100);
    return { score, matched, missing };
}

/**
 * Compute budget compatibility score.
 */
function computeBudgetScore(job, profile) {
    const freelancerRate = parseFloat(profile.hourly_rate || 0);
    const budgetAmount = parseFloat(job.budget_amount || 0);

    if (!freelancerRate || !budgetAmount) return 60; // neutral if unknown

    let effectiveRate;
    if (job.budget_type === 'hourly') {
        effectiveRate = budgetAmount;
    } else {
        // Fixed: assume ~40 hours average project — derive effective hourly
        effectiveRate = budgetAmount / 40;
    }

    const ratio = effectiveRate / freelancerRate;

    if (ratio >= 0.85 && ratio <= 1.5) return 100; // sweet spot
    if (ratio >= 0.65 && ratio < 0.85) return 75;  // slightly below rate
    if (ratio > 1.5 && ratio <= 2.0) return 80;    // higher budget = still good
    if (ratio > 2.0) return 70;                     // much higher budget
    if (ratio >= 0.45 && ratio < 0.65) return 45;  // underbudget
    return 15;                                       // way below rate
}

/**
 * Compute category alignment score.
 */
function computeCategoryScore(job, profile) {
    const jobCat = (job.category || '').toLowerCase().trim();
    const profileCat = (profile.category || '').toLowerCase().trim();
    const preferredCats = (profile.preferred_categories || []).map(c => c.toLowerCase().trim());

    if (!jobCat) return 60;
    if (profileCat && profileCat === jobCat) return 100;
    if (preferredCats.includes(jobCat)) return 75;
    // Partial match: "Web Development" contains "development"
    if (profileCat && (profileCat.includes(jobCat) || jobCat.includes(profileCat))) return 65;
    return 20;
}

/**
 * Compute experience level compatibility.
 */
function computeExperienceScore(job, contractCount) {
    const JOB_LEVELS = { 'beginner': 1, 'intermediate': 2, 'expert': 3 };
    const jobLevel = JOB_LEVELS[(job.experience_level || 'intermediate').toLowerCase()] || 2;

    let freelancerLevel;
    if (contractCount >= 10) freelancerLevel = 3;
    else if (contractCount >= 2) freelancerLevel = 2;
    else freelancerLevel = 1;

    if (freelancerLevel >= jobLevel) return 100;
    if (freelancerLevel === jobLevel - 1) return 65;
    return 25;
}

/**
 * Compute trust score from profile reliability data.
 */
function computeTrustScore(profile, completionRate) {
    const reliability = parseFloat(profile.reliability_score || 70);
    const riskInverted = 100 - parseFloat(profile.risk_score || 30);
    const trust = Math.round((reliability * 0.60) + (riskInverted * 0.40));

    // New freelancers get benefit of the doubt
    if (!profile.reliability_score) return 65;
    return Math.min(100, trust);
}

/**
 * Compute client quality score from their hiring history.
 */
function computeClientQualityScore(clientData) {
    if (!clientData) return 60; // neutral
    const { hire_count = 0, job_count = 0, avg_rating = 0 } = clientData;
    const hireRate = job_count > 0 ? (hire_count / job_count) * 100 : 50;
    const ratingScore = Math.min(100, (avg_rating / 5) * 100);
    return Math.round((hireRate * 0.50) + (ratingScore * 0.50));
}

/**
 * Build a human-readable match reason string (no LLM needed).
 */
function buildMatchReason(scores, skillsMatched, skillsMissing, job) {
    const parts = [];

    if (skillsMatched.length > 0) {
        parts.push(`${skillsMatched.slice(0, 2).join(' & ')} match your skills`);
    }
    if (scores.budget_score >= 70) {
        parts.push('budget aligns with your rate');
    }
    if (scores.trust_score >= 80) {
        parts.push('your trust score is high');
    }
    if (scores.category_score === 100) {
        parts.push(`${job.category} is your specialty`);
    }
    if (skillsMissing.length > 0) {
        parts.push(`missing: ${skillsMissing.slice(0, 1).join(', ')}`);
    }

    if (parts.length === 0) return 'Partial match based on your profile';
    return parts.slice(0, 2).map((p, i) => i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p).join(' • ');
}

/**
 * Compute final weighted match score.
 */
function computeMatchScore(scores) {
    return Math.round(
        (scores.skills_score     * 0.30) +
        (scores.trust_score      * 0.22) +
        (scores.category_score   * 0.18) +
        (scores.budget_score     * 0.12) +
        (scores.experience_score * 0.10) +
        (scores.client_quality   * 0.08)
    );
}

// ─── Main Service ─────────────────────────────────────────────

class JobRecommendationService {

    /**
     * Get personalized recommendations for a freelancer.
     * Uses Redis cache → Supabase cache → cold compute fallback.
     */
    async getRecommendations(freelancerId, { limit = 20, offset = 0 } = {}) {
        try {
            // 1. Get blocked jobs & categories from negative signals
            const { excluded, blockedCategories } = await this._getNegativeSignals(freelancerId);

            // 2. Read from job_recommendations table
            let { data: recs, error } = await adminClient
                .from('job_recommendations')
                .select(`
                    job_id, match_score, skills_score, trust_score, budget_score,
                    category_score, experience_score, client_quality_score,
                    confidence, match_reason, skills_matched, skills_missing, computed_at
                `)
                .eq('freelancer_id', freelancerId)
                .gte('match_score', 10) // surface more matches for testing
                .gt('expires_at', new Date().toISOString())
                .order('match_score', { ascending: false })
                .limit(200); // over-fetch before exclusion

            if (error) throw error;

            // 3. Apply negative signal filters
            let filtered = (recs || [])
                .filter(r => !excluded.has(r.job_id));

            // 4. Fetch job data for non-blocked jobs
            if (filtered.length === 0) {
                // Cold start — compute synchronously and refetch
                await this.computeForFreelancer(freelancerId);
                
                const { data: newRecs } = await adminClient
                    .from('job_recommendations')
                    .select(`
                        job_id, match_score, skills_score, trust_score, budget_score,
                        category_score, experience_score, client_quality_score,
                        confidence, match_reason, skills_matched, skills_missing, computed_at
                    `)
                    .eq('freelancer_id', freelancerId)
                    .gte('match_score', 10)
                    .gt('expires_at', new Date().toISOString())
                    .order('match_score', { ascending: false })
                    .limit(200);

                filtered = (newRecs || []).filter(r => !excluded.has(r.job_id));
                if (filtered.length === 0) {
                    return { recommendations: [], total: 0, is_cold_start: false };
                }
            }

            const jobIds = filtered.map(r => r.job_id);
            const { data: jobs } = await adminClient
                .from('jobs')
                .select('id, title, description, category, budget_amount, budget_type, experience_level, skills, status, is_bidding_open, created_at, client_id, proposal_count')
                .in('id', jobIds)
                .eq('is_bidding_open', true)
                .eq('status', 'OPEN');

            if (!jobs || jobs.length === 0) return { recommendations: [], total: 0, is_cold_start: false };

            // Filter out blocked categories from actual job data
            const jobMap = new Map((jobs || [])
                .filter(j => !blockedCategories.has((j.category || '').toLowerCase()))
                .map(j => [j.id, j])
            );

            // 5. Merge rec scores with job data
            const enriched = filtered
                .filter(r => jobMap.has(r.job_id))
                .map(r => {
                    const job = jobMap.get(r.job_id);
                    return {
                        ...job,
                        recommendation: {
                            match_score: r.match_score,
                            skills_score: r.skills_score,
                            trust_score: r.trust_score,
                            budget_score: r.budget_score,
                            category_score: r.category_score,
                            experience_score: r.experience_score,
                            client_quality_score: r.client_quality_score,
                            confidence: r.confidence,
                            match_reason: r.match_reason,
                            skills_matched: r.skills_matched || [],
                            skills_missing: r.skills_missing || [],
                        }
                    };
                })
                .slice(offset, offset + limit);

            return {
                recommendations: enriched,
                total: filtered.filter(r => jobMap.has(r.job_id)).length,
                is_cold_start: false
            };

        } catch (err) {
            logger.error('[RecommendationService] getRecommendations failed', err);
            return { recommendations: [], total: 0, is_cold_start: true, error: err.message };
        }
    }

    /**
     * Compute match scores for all open jobs for a single freelancer.
     * Used on cold start or profile update.
     */
    async computeForFreelancer(freelancerId) {
        try {
            logger.info(`[RecommendationEngine] Computing recs for freelancer: ${freelancerId}`);

            // Fetch freelancer profile
            let { data: profile, error: pError } = await adminClient
                .from('profiles')
                .select('user_id, skills, category, hourly_rate, reliability_score, risk_score, preferred_categories, step_data')
                .eq('user_id', freelancerId)
                .single();

            if (pError && pError.code === '42703') {
                const { data: fbProfile, error: fbError } = await adminClient
                    .from('profiles')
                    .select('user_id, skills, category, hourly_rate, step_data')
                    .eq('user_id', freelancerId)
                    .single();
                if (!fbError) profile = fbProfile;
            }

            if (!profile) return;
            
            // Normalize profile from step_data if columns are empty
            const sd = (typeof profile.step_data === 'object' && profile.step_data) ? profile.step_data : {};
            profile.skills = profile.skills || sd.skills || [];
            profile.category = profile.category || sd.category || null;
            if (!profile.hourly_rate || profile.hourly_rate === '0') {
                profile.hourly_rate = sd.professional_info?.rate || sd.professional?.rate || sd.rate || null;
            }

            // Fetch contract count for experience level
            const { count: contractCount } = await adminClient
                .from('contracts')
                .select('*', { count: 'exact', head: true })
                .eq('freelancer_id', freelancerId)
                .eq('status', 'COMPLETED');

            const { count: completedCount } = await adminClient
                .from('contracts')
                .select('*', { count: 'exact', head: true })
                .eq('freelancer_id', freelancerId);

            const completionRate = completedCount > 0
                ? Math.round((contractCount / completedCount) * 100)
                : 100;

            // Fetch open jobs (cap at 300 for performance)
            const { data: jobs } = await adminClient
                .from('jobs')
                .select('id, title, category, budget_amount, budget_type, experience_level, skills, client_id, status, is_bidding_open')
                .eq('is_bidding_open', true)
                .eq('status', 'OPEN')
                .order('created_at', { ascending: false })
                .limit(300);

            if (!jobs || jobs.length === 0) return;
            
            // Fetch all applied jobs for this freelancer in one query to avoid N+1
            const { data: appliedProposals } = await adminClient
                .from('proposals')
                .select('job_id')
                .eq('freelancer_id', freelancerId);
            const appliedJobIds = new Set((appliedProposals || []).map(p => p.job_id));

            // Fetch client quality data
            const clientIds = [...new Set(jobs.map(j => j.client_id).filter(Boolean))];
            const clientQualityMap = await this._buildClientQualityMap(clientIds);

            const trustScore = computeTrustScore(profile, completionRate);
            const experienceScore = computeExperienceScore({ experience_level: 'intermediate' }, contractCount || 0);

            const upsertRows = [];

            for (const job of jobs) {
                // Skip if freelancer already applied
                if (appliedJobIds.has(job.id)) continue;

                const { score: skillsScore, matched, missing } = computeSkillsScore(job.skills || [], profile.skills || []);
                const budgetScore = computeBudgetScore(job, profile);
                const categoryScore = computeCategoryScore(job, profile);
                const jobExperienceScore = computeExperienceScore(job, contractCount || 0);
                const clientQuality = computeClientQualityScore(clientQualityMap.get(job.client_id));

                const scores = {
                    skills_score: skillsScore,
                    trust_score: trustScore,
                    budget_score: budgetScore,
                    category_score: categoryScore,
                    experience_score: jobExperienceScore,
                    client_quality: clientQuality,
                };

                const matchScore = computeMatchScore(scores);
                const matchReason = buildMatchReason(scores, matched, missing, job);

                // Confidence: based on data availability
                const hasSkills = (profile.skills || []).length > 0;
                const hasRate = !!profile.hourly_rate;
                const hasCategory = !!profile.category;
                const confidence = parseFloat(((hasSkills ? 0.4 : 0) + (hasRate ? 0.3 : 0) + (hasCategory ? 0.3 : 0)).toFixed(2));

                upsertRows.push({
                    freelancer_id: freelancerId,
                    job_id: job.id,
                    match_score: matchScore,
                    skills_score: skillsScore,
                    trust_score: trustScore,
                    budget_score: budgetScore,
                    category_score: categoryScore,
                    experience_score: jobExperienceScore,
                    client_quality_score: clientQuality,
                    confidence,
                    match_reason: matchReason,
                    skills_matched: matched,
                    skills_missing: missing,
                    computed_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
                    is_stale: false,
                });
            }

            // Batch upsert in chunks of 50
            const CHUNK_SIZE = 50;
            for (let i = 0; i < upsertRows.length; i += CHUNK_SIZE) {
                const chunk = upsertRows.slice(i, i + CHUNK_SIZE);
                await adminClient
                    .from('job_recommendations')
                    .upsert(chunk, { onConflict: 'freelancer_id,job_id' });
            }

            logger.info(`[RecommendationEngine] Upserted ${upsertRows.length} recs for ${freelancerId}`);

        } catch (err) {
            logger.error('[RecommendationEngine] computeForFreelancer failed', err);
        }
    }

    /**
     * Score a newly posted job for relevant freelancers.
     * Called in background after job creation.
     */
    async scoreNewJobForFreelancers(jobId) {
        try {
            const { data: job } = await adminClient
                .from('jobs')
                .select('id, title, category, budget_amount, budget_type, experience_level, skills, client_id')
                .eq('id', jobId)
                .single();

            if (!job) return;

            // Find freelancers with at least one matching skill or category
            const skillsFilter = (job.skills || []).slice(0, 5); // top 5 skills for targeting
            let { data: freelancers, error: fError } = await adminClient
                .from('profiles')
                .select('user_id, skills, category, hourly_rate, reliability_score, risk_score, preferred_categories, step_data')
                .eq('role', 'FREELANCER')
                .limit(500);

            if (fError && fError.code === '42703') {
                const { data: fbFreelancers } = await adminClient
                    .from('profiles')
                    .select('user_id, skills, category, hourly_rate, step_data')
                    .eq('role', 'FREELANCER')
                    .limit(500);
                freelancers = fbFreelancers;
            }

            if (!freelancers || freelancers.length === 0) return;
            
            // Normalize freelancers
            freelancers = freelancers.map(f => {
                const sd = (typeof f.step_data === 'object' && f.step_data) ? f.step_data : {};
                f.skills = f.skills || sd.skills || [];
                f.category = f.category || sd.category || null;
                if (!f.hourly_rate || f.hourly_rate === '0') {
                    f.hourly_rate = sd.professional_info?.rate || sd.professional?.rate || sd.rate || null;
                }
                return f;
            }).filter(f => f.skills && f.skills.length > 0); // only score if they have skills

            const clientQualityMap = await this._buildClientQualityMap([job.client_id]);
            const clientQuality = computeClientQualityScore(clientQualityMap.get(job.client_id));

            const upsertRows = [];

            for (const profile of freelancers) {
                const { data: contracts } = await adminClient
                    .from('contracts')
                    .select('id, status')
                    .eq('freelancer_id', profile.user_id);

                const contractCount = contracts?.length || 0;
                const completedCount = contracts?.filter(c => c.status === 'COMPLETED').length || 0;

                const trustScore = computeTrustScore(profile, completedCount > 0 ? Math.round(completedCount / contractCount * 100) : 100);

                const { score: skillsScore, matched, missing } = computeSkillsScore(job.skills || [], profile.skills || []);
                const budgetScore = computeBudgetScore(job, profile);
                const categoryScore = computeCategoryScore(job, profile);
                const experienceScore = computeExperienceScore(job, contractCount);

                const scores = { skills_score: skillsScore, trust_score: trustScore, budget_score: budgetScore, category_score: categoryScore, experience_score: experienceScore, client_quality: clientQuality };
                const matchScore = computeMatchScore(scores);

                // Only store if score is meaningful
                if (matchScore < 10) continue;

                const confidence = parseFloat((((profile.skills || []).length > 0 ? 0.4 : 0) + (profile.hourly_rate ? 0.3 : 0) + (profile.category ? 0.3 : 0)).toFixed(2));

                upsertRows.push({
                    freelancer_id: profile.user_id,
                    job_id: job.id,
                    match_score: matchScore,
                    skills_score: skillsScore,
                    trust_score: trustScore,
                    budget_score: budgetScore,
                    category_score: categoryScore,
                    experience_score: experienceScore,
                    client_quality_score: clientQuality,
                    confidence,
                    match_reason: buildMatchReason(scores, matched, missing, job),
                    skills_matched: matched,
                    skills_missing: missing,
                    computed_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
                    is_stale: false,
                });
            }

            const CHUNK_SIZE = 50;
            for (let i = 0; i < upsertRows.length; i += CHUNK_SIZE) {
                await adminClient.from('job_recommendations').upsert(upsertRows.slice(i, i + CHUNK_SIZE), { onConflict: 'freelancer_id,job_id' });
            }

            logger.info(`[RecommendationEngine] Scored job ${jobId} for ${upsertRows.length} freelancers`);

        } catch (err) {
            logger.error('[RecommendationEngine] scoreNewJobForFreelancers failed', err);
        }
    }

    /**
     * Compute AI Profile Readiness Score.
     */
    async getProfileAIScore(freelancerId) {
        try {
            const { data: profile } = await adminClient
                .from('profiles')
                .select('skills, hourly_rate, category, bio, avatar_url, preferred_categories')
                .eq('user_id', freelancerId)
                .single();

            if (!profile) return null;

            const { count: portfolioCount } = await adminClient
                .from('portfolio_items')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', freelancerId)
                .catch(() => ({ count: 0 }));

            const { count: contractCount } = await adminClient
                .from('contracts')
                .select('*', { count: 'exact', head: true })
                .eq('freelancer_id', freelancerId)
                .catch(() => ({ count: 0 }));

            const skillsCount = (profile.skills || []).length;
            const bioWords = (profile.bio || '').trim().split(/\s+/).filter(Boolean).length;
            const hasRate = !!profile.hourly_rate;
            const hasCategory = !!profile.category;
            const hasAvatar = !!profile.avatar_url;
            const hasPortfolio = (portfolioCount || 0) >= 2;
            const hasExperience = (contractCount || 0) >= 1;

            const breakdown = {
                skills: {
                    score: skillsCount >= 5 ? 100 : skillsCount >= 3 ? 80 : skillsCount >= 1 ? 50 : 0,
                    weight: 25,
                    tip: skillsCount >= 5 ? 'Great — you have plenty of skills listed' :
                         skillsCount >= 3 ? `Add ${5 - skillsCount} more skills to maximize matching` :
                         'Add at least 3 skills to enable AI matching',
                    value: skillsCount
                },
                portfolio: {
                    score: hasPortfolio ? 100 : portfolioCount === 1 ? 50 : 0,
                    weight: 20,
                    tip: hasPortfolio ? 'Portfolio looks good' : 'Add 2+ portfolio items to boost confidence score by ~12 pts',
                    value: portfolioCount || 0
                },
                hourly_rate: {
                    score: hasRate ? 100 : 0,
                    weight: 15,
                    tip: hasRate ? 'Rate set ✓' : 'Set your hourly rate to enable budget matching',
                    value: profile.hourly_rate
                },
                category: {
                    score: hasCategory ? 100 : 0,
                    weight: 15,
                    tip: hasCategory ? 'Category set ✓' : 'Set your primary category for better job targeting',
                    value: profile.category
                },
                bio: {
                    score: bioWords >= 150 ? 100 : Math.round((bioWords / 150) * 100),
                    weight: 15,
                    tip: bioWords >= 150 ? 'Bio is great' : `Expand your bio to ${150 - bioWords} more words for semantic matching`,
                    value: bioWords
                },
                avatar: {
                    score: hasAvatar ? 100 : 0,
                    weight: 10,
                    tip: hasAvatar ? 'Profile photo set ✓' : 'Add a professional photo to build trust',
                    value: !!hasAvatar
                }
            };

            const ai_readiness_score = Math.round(
                Object.values(breakdown).reduce((sum, b) => sum + (b.score * b.weight / 100), 0)
            );

            // Generate actionable recommendations sorted by impact
            const recommendations = Object.entries(breakdown)
                .filter(([, b]) => b.score < 100)
                .sort(([, a], [, b]) => (b.weight * (100 - b.score)) - (a.weight * (100 - a.score)))
                .slice(0, 3)
                .map(([key, b]) => b.tip);

            return {
                ai_readiness_score,
                breakdown,
                recommendations,
                label: ai_readiness_score >= 85 ? 'Excellent' :
                       ai_readiness_score >= 70 ? 'Well-tuned' :
                       ai_readiness_score >= 50 ? 'Needs improvement' : 'Incomplete'
            };

        } catch (err) {
            logger.error('[RecommendationEngine] getProfileAIScore failed', err);
            return null;
        }
    }

    /**
     * Record a behavioral event.
     */
    async trackEvent(freelancerId, jobId, eventType, metadata = {}) {
        try {
            // Get job category for tracking
            let jobCategory = null;
            try {
                const { data: job } = await adminClient.from('jobs').select('category').eq('id', jobId).single();
                jobCategory = job?.category || null;
            } catch (_) {}

            await adminClient.from('recommendation_events').insert({
                freelancer_id: freelancerId,
                job_id: jobId,
                job_category: jobCategory,
                event_type: eventType,
                source_tab: metadata.source_tab || 'best_matches',
                metadata,
            });

            // For negative signals: mark recs as stale immediately
            if (['hide_job', 'not_relevant', 'dont_show_similar'].includes(eventType)) {
                await adminClient
                    .from('job_recommendations')
                    .update({ is_stale: true })
                    .eq('freelancer_id', freelancerId)
                    .eq('job_id', jobId);
            }

            // For 'apply': mark the rec so it's not shown again
            if (eventType === 'apply') {
                await adminClient
                    .from('job_recommendations')
                    .update({ is_stale: true })
                    .eq('freelancer_id', freelancerId)
                    .eq('job_id', jobId);
            }

        } catch (err) {
            logger.error('[RecommendationEngine] trackEvent failed', err.message);
        }
    }

    /**
     * Invalidate all recs for a freelancer (e.g., profile updated).
     */
    async invalidateFreelancerRecs(freelancerId) {
        try {
            await adminClient
                .from('job_recommendations')
                .update({ is_stale: true, expires_at: new Date().toISOString() })
                .eq('freelancer_id', freelancerId);
            logger.info(`[RecommendationEngine] Invalidated recs for ${freelancerId}`);
            // Recompute in background
            this.computeForFreelancer(freelancerId).catch(() => {});
        } catch (err) {
            logger.error('[RecommendationEngine] invalidateFreelancerRecs failed', err);
        }
    }

    /**
     * Nightly batch refresh: recompute all stale/expired recs.
     */
    async runNightlyRefresh() {
        try {
            logger.info('[RecommendationEngine] Starting nightly batch refresh...');

            // Get unique freelancers with stale or expired recs
            const { data: stale } = await adminClient
                .from('job_recommendations')
                .select('freelancer_id')
                .or(`is_stale.eq.true,expires_at.lt.${new Date().toISOString()}`)
                .limit(1000);

            const freelancerIds = [...new Set((stale || []).map(r => r.freelancer_id))];

            logger.info(`[RecommendationEngine] Refreshing recs for ${freelancerIds.length} freelancers`);

            // Process in serial to avoid DB overload at 2 AM
            for (const fId of freelancerIds) {
                await this.computeForFreelancer(fId);
                await new Promise(r => setTimeout(r, 50)); // 50ms breathing room
            }

            logger.info('[RecommendationEngine] Nightly refresh complete.');
        } catch (err) {
            logger.error('[RecommendationEngine] Nightly refresh failed', err);
        }
    }

    // ─── Private Helpers ────────────────────────────────────────

    async _getNegativeSignals(freelancerId) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);

        const { data: events } = await adminClient
            .from('recommendation_events')
            .select('job_id, job_category, event_type, created_at')
            .eq('freelancer_id', freelancerId)
            .in('event_type', ['hide_job', 'not_relevant', 'dont_show_similar', 'apply'])
            .gte('created_at', cutoff.toISOString());

        const excluded = new Set();
        const blockedCategories = new Set();
        const now = Date.now();

        for (const e of events || []) {
            const age = (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24); // days

            if (e.event_type === 'hide_job' && age <= 7) {
                excluded.add(e.job_id);
            }
            if (e.event_type === 'apply') {
                excluded.add(e.job_id);
            }
            if (e.event_type === 'not_relevant' && age <= 30 && e.job_category) {
                blockedCategories.add(e.job_category.toLowerCase());
            }
            if (e.event_type === 'dont_show_similar' && age <= 90 && e.job_category) {
                blockedCategories.add(e.job_category.toLowerCase());
            }
        }

        return { excluded, blockedCategories };
    }

    async _buildClientQualityMap(clientIds) {
        const map = new Map();
        if (!clientIds || clientIds.length === 0) return map;

        try {
            const { data: jobs } = await adminClient
                .from('jobs')
                .select('client_id, id')
                .in('client_id', clientIds);

            const jobMap = {};
            (jobs || []).forEach(j => {
                if (!jobMap[j.client_id]) jobMap[j.client_id] = 0;
                jobMap[j.client_id]++;
            });

            const { data: contracts } = await adminClient
                .from('contracts')
                .select('client_id')
                .in('client_id', clientIds)
                .eq('status', 'COMPLETED');

            const hireMap = {};
            (contracts || []).forEach(c => {
                if (!hireMap[c.client_id]) hireMap[c.client_id] = 0;
                hireMap[c.client_id]++;
            });

            for (const cId of clientIds) {
                map.set(cId, {
                    job_count: jobMap[cId] || 0,
                    hire_count: hireMap[cId] || 0,
                    avg_rating: 4.0, // Default until reviews are fetched
                });
            }
        } catch (_) {}

        return map;
    }
}

module.exports = new JobRecommendationService();
