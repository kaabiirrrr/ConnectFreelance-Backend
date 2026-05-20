const adminClient = require('./supabase/adminClient');
const recommendationService = require('./services/jobRecommendationService');
require('dotenv').config();

async function run() {
    const freelancerId = 'aa5251e3-3faa-4121-9276-17d71d2341e8'; // Kabir
    console.log('Computing for:', freelancerId);
    
    // Clear old recs
    await adminClient.from('job_recommendations').delete().eq('freelancer_id', freelancerId);
    
    // Run computation
    await recommendationService.computeForFreelancer(freelancerId);
    
    // Fetch result
    const { data: recs, error } = await adminClient.from('job_recommendations').select('job_id, match_score, skills_score, category_score, budget_score, confidence, match_reason').eq('freelancer_id', freelancerId);
    console.log('Recs computed:', recs?.length);
    console.log('Error:', error);
    if (recs?.length > 0) {
        console.log(recs);
    }
}
run();
