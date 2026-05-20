const adminClient = require('./supabase/adminClient');
const recommendationService = require('./services/jobRecommendationService');
require('dotenv').config();

async function run() {
    const freelancerId = 'aa5251e3-3faa-4121-9276-17d71d2341e8'; // Kabir
    console.log('Computing for:', freelancerId);
    
    const { data: profile } = await adminClient
        .from('profiles')
        .select('user_id, skills, category, hourly_rate, reliability_score, risk_score, preferred_categories')
        .eq('user_id', freelancerId)
        .single();
    if (!profile) return console.log('no profile');
    
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
        
    const { data: jobs } = await adminClient
        .from('jobs')
        .select('id, title, category, budget_amount, budget_type, experience_level, skills, client_id, status, is_bidding_open')
        .eq('is_bidding_open', true)
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
        .limit(300);

    if (!jobs || jobs.length === 0) return console.log('no jobs');
    
    const { data: appliedProposals, error: appliedError } = await adminClient
        .from('proposals')
        .select('job_id')
        .eq('freelancer_id', freelancerId);
        
    if (appliedError) console.error('Error fetching proposals:', appliedError);

    console.log('applied:', appliedProposals?.length);
}
run();
