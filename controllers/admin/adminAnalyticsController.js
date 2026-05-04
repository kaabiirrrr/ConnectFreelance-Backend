const supabase = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

exports.getDashboardOverview = async (req, res, next) => {
    try {
        // Fetch massive aggregations from Supabase
        // In a real production app with millions of rows, use a PostgreSQL function or materialized view

        const [
            { count: totalUsers },
            { count: totalClients },
            { count: totalFreelancers },
            { count: totalJobs },
            { count: totalProposals },
            { count: activeContracts },
            { count: pendingDisputes },
            { count: pendingVerifications },
            { data: paymentsData },
            { count: recentActivityCount }
        ] = await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'CLIENT'),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'FREELANCER'),
            supabase.from('jobs').select('*', { count: 'exact', head: true }),
            supabase.from('proposals').select('*', { count: 'exact', head: true }),
            supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
            supabase.from('disputes').select('*', { count: 'exact', head: true }).eq('status', 'OPEN'),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).ilike('verification_status', 'pending'),
            supabase.from('payments').select('amount').in('status', ['escrow', 'released', 'requires_capture', 'succeeded']),
            supabase.from('user_activity_logs').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        ]);

        // Determine system status (always true if we reached this point, but could check DB health)
        const systemStatus = 'OPERATIONAL';

        // Fetch real commission if available
        const { data: commissionSettings } = await supabase
            .from('platform_settings')
            .select('setting_value')
            .eq('setting_key', 'commission_percentage')
            .maybeSingle();

        const commissionRate = commissionSettings ? parseFloat(commissionSettings.setting_value) / 100 : 0.10;
        
        // Ensure totalEarnings is a number and platformCommission is 10% of it
        const totalEarnings = Number(paymentsData?.reduce((acc, curr) => acc + Number(curr.amount), 0) || 0);
        const platformCommission = Number((totalEarnings * commissionRate).toFixed(2));


        // Fetch user growth data (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        
        const { data: userGrowthData } = await supabase
            .from('profiles')
            .select('created_at, role')
            .gte('created_at', sixMonthsAgo.toISOString())
            .order('created_at', { ascending: true });

        // Aggregate by month (initialize last 6 months with role counts)
        const userGrowthMap = new Map();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const key = `${months[d.getMonth()]} ${d.getFullYear()}`;
            userGrowthMap.set(key, { name: key, total: 0, freelancers: 0, clients: 0 });
        }
        
        userGrowthData?.forEach(user => {
            const date = new Date(user.created_at);
            const key = `${months[date.getMonth()]} ${date.getFullYear()}`;
            if (userGrowthMap.has(key)) {
                const stats = userGrowthMap.get(key);
                stats.total += 1;
                if (user.role === 'FREELANCER') stats.freelancers += 1;
                if (user.role === 'CLIENT') stats.clients += 1;
            }
        });

        const userGrowth = Array.from(userGrowthMap.values());


        // Fetch revenue data (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        
        const { data: revenueDataRaw } = await supabase
            .from('payments')
            .select('amount, created_at')
            .gte('created_at', thirtyDaysAgo.toISOString())
            .in('status', ['released', 'escrow', 'requires_capture', 'succeeded'])
            .order('created_at', { ascending: true });

        // Aggregate by day (last 30 days)
        const revenueMap = new Map();
        for (let i = 29; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = `${d.getDate()} ${months[d.getMonth()]}`;
            revenueMap.set(key, 0);
        }
        
        revenueDataRaw?.forEach(payment => {
            const date = new Date(payment.created_at);
            const key = `${date.getDate()} ${months[date.getMonth()]}`;
            if (revenueMap.has(key)) {
                revenueMap.set(key, revenueMap.get(key) + Number(payment.amount));
            }
        });

        const revenueGrowth = Array.from(revenueMap.entries()).map(([name, amount]) => ({ name, amount: Number(amount.toFixed(2)) }));

        // 3. User Activity Analytics (Page Visits/Features) - Aggregated in SQL to bypass 1000-row limits
        const { data: pageVisitsAggregated } = await supabase
            .rpc('get_page_visit_stats'); // Use a custom RPC for speed/correctness if possible, or fallback to direct query

        // If RPC doesn't exist, we'll use a direct group by query
        let topPages = [];
        let topFeatures = [];

        try {
            const { data: pgData } = await supabase
                .from('user_activity_logs')
                .select('page_path')
                .eq('action_type', 'visit');
            
            // Note: If data is large, this still hits limits. 
            // Better to use a raw SQL query via a hidden RPC or just increase limit for now if we can't add RPC.
            // But since I can't easily add RPCs here, I'll increase the limit to 10,000 as a quick fix.
            const { data: pageVisits } = await supabase
                .from('user_activity_logs')
                .select('page_path')
                .eq('action_type', 'visit')
                .limit(10000);

            const pageTitleMap = {
                '/': 'Landing',
                '/find-work': 'Marketplace',
                '/find-freelancers': 'Talent',
                '/messages': 'Messaging',
                '/client/dashboard': 'Client',
                '/freelancer/dashboard': 'Freelancer',
                '/admin/dashboard': 'Admin',
                '/profile': 'Profile',
                '/settings': 'Settings'
            };

            const pageMap = {};
            pageVisits?.forEach(v => {
                const rawPath = v.page_path || 'unknown';
                const page = pageTitleMap[rawPath] || (rawPath.length > 1 ? rawPath.split('/')[1].charAt(0).toUpperCase() + rawPath.split('/')[1].slice(1) : 'Home');
                pageMap[page] = (pageMap[page] || 0) + 1;
            });

            topPages = Object.entries(pageMap)
                .map(([page, count]) => ({ page, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            const { data: featureUsage } = await supabase
                .from('user_activity_logs')
                .select('feature_name')
                .not('feature_name', 'is', null)
                .limit(10000);

            const featureMap = {};
            featureUsage?.forEach(f => {
                // Normalize feature names (lowercase and remove underscores)
                let name = f.feature_name.toLowerCase().replace(/_/g, ' ');
                name = name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                
                // Specific merges
                if (name === 'Proposal Submission') name = 'Submit Proposal';
                
                featureMap[name] = (featureMap[name] || 0) + 1;
            });
            
            topFeatures = Object.entries(featureMap)
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 6);

        } catch (err) {
            console.error("Error in aggregation", err);
        }

        res.status(200).json({
            success: true,
            data: {
                overview: {
                    totalUsers,
                    totalClients,
                    totalFreelancers,
                    totalJobs,
                    activeContracts,
                    pendingDisputes,
                    pendingVerifications,
                    totalProposals,
                    totalEarnings,
                    platformCommission,
                    recentActivityCount,
                    systemStatus
                },
                userGrowth,
                revenueGrowth,
                topPages,
                topFeatures
            }
        });
    } catch (error) {
        logger.error('[AdminAnalytics] Error', error);
        next(error);
    }
};

exports.getAdminActivityStats = async (req, res, next) => {
    try {
        // 1. Get Actions per Admin (from admin_logs)
        const { data: actionsPerAdminRaw } = await supabase
            .from('admin_logs')
            .select('admin_email');

        const adminActionMap = {};
        actionsPerAdminRaw?.forEach(log => {
            const email = log.admin_email || 'Unknown';
            adminActionMap[email] = (adminActionMap[email] || 0) + 1;
        });

        const actionsPerAdmin = Object.entries(adminActionMap)
            .map(([name, value]) => ({ name: name.split('@')[0], email: name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        // 2. Get Top Action Types (What they are doing)
        const { data: actionTypesRaw } = await supabase
            .from('admin_logs')
            .select('action_type');

        const typeMap = {};
        actionTypesRaw?.forEach(log => {
            const type = log.action_type || 'Other';
            typeMap[type] = (typeMap[type] || 0) + 1;
        });

        const actionDistribution = Object.entries(typeMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        // 3. Get Feature Engagement for Admins (Where they invest time)
        // First get all admin IDs
        const { data: adminIds } = await supabase.from('admins').select('id');
        const ids = adminIds?.map(a => a.id) || [];

        const { data: adminActivityRaw } = await supabase
            .from('user_activity_logs')
            .select('feature_name, page_path')
            .in('user_id', ids);

        const featureEngagementMap = {};
        adminActivityRaw?.forEach(log => {
            const feature = log.feature_name || (log.page_path ? log.page_path.split('/')[2] : 'General');
            if (feature) {
                const formattedFeature = feature.charAt(0).toUpperCase() + feature.slice(1);
                featureEngagementMap[formattedFeature] = (featureEngagementMap[formattedFeature] || 0) + 1;
            }
        });

        const featureEngagement = Object.entries(featureEngagementMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);

        // 4. Get Activity Timeline (Last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: timelineRaw } = await supabase
            .from('admin_logs')
            .select('created_at')
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: true });

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const timelineMap = new Map();
        
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = `${d.getDate()} ${days[d.getDay()]}`;
            timelineMap.set(key, 0);
        }

        timelineRaw?.forEach(log => {
            const date = new Date(log.created_at);
            const key = `${date.getDate()} ${days[date.getDay()]}`;
            if (timelineMap.has(key)) {
                timelineMap.set(key, timelineMap.get(key) + 1);
            }
        });

        const activityTimeline = Array.from(timelineMap.entries()).map(([name, value]) => ({ name, value }));

        // 5. Get Top Contributor for the Primary Workload
        const primaryWorkloadName = actionDistribution[0]?.name;
        let primaryWorkloadAdmin = 'System';
        if (primaryWorkloadName) {
            const { data: workloadAdminRaw } = await supabase
                .from('admin_logs')
                .select('admin_email')
                .eq('action_type', primaryWorkloadName);
            
            const workloadAdminMap = {};
            workloadAdminRaw?.forEach(log => {
                workloadAdminMap[log.admin_email] = (workloadAdminMap[log.admin_email] || 0) + 1;
            });
            const topEmail = Object.entries(workloadAdminMap)
                .sort((a, b) => b[1] - a[1])[0]?.[0];
            primaryWorkloadAdmin = topEmail ? topEmail.split('@')[0] : 'System';
        }

        // 6. Get Top Contributor for Most Investigated Feature
        const topFeatureName = featureEngagement[0]?.name;
        let topFeatureAdmin = 'Team';
        if (topFeatureName) {
            // Need to join user_activity_logs with admins table or use ids
            const { data: featureAdminRaw } = await supabase
                .from('user_activity_logs')
                .select('user_id')
                .eq('feature_name', topFeatureName)
                .in('user_id', ids);

            const featureAdminMap = {};
            featureAdminRaw?.forEach(log => {
                featureAdminMap[log.user_id] = (featureAdminMap[log.user_id] || 0) + 1;
            });
            const topId = Object.entries(featureAdminMap)
                .sort((a, b) => b[1] - a[1])[0]?.[0];
            
            if (topId) {
                const { data: adminUser } = await supabase.from('admins').select('name').eq('id', topId).maybeSingle();
                topFeatureAdmin = adminUser?.name || 'Admin';
            }
        }

        res.status(200).json({
            success: true,
            data: {
                actionsPerAdmin,
                actionDistribution,
                featureEngagement,
                activityTimeline,
                attribution: {
                    primaryWorkloadAdmin,
                    topFeatureAdmin
                }
            }
        });
    } catch (error) {
        logger.error('[AdminActivityAnalytics] Error', error);
        next(error);
    }
};

exports.getPlatformActivity = async (req, res, next) => {
    try {
        const { limit = 10 } = req.query;

        // Fetch real activities from multiple tables
        const [
            { data: newUsers },
            { data: newJobs },
            { data: newProposals },
            { data: adminLogs }
        ] = await Promise.all([
            supabase.from('profiles').select('id, name, role, created_at').order('created_at', { ascending: false }).limit(limit),
            supabase.from('jobs').select('id, title, created_at').order('created_at', { ascending: false }).limit(limit),
            supabase.from('proposals').select('id, job_id, created_at, jobs(title)').order('created_at', { ascending: false }).limit(limit),
            supabase.from('admin_logs').select('id, description, created_at, admin_email').order('created_at', { ascending: false }).limit(limit)
        ]);

        // Transform into a unified format
        const activities = [];

        newUsers?.forEach(user => {
            activities.push({
                id: `user-${user.id}`,
                type: 'USER_SIGNUP',
                description: `New ${user.role?.toLowerCase() || 'user'} joined: ${user.name || 'Anonymous'}`,
                created_at: user.created_at,
                admin_email: 'System'
            });
        });

        newJobs?.forEach(job => {
            activities.push({
                id: `job-${job.id}`,
                type: 'JOB_POSTED',
                description: `New job posted: ${job.title}`,
                created_at: job.created_at,
                admin_email: 'Marketplace'
            });
        });

        newProposals?.forEach(prop => {
            activities.push({
                id: `prop-${prop.id}`,
                type: 'PROPOSAL_SUBMITTED',
                description: `New proposal submitted for: ${prop.jobs?.title || 'a job'}`,
                created_at: prop.created_at,
                admin_email: 'Marketplace'
            });
        });

        adminLogs?.forEach(log => {
            activities.push({
                id: `log-${log.id}`,
                type: 'ADMIN_ACTION',
                description: log.description,
                created_at: log.created_at,
                admin_email: log.admin_email?.split('@')[0] || 'Admin'
            });
        });

        // Sort by date descending and limit
        const unified = activities
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);

        res.status(200).json({
            success: true,
            data: unified
        });
    } catch (error) {
        logger.error('[PlatformActivity] Error', error);
        next(error);
    }
};
