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
            supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
            supabase.from('disputes').select('*', { count: 'exact', head: true }).eq('status', 'OPEN'),
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('verification_status', 'PENDING'),
            supabase.from('payments').select('amount').in('status', ['escrow', 'released']),
            supabase.from('admin_audit_logs').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
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


        // Fetch revenue data (last 7 days - starting 6 days ago + today)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0); // Start of day 7 days ago
        
        const { data: revenueDataRaw } = await supabase
            .from('payments')
            .select('amount, created_at')
            .gte('created_at', sevenDaysAgo.toISOString())
            .in('status', ['released', 'escrow'])
            .order('created_at', { ascending: true });

        // Aggregate by day (initialize last 7 days starting from oldest)
        const revenueMap = new Map();
        const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        for (let i = 6; i >= 0; i--) {
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

        // 3. User Activity Analytics (Page Visits/Features)
        const { data: pageVisits } = await supabase
            .from('user_activity_logs')
            .select('page_path')
            .eq('action_type', 'visit');

        const pageTitleMap = {
            '/': 'Landing Page',
            '/find-work': 'Marketplace',
            '/find-freelancers': 'Talent Search',
            '/messages': 'Messaging',
            '/client/dashboard': 'Client Portal',
            '/profile': 'Profile Views',
            '/settings': 'Settings'
        };

        const pageMap = {};
        pageVisits?.forEach(v => {
            const rawPath = v.page_path || 'unknown';
            // Find map match or use capitalized path
            const page = pageTitleMap[rawPath] || (rawPath.length > 1 ? rawPath.substring(1).charAt(0).toUpperCase() + rawPath.substring(2) : 'Home');
            pageMap[page] = (pageMap[page] || 0) + 1;
        });

        const topPages = Object.entries(pageMap)
            .map(([page, count]) => ({ page, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);


        const { data: featureUsage } = await supabase
            .from('user_activity_logs')
            .select('feature_name')
            .not('feature_name', 'is', null);

        const featureMap = {};
        featureUsage?.forEach(f => {
            featureMap[f.feature_name] = (featureMap[f.feature_name] || 0) + 1;
        });
        const topFeatures = Object.entries(featureMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6);

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
