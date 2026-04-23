const logger = require('../utils/logger');

exports.getPolicies = async (req, res) => {
    try {
        const policies = [
            {
                id: "legal",
                title: "Legal",
                desc: "Information regarding the legal structure of the platform, jurisdiction clauses, and dispute resolution mechanisms.",
                icon: "Scale",
                color: "from-slate-500/20 to-slate-500/0"
            },
            {
                id: "privacy",
                title: "Privacy Policy",
                desc: "Details on how we collect, use, and protect your data. We never sell your personal information to third parties.",
                icon: "Shield",
                color: "from-blue-500/20 to-blue-500/0"
            },
            {
                id: "terms",
                title: "Terms & Conditions",
                desc: "The rules, agreements, and guidelines that users must adhere to in order to use the platform services.",
                icon: "FileText",
                color: "from-emerald-500/20 to-emerald-500/0"
            },
            {
                id: "cookie",
                title: "Cookie Policy",
                desc: "Explanation of how we use cookies and tracking technologies to improve your experience on our platform.",
                icon: "Cookie",
                color: "from-purple-500/20 to-purple-500/0"
            },
            {
                id: "refund",
                title: "Refund Policy",
                desc: "Guidelines for refund requests, escrow management, and conditions under which payments are reversed.",
                icon: "RefreshCcw",
                color: "from-rose-500/20 to-rose-500/0"
            }
        ];

        return res.status(200).json({
            success: true,
            data: policies,
            message: "Policies fetched successfully."
        });
    } catch (error) {
        logger.error('Error fetching policies', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error fetching policies"
        });
    }
};
