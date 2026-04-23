const validateEnv = () => {
    // CRITICAL: App cannot function or even start without these
    const criticalVars = [
        "PORT",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "JWT_SECRET"
    ];

    // ESSENTIAL: App will fail on specific routes without these
    const essentialVars = [
        "STRIPE_SECRET_KEY",
        "RAZORPAY_KEY_ID",
        "RAZORPAY_KEY_SECRET",
        "CLIENT_URL"
    ];

    const missingCritical = criticalVars.filter(key => !process.env[key]);
    const missingEssential = essentialVars.filter(key => !process.env[key]);

    if (missingCritical.length > 0) {
        console.error("❌ CRITICAL ENVIRONMENT VARIABLES MISSING:", missingCritical);
        if (process.env.NODE_ENV === 'production') {
            console.error("System exiting due to missing critical infrastructure keys.");
            process.exit(1);
        }
    }

    if (missingEssential.length > 0) {
        console.warn("⚠️  ESSENTIAL ENVIRONMENT VARIABLES MISSING (App may fail on some features):", missingEssential);
    }
};

module.exports = { validateEnv };