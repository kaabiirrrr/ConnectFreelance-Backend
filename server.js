// ======================
// FORCE EARLY LOG (Render detection)
// ======================
console.log("STARTING SERVER...");

const path = require('path');
const dns = require('dns');

// Force IPv4 for DNS — fixes Supabase connect timeouts on some hosts
dns.setDefaultResultOrder('ipv4first');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '.env') });

console.log(`[Config] Supabase URL: ${process.env.SUPABASE_URL || 'MISSING'}`);
console.log(`[Config] Supabase Key Available: ${!!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)}`);

// CONFIGURATION SANITY CHECK
const checkConfigs = () => {
    const isStripeInSupabase = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').startsWith('sb_') || 
                                (process.env.SUPABASE_ANON_KEY || '').startsWith('sb_');
    
    if (isStripeInSupabase) {
        console.error('\n' + '='.repeat(60));
        console.error('⚠️  CRITICAL CONFIGURATION ERROR DETECTED  ⚠️');
        console.error('You have a Stripe key (sb_...) in your Supabase variables!');
        console.error('Please fix your .env file or Render environment variables.');
        console.error('='.repeat(60) + '\n');
    }
};
checkConfigs();

// Global crash guards
process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]:', error);
});

// ======================
// IMPORTS
// ======================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const { validateEnv } = require('./config/env');
const logger = require('./utils/logger');
const { initSocketIO } = require('./socket/index');

// Validate env before anything else
validateEnv();

// ======================
// INIT APP
// ======================
const app = express();

// ======================
// MIDDLEWARE
// ======================

// Request logger (dev only)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`[${req.method}] ${req.url}`);
        next();
    });
}

// CORS Configuration
const allowedOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
    'http://localhost:3000',
    'https://connectfreelance.in',
    'https://www.connectfreelance.in',
    'https://coonnectt.vercel.app',
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // 1. Allow non-browser requests (Postman, mobile, etc)
        if (!origin) return callback(null, true);

        // 2. Exact Match
        if (allowedOrigins.includes(origin)) return callback(null, true);

        // 3. Localhost Regex
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }

        // 4. Production Subdomain Match (Safety fallback)
        if (origin.endsWith('.connectfreelance.in')) {
            return callback(null, true);
        }

        console.warn(`[CORS Blocked] Origin: ${origin}`);
        callback(null, false); // Block origin but don't crash app
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cache-Control', 'Pragma', 'x-client-info'],
    exposedHeaders: ['Set-Cookie']
};

app.use(cors(corsOptions));

// Handle preflight requests for ALL routes (Regex literal for Express 5 compatibility)
app.options(/.*/, cors(corsOptions));

// Helmet (security headers)
app.use(helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: [
                "'self'", 
                'https://*.supabase.co', 
                'wss://*.supabase.co',
                'https://connect-backend-1-dm8d.onrender.com', // legacy
    'https://connectfreelance-backend.onrender.com',
    'wss://connectfreelance-backend.onrender.com',
                'https://connectfreelance.in',
                'http://localhost:*',
                'http://127.0.0.1:*',
                'ws://localhost:*',
                'ws://127.0.0.1:*'
            ],
            fontSrc: ["'self'", 'https:', 'data:'],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", 'https:', 'data:', 'blob:'],
            frameSrc: ["'self'", 'https://*.stripe.com']
        }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

// ======================
// ROOT + HEALTH (Move to TOP for fastest Render response)
// ======================
app.get('/', (_req, res) => res.send('Connect Platform API is Live'));
app.get('/api/health', (_req, res) => {
    res.status(200).json({ success: true, message: 'Connect.com API is running 🚀' });
});

// Payment webhooks need raw body — must come BEFORE express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }));

app.use(express.json());

// Error tracking middleware — logs 4xx/5xx per user/feature
app.use(require('./middleware/errorTracker'));

// ======================
// ROUTE REGISTRATION (Deferred/Parallelized)
// ======================
const registerRoutes = () => {
    console.log("[Boot] Registering API routes...");
    app.use('/api/auth',            require('./routes/authRoutes'));
    app.use('/api/connects',        require('./routes/connectsRoutes'));
    app.use('/api/jobs',            require('./routes/jobRoutes'));
    app.use('/api/proposals',       require('./routes/proposalRoutes'));
    app.use('/api/contracts',       require('./routes/contractsRoutes'));
    app.use('/api/payments',        require('./routes/paymentRoutes'));
    app.use('/api/subscriptions',   require('./routes/subscriptionRoutes'));
    app.use('/api/membership',      require('./routes/membershipRoutes'));
    app.use('/api/notifications',   require('./routes/notificationRoutes'));
    app.use('/api/teams',           require('./routes/teamsRoutes'));
    app.use('/api/account',         require('./routes/accountRoutes'));
    app.use('/api/admin',           require('./routes/adminRoutes'));
    app.use('/api/profile',         require('./routes/profileRoutes'));
    app.use('/api/client',          require('./routes/clientProfileRoutes'));
    app.use('/api/conversations',   require('./routes/conversationRoutes'));
    app.use('/api/services',        require('./routes/servicesRoutes'));
    app.use('/api/promotions',      require('./routes/promotionsRoutes'));
    app.use('/api/freelancer',      require('./routes/freelancerAccountHealthRoutes'));
    app.use('/api/identity',        require('./routes/identityVerificationRoutes'));
    app.use('/api/clients',         require('./routes/clientRoutes'));
    app.use('/api/direct-contracts',require('./routes/directContractRoutes'));
    app.use('/api/hourly',          require('./routes/hourlyActivityRoutes'));
    app.use('/api/reports',         require('./routes/reportsRoutes'));
    app.use('/api/billing',         require('./routes/billingRoutes'));
    app.use('/api/consultations',   require('./routes/consultationRoutes'));
    app.use('/api/withdrawals',     require('./routes/withdrawalsRoutes'));
    app.use('/api/bookmarks',       require('./routes/bookmarkRoutes'));
    app.use('/api/lottery',         require('./routes/lotteryRoutes'));
    app.use('/api/relationship',    require('./routes/relationshipRoutes'));
    app.use('/api/menu',            require('./routes/menuRoutes'));
    app.use('/api/milestones',      require('./routes/milestoneRoutes'));
    app.use('/api/policies',        require('./routes/policyRoutes'));
    app.use('/api/reviews',         require('./routes/reviewRoutes'));
    app.use('/api/site-reviews',    require('./routes/siteReviewRoutes'));
    app.use('/api/wallet',          require('./routes/walletRoutes'));
    app.use('/api/bank-accounts',   require('./routes/bankAccountRoutes'));
    app.use('/api/fake-escrow',     require('./routes/fakeEscrowRoutes'));
    app.use('/api/submissions',     require('./routes/workSubmissionRoutes'));
    app.use('/api/work-diary',      require('./routes/workDiaryRoutes'));
    app.use('/api/activity',        require('./routes/activityRoutes'));
    app.use('/api/work-logs',       require('./routes/workLogRoutes'));
    app.use('/api/reliability',     require('./routes/reliabilityRoutes'));
    app.use('/api/interventions',   require('./routes/interventionRoutes'));
    app.use('/api/deliveries',      require('./routes/deliveriesRoutes'));
    app.use('/api/skimmer',         require('./routes/skimmerRoutes'));
    app.use('/api/verification',    require('./routes/verificationRoutes'));
    app.use('/api/ai',              require('./routes/aiAssistantRoutes'));
    app.use('/api/ai-assistant',    require('./routes/aiAssistantRoutes'));
    app.use('/api/presence',        require('./routes/presenceRoutes'));
    app.use('/api/calls',           require('./routes/callLogRoutes'));
    app.use('/api/meetings',        require('./routes/meetingRoutes'));
    app.use('/api/stats',           require('./routes/statsRoutes'));
    app.use('/api/faqs',            require('./routes/faqRoutes'));
    app.use('/api/problems',        require('./routes/userProblemRoutes'));
    app.use('/api/support',         require('./routes/supportRoutes'));
    app.use('/api/plans',           require('./routes/plansRoutes'));
    app.use('/api/announcements',   require('./routes/announcementsRoutes'));
    app.use('/api/recommendations', require('./routes/recommendationRoutes'));
    console.log("[Boot] All routes registered.");
};

// ======================
// STARTUP SEQUENCE
// ======================
const startServer = () => {
    try {
        console.log("[Boot] Starting initialization sequence...");
        
        // 1. REGISTER ROUTES FIRST
        registerRoutes();
        
        // 2. CONFIGURE RATE LIMITERS
        const { globalLimiter, authLimiter, paymentLimiter } = require('./middleware/rateLimiter');
        app.use('/api/', globalLimiter);
        app.use('/api/auth/login', authLimiter);
        app.use('/api/auth/signup', authLimiter);
        app.use('/api/admin/login', authLimiter);
        app.use('/api/payments', paymentLimiter);

        // 3. LISTEN
        const PORT = Number(process.env.PORT) || 10000;
        const server = app.listen(PORT, () => {
            console.log("=========================================");
            console.log("SERVER LISTENING ON PORT:", PORT);
            console.log("=========================================");
            
            // 4. LOAD SOCKETS & CRONS AFTER LISTENING
            try {
                initCrons();
                initSocketIO(server);
                console.log("[Boot] Server stabilization complete. API is ready. 🚀");
            } catch (err) {
                console.error("[Boot] Post-listen initialization failed:", err);
            }
        });

        // 5. GLOBAL CRASH GUARD
        server.on('error', (err) => {
            console.error("[Fatal] Server failed to start:", err);
            process.exit(1);
        });

    } catch (err) {
        console.error("[Fatal] Boot sequence failed:", err);
        process.exit(1);
    }
};

// Block direct access to source files
app.use((req, _res, next) => {
    const forbidden = ['/src', '.jsx', '.tsx', '.js.map', 'package.json', 'vite.config.js', '.env'];
    if (forbidden.some(p => req.url.includes(p))) {
        console.warn(`[Security] Blocked: ${req.url} from ${req.ip}`);
        return _res.status(403).json({ success: false, message: 'Access Forbidden' });
    }
    next();
});

/**
 * PRODUCTION DIAGNOSTIC ROUTE
 */
app.get('/api/health/debug-config', (req, res) => {
    const mask = (str) => str ? `${str.substring(0, 8)}...` : 'MISSING';
    console.log('--- PRODUCTION CONFIG DIAGNOSTIC ---');
    console.log(`URL: ${mask(process.env.SUPABASE_URL)}`);
    res.status(200).json({ success: true, message: 'Config logged to server console.' });
});

// ======================
// CRON (production only)
// ======================
const initCrons = () => {
    if (process.env.NODE_ENV === 'production') {
        const { runReliabilityCron } = require('./scripts/reliabilityCron');
        const { runPlatformAudit } = require('./scripts/platformAuditCron');
        const { syncWithStripe } = require('./services/reconciliationService');
        const jobRecommendationService = require('./services/jobRecommendationService');

        cron.schedule('0 0 * * *', () => runReliabilityCron());
        cron.schedule('0 1 * * *', () => runPlatformAudit());
        cron.schedule('0 * * * *', () => syncWithStripe());
        // Nightly rec refresh at 2 AM IST (UTC+5:30 = 20:30 UTC previous day)
        cron.schedule('30 20 * * *', () => {
            logger.info('[Cron] Starting nightly recommendation refresh...');
            jobRecommendationService.runNightlyRefresh();
        });
        console.log("[Boot] Cron jobs scheduled.");
    }
};

// ======================
// ERROR HANDLER
// ======================
app.use((err, req, res, _next) => {
    logger.error('SERVER ERROR:', err);
    const statusCode = parseInt(err?.statusCode || err?.status || 500, 10) || 500;
    res.status(statusCode).json({
        success: false,
        message: err?.message || 'Internal Server Error'
    });
});

// START THE SERVER
startServer();
