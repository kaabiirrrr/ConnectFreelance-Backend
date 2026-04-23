const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Standard error response for rate limiting
 */
const rateLimitHandler = (message) => (req, res) => {
    res.status(429).json({
        success: false,
        data: null,
        message: message || 'Too many requests, please try again later'
    });
};

/**
 * Global rate limiter for all API routes
 * Dev: bypassed entirely
 * Prod: 1000 requests per 15 minutes per IP
 */
const globalLimiter = isDev
    ? (req, res, next) => next() // No limit in development
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 1000,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: rateLimitHandler('Too many requests from this IP, please try again after 15 minutes')
    });

/**
 * Auth rate limiter - prevents brute force
 * Dev: bypassed
 * Prod: 30 requests per 15 minutes
 */
const authLimiter = isDev
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: rateLimitHandler('Too many authentication attempts, please try again after 15 minutes')
    });

/**
 * Payment limiter - stricter for billing
 * Dev: bypassed
 * Prod: 50 requests per 15 minutes
 */
const paymentLimiter = isDev
    ? (req, res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 50,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        handler: rateLimitHandler('Too many payment requests, please try again after 15 minutes')
    });

module.exports = {
    globalLimiter,
    authLimiter,
    paymentLimiter
};
