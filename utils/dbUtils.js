const logger = require('./logger');

/**
 * DB UTILS: High-Resilience & Backpressure Logic
 */

let activeOperations = 0;
const MAX_CONCURRENT_FINANCIAL_OPS = 50; // Threshold for 503 Backpressure

/**
 * Backpressure Middleware for Financial Endpoints
 * Prevents system saturation during peak load/attack.
 */
exports.financialBackpressure = (req, res, next) => {
    if (activeOperations >= MAX_CONCURRENT_FINANCIAL_OPS) {
        logger.warn(`[Backpressure] Max concurrency reached (${activeOperations}). Returning 503.`);
        res.setHeader('Retry-After', '2');
        return res.status(503).json({
            success: false,
            message: 'System busy, transaction processing. Please retry in a few seconds.'
        });
    }
    next();
};

/**
 * Execute with Automatic Retry (Deadlock/Lock Timeout Handling)
 * Error Codes: 40001 (Serialization Failure), 55P03 (Lock Not Available)
 */
exports.executeWithRetry = async (operationFn, maxRetries = 2, delayMs = 200) => {
    let lastError;
    activeOperations++;

    try {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await operationFn();
            } catch (err) {
                lastError = err;
                
                // Codes to retry: Serialization failure or Lock Timeout
                const isRetryable = err.code === '40001' || err.code === '55P03' || (err.message && err.message.includes('lock timeout'));

                if (isRetryable && attempt < maxRetries) {
                    const backoff = delayMs * Math.pow(2, attempt); // Exponential backoff
                    logger.warn(`[DB_RETRY] Deadlock/Timeout (Attempt ${attempt + 1}/${maxRetries}). Retrying in ${backoff}ms...`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                    continue;
                }
                
                throw err;
            }
        }
    } finally {
        activeOperations--;
    }
};
