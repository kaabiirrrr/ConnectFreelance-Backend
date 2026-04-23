const { z } = require('zod');
const logger = require('../utils/logger');

/**
 * Higher-order middleware to validate requests against a Zod schema
 * @param {Object} schemas - Object containing zod schemas for body, query, and/or params
 */
const validate = (schemas) => async (req, res, next) => {
    try {
        if (schemas.body) {
            req.body = await schemas.body.parseAsync(req.body);
        }
        if (schemas.query) {
            req.query = await schemas.query.parseAsync(req.query);
        }
        if (schemas.params) {
            req.params = await schemas.params.parseAsync(req.params);
        }
        next();
    } catch (error) {
        if (error instanceof z.ZodError) {
            const issues = error.issues || error.errors || [];
            const errorMessages = issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            }));
            
            logger.warn(`[Validation] Request validation failed for ${req.method} ${req.url}`, {
                errors: errorMessages,
                received: req.body
            });
            
            return res.status(400).json({
                success: false,
                message: 'Invalid input data',
                errors: errorMessages
            });
        }
        
        logger.error(`[Validation] Unexpected validation error:`, error);
        res.status(500).json({ success: false, message: 'Internal server error during validation' });
    }
};

module.exports = validate;
