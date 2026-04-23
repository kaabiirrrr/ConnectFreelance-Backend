const { z } = require('zod');

const createReviewSchema = z.object({
    contract_id: z.string().uuid('Invalid contract ID'),
    rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
    comment: z.string().max(2000, 'Comment too long').trim().optional()
});

module.exports = { createReviewSchema };
