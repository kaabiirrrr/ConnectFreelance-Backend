const { z } = require('zod');

const createJobSchema = z.object({
    title: z.string()
        .min(5, 'Title must be at least 5 characters')
        .max(100, 'Title cannot exceed 100 characters')
        .trim(),
    description: z.string()
        .min(20, 'Description must be at least 20 characters')
        .max(5000, 'Description too long'),
    category: z.string().min(1, 'Category is required'),
    skills: z.array(z.string()).optional().default([]),
    budget_type: z.enum(['fixed', 'hourly']),
    budget_amount: z.coerce.number().min(0, 'Budget must be at least 0'),
    experience_level: z.enum(['beginner', 'intermediate', 'expert']),
    duration: z.string().min(1, 'Duration is required'),
    bid_deadline: z.string().optional(),
    status: z.enum(['OPEN', 'DRAFT', 'CLOSED']).optional(),
    attachments: z.array(z.any()).optional(),
    job_mode: z.enum(['single', 'team']).optional().default('single'),
    roles: z.array(z.object({
        title: z.string().min(2),
        description: z.string().optional(),
        budget: z.coerce.number().min(1),
        positions: z.coerce.number().min(1).optional().default(1),
        priority: z.coerce.number().optional().default(0),
        bid_deadline: z.string().optional()
    })).optional()

});

module.exports = {
    createJobSchema
};

