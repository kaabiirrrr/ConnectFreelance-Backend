const { z } = require('zod');

const createMilestoneSchema = z.object({
    contract_id: z.string().uuid('Invalid contract ID'),
    title: z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title too long').trim(),
    description: z.string().max(2000, 'Description too long').trim().optional(),
    amount: z.number().positive('Amount must be positive').optional(),
    due_date: z.string().datetime({ offset: true }).optional()
});

const updateMilestoneStatusSchema = z.object({
    status: z.enum(['IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REVISION'], {
        errorMap: () => ({ message: 'Status must be IN_PROGRESS, SUBMITTED, APPROVED, or REVISION' })
    })
});

module.exports = { createMilestoneSchema, updateMilestoneStatusSchema };
