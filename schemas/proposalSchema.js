const { z } = require('zod');

const submitProposalSchema = z.object({
    job_id: z.string().uuid('Invalid job ID'),
    role_id: z.string().uuid('Role selection is mandatory'), // ENFORCE ROLE SELECTION
    cover_letter: z.string()
        .min(20, 'Cover letter must be at least 20 characters')
        .max(5000, 'Cover letter too long')
        .trim(),
    proposed_rate: z.union([
        z.number().positive('Rate must be positive'), 
        z.string().transform(val => parseFloat(val)).refine(val => !isNaN(val) && val > 0, 'Enter a valid positive bid amount')
    ]),
    estimated_duration: z.string().max(100).optional(),
    attachments: z.array(z.string()).optional().default([])
});

const updateProposalStatusSchema = z.object({
    status: z.enum(['ACCEPTED', 'REJECTED'], { errorMap: () => ({ message: 'Status must be ACCEPTED or REJECTED' }) }),
    role: z.string().optional(),
    scope: z.string().optional(),
    escrow_funded: z.boolean().optional().default(false) // For strict validation
});

module.exports = { submitProposalSchema, updateProposalStatusSchema };

