const { z } = require('zod');

const createContractSchema = z.object({
    proposal_id: z.string().uuid('Invalid proposal ID'),
    job_id: z.string().uuid('Invalid job ID'),
    freelancer_id: z.string().uuid('Invalid freelancer ID'),
    agreed_rate: z.union([z.number().positive(), z.string().transform(Number)]),
    start_date: z.string().datetime().optional(),
    end_date: z.string().datetime().optional()
});

module.exports = { createContractSchema };
