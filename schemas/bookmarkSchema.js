const { z } = require('zod');

const toggleBookmarkSchema = z.object({
    job_id: z.string().uuid('Invalid job ID')
});

module.exports = { toggleBookmarkSchema };
