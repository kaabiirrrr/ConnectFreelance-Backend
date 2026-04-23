const { z } = require('zod');

const withdrawSchema = z.object({
    amount: z.number().positive('Withdrawal amount must be positive').max(100000, 'Maximum withdrawal is $100,000')
});

module.exports = { withdrawSchema };
