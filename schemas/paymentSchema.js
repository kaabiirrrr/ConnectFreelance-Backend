const { z } = require('zod');

const createIntentSchema = z.object({
    contract_id: z.string().uuid('Invalid contract ID'),
    amount: z.union([z.number().positive('Amount must be positive'), z.string().transform(Number)])
});

const escrowDepositSchema = z.object({
    contract_id: z.string().uuid('Invalid contract ID'),
    payment_intent_id: z.string().min(1, 'Payment intent ID is required'),
    amount: z.union([z.number().positive(), z.string().transform(Number)])
});

const releaseEscrowSchema = z.object({
    payment_id: z.string().uuid('Invalid payment ID')
});

const refundEscrowSchema = z.object({
    payment_id: z.string().uuid('Invalid payment ID')
});

module.exports = { createIntentSchema, escrowDepositSchema, releaseEscrowSchema, refundEscrowSchema };
