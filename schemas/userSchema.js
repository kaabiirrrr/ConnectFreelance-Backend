const { z } = require('zod');

const registerSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name too long').trim(),
    email: z.string().email('Invalid email address').trim().toLowerCase(),
    password: z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number')
        .regex(/[!@#$%^&*]/, 'Password must contain at least one special character'),
    role: z.enum(['CLIENT', 'FREELANCER'], { errorMap: () => ({ message: 'Invalid role' }) })
});

const loginSchema = z.object({
    email: z.string().email('Invalid email address').trim().toLowerCase(),
    password: z.string().min(1, 'Password is required')
});

const resetPasswordSchema = z.object({
    email: z.string().email('Invalid email address').trim().toLowerCase()
});

module.exports = {
    registerSchema,
    loginSchema,
    resetPasswordSchema
};
