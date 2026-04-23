require('dotenv').config();
const adminClient = require('../supabase/adminClient');
const crypto = require('crypto');

async function generatePromoCodes() {
    const codes = [];
    for (let i = 0; i < 20; i++) {
        const code = 'CONNECT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push({
            code,
            connects_reward: 100,
            max_uses: 1,
            used_count: 0,
            is_active: true,
            discount_percent: 10,
            expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
        });
    }

    const { data, error } = await adminClient
        .from('promo_codes')
        .insert(codes)
        .select('code, connects_reward, expires_at');

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    console.log('\n✅ Generated 20 promo codes (100 connects each):\n');
    data.forEach((c, i) => console.log(`${i + 1}. ${c.code}`));
    console.log('\nExpires: 90 days from now');
}

generatePromoCodes();
