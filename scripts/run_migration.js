require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];

console.log('Project ref:', projectRef);

const sqlStatements = [
    `ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE`,
    `ALTER TABLE public.admin_audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT`,
    `ALTER TABLE public.admin_audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT`,
    `CREATE OR REPLACE FUNCTION process_withdrawal_safe(
        p_withdrawal_id UUID,
        p_admin_id UUID,
        p_action TEXT,
        p_rejection_reason TEXT DEFAULT NULL,
        p_idempotency_key TEXT DEFAULT NULL,
        p_ip_address TEXT DEFAULT NULL,
        p_user_agent TEXT DEFAULT NULL
    ) RETURNS JSONB AS $$
    DECLARE
        v_current_status TEXT;
        v_amount DECIMAL;
        v_freelancer_id UUID;
        v_new_status TEXT;
    BEGIN
        SELECT status, amount, freelancer_id 
        INTO v_current_status, v_amount, v_freelancer_id
        FROM withdrawals 
        WHERE id = p_withdrawal_id
        FOR UPDATE;

        IF v_current_status IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Withdrawal not found');
        END IF;

        IF v_current_status != 'PENDING' THEN
            RETURN jsonb_build_object('success', false, 'message', 'Withdrawal is already ' || v_current_status);
        END IF;

        IF p_idempotency_key IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = p_idempotency_key AND id != p_withdrawal_id) THEN
                RETURN jsonb_build_object('success', false, 'message', 'Duplicate request detected (Idempotency)');
            END IF;
        END IF;

        IF p_action = 'APPROVE' THEN
            v_new_status := 'COMPLETED'; 
        ELSIF p_action = 'REJECT' THEN
            v_new_status := 'REJECTED';
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Invalid action');
        END IF;

        UPDATE withdrawals 
        SET 
            status = v_new_status,
            rejection_reason = p_rejection_reason,
            processed_at = NOW(),
            processed_by = p_admin_id,
            idempotency_key = COALESCE(p_idempotency_key, idempotency_key)
        WHERE id = p_withdrawal_id;

        INSERT INTO admin_audit_logs (admin_id, action, target_id, details, ip_address, user_agent)
        VALUES (p_admin_id, 'WITHDRAWAL_' || p_action, p_withdrawal_id, 
                'Withdrawal ' || p_withdrawal_id || ' ' || lower(p_action) || 'd',
                p_ip_address, p_user_agent);

        RETURN jsonb_build_object('success', true, 'new_status', v_new_status);
    EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', SQLERRM);
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;`
];

function runSQL(sql) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ query: sql });

        // Try management API
        const options = {
            hostname: 'api.supabase.com',
            path: `/v1/projects/${projectRef}/database/query`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'apikey': SERVICE_KEY,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ success: true, data });
                } else {
                    resolve({ success: false, status: res.statusCode, data });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function runMigration() {
    console.log('\n🚀 Running Admin Profile Migration...\n');
    let allOk = true;

    for (const sql of sqlStatements) {
        const preview = sql.substring(0, 70) + (sql.length > 70 ? '...' : '');
        const result = await runSQL(sql);
        if (result.success) {
            console.log(`✅ ${preview}`);
        } else {
            console.log(`❌ ${preview}`);
            console.log(`   Status: ${result.status}, Response: ${result.data.substring(0, 200)}`);
            allOk = false;
        }
    }

    if (allOk) {
        console.log('\n✅ Migration complete! All columns added successfully.');
        console.log('   Reload the admin panel and the profile page should work now.');
    } else {
        console.log('\n⚠️  Some statements failed. The Management API may not support DDL.');
        console.log('   Please run the SQL manually in: https://supabase.com/dashboard/project/' + projectRef + '/sql');
    }
}

runMigration().catch(console.error);
