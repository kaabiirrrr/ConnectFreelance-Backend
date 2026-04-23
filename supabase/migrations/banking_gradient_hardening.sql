-- 1. Add Idempotency Key to Withdrawals
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- 2. Ensure Audit Logs can capture IP & UA
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE admin_audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- 3. Banking-Grade Atomic Withdrawal Processor
CREATE OR REPLACE FUNCTION process_withdrawal_safe(
    p_withdrawal_id UUID,
    p_admin_id UUID,
    p_action TEXT, -- 'APPROVE' or 'REJECT'
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
    -- 1. ATOMIC LOCK (FOR UPDATE)
    SELECT status, amount, freelancer_id 
    INTO v_current_status, v_amount, v_freelancer_id
    FROM withdrawals 
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    -- 2. VALIDATE STATE MACHINE
    IF v_current_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Withdrawal not found');
    END IF;

    IF v_current_status != 'PENDING' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Withdrawal is already ' || v_current_status);
    END IF;

    -- 3. CHECK IDEMPOTENCY (Optional if key is provided)
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM withdrawals WHERE idempotency_key = p_idempotency_key AND id != p_withdrawal_id) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Duplicate request detected (Idempotency)');
        END IF;
    END IF;

    -- 4. PROCESS ACTION
    IF p_action = 'APPROVE' THEN
        v_new_status := 'COMPLETED'; 
    ELSIF p_action = 'REJECT' THEN
        v_new_status := 'REJECTED';
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Invalid action');
    END IF;

    -- 5. PERFORM ATOMIC UPDATES
    
    -- Update Withdrawal
    UPDATE withdrawals 
    SET 
        status = v_new_status,
        rejection_reason = p_rejection_reason,
        processed_at = NOW(),
        processed_by = p_admin_id,
        idempotency_key = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_withdrawal_id;

    -- Log Transaction (If approved)
    IF p_action = 'APPROVE' THEN
        -- Check if it was already deducted to prevent double-dip if logic changes later
        -- INSERT INTO transactions...
        -- UPDATE profiles SET balance = balance - v_amount...
        NULL; -- Placeholder for specific balance table if exists
    END IF;

    -- Log Admin Action
    INSERT INTO admin_audit_logs (admin_id, action, target_id, details, ip_address, user_agent)
    VALUES (p_admin_id, 'WITHDRAWAL_' || p_action, p_withdrawal_id, 
            'Withdrawal ' || p_withdrawal_id || ' ' || lower(p_action) || 'd',
            p_ip_address, p_user_agent);

    RETURN jsonb_build_object('success', true, 'new_status', v_new_status);

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
