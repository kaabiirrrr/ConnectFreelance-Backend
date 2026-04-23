-- ── 1. SCHEMA ENHANCEMENTS ──────────────────────────────────────────
-- Add tracking columns for better audit trails, analytics, and idempotency
ALTER TABLE connect_transactions ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE connect_transactions ADD COLUMN IF NOT EXISTS action_source TEXT;
ALTER TABLE connect_transactions ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
ALTER TABLE connect_transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'COMPLETED';

-- ── 2. UNIQUENESS & CONCURRENCY PROTECTION ───────────────────────
-- Prevent duplicate credits for the same external transaction (e.g. Razorpay Order)
CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_reference 
ON connect_transactions(reference_id) 
WHERE reference_id IS NOT NULL;

-- ── 3. ATOMIC CONNECT CREDIT RPC ──────────────────────────────────
-- Handles balance update + transaction logging in a single database transaction
CREATE OR REPLACE FUNCTION credit_connects_atomic(
  p_user_id UUID,
  p_amount INT,
  p_action TEXT,
  p_description TEXT,
  p_action_source TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) 
RETURNS INT
SECURITY DEFINER
AS $$
DECLARE
  current_balance INT;
  new_balance INT;
BEGIN
  -- 1. Check for duplicate reference
  IF p_reference_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM connect_transactions WHERE reference_id = p_reference_id AND status = 'COMPLETED') THEN
      SELECT connects INTO current_balance FROM user_connects WHERE user_id = p_user_id;
      RETURN current_balance;
    END IF;
  END IF;

  -- 2. Lock or Create wallet
  INSERT INTO user_connects (user_id, connects, updated_at)
  VALUES (p_user_id, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT connects INTO current_balance 
  FROM user_connects 
  WHERE user_id = p_user_id 
  FOR UPDATE;

  -- 3. Update balance
  new_balance := current_balance + p_amount;
  UPDATE user_connects 
  SET connects = new_balance, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 4. Log transaction
  INSERT INTO connect_transactions (
    user_id, type, amount, action, description, action_source, reference_id, metadata, status, created_at
  ) VALUES (
    p_user_id, 'CREDIT', p_amount, p_action, p_description, p_action_source, p_reference_id, p_metadata, 'COMPLETED', NOW()
  );

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- ── 4. ATOMIC CONNECT DEBIT RPC ───────────────────────────────────
-- Handles balance deduction + transaction logging with strict balance checks
CREATE OR REPLACE FUNCTION debit_connects_atomic(
  p_user_id UUID,
  p_amount INT,
  p_action TEXT,
  p_description TEXT,
  p_action_source TEXT,
  p_metadata JSONB DEFAULT '{}'
) 
RETURNS INT
SECURITY DEFINER
AS $$
DECLARE
  current_balance INT;
  new_balance INT;
BEGIN
  -- 1. Lock wallet for update
  SELECT connects INTO current_balance 
  FROM user_connects 
  WHERE user_id = p_user_id 
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND';
  END IF;

  -- 2. Check sufficient funds
  IF current_balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CONNECTS';
  END IF;

  -- 3. Deduct
  new_balance := current_balance - p_amount;
  UPDATE user_connects 
  SET connects = new_balance, updated_at = NOW()
  WHERE user_id = p_user_id;

  -- 4. Log transaction
  INSERT INTO connect_transactions (
    user_id, type, amount, action, description, action_source, metadata, status, created_at
  ) VALUES (
    p_user_id, 'DEBIT', p_amount, p_action, p_description, p_action_source, p_metadata, 'COMPLETED', NOW()
  );

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;
