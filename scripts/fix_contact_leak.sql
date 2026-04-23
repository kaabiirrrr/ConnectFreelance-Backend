-- 1. Modify profiles to include privacy and enforcement fields
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_restricted BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ban_reason TEXT,
ADD COLUMN IF NOT EXISTS warning_count INTEGER DEFAULT 0;

-- 2. Create violations table
CREATE TABLE IF NOT EXISTS violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(user_id) ON DELETE CASCADE,
  message TEXT,
  type TEXT,
  severity TEXT,
  confidence FLOAT,
  detected_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Policy (optional but good for RBAC): Only Admin can see violations
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin can view all violations" ON violations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role IN ('ADMIN', 'SUPER_ADMIN'))
);
