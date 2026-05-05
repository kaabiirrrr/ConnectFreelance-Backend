-- TrustGraph and Reputation Shield Schema Updates

-- 1. Extend profiles table with behavioral signals and trust metrics
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS device_ids jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS ip_history jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS payout_hashes jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS internal_trust_score integer DEFAULT 50,
ADD COLUMN IF NOT EXISTS trust_score_breakdown jsonb DEFAULT '{}'::jsonb;

-- 2. Create fraud_links table
CREATE TABLE IF NOT EXISTS public.fraud_links (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_a_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    user_b_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    link_type text NOT NULL, -- 'DEVICE', 'IP', 'PAYOUT', 'BEHAVIOR'
    weight numeric DEFAULT 1.0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    UNIQUE(user_a_id, user_b_id, link_type)
);

-- 3. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_fraud_links_user_a ON public.fraud_links(user_a_id);
CREATE INDEX IF NOT EXISTS idx_fraud_links_user_b ON public.fraud_links(user_b_id);
CREATE INDEX IF NOT EXISTS idx_fraud_links_type ON public.fraud_links(link_type);

-- 4. Enable RLS and set policies (Admin only access)
ALTER TABLE public.fraud_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage fraud links"
ON public.fraud_links
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.admins WHERE id = auth.uid()
    )
);

-- 5. Add comment for clarity
COMMENT ON TABLE public.fraud_links IS 'Tracks behavioral relationships between users for multi-account fraud detection.';
