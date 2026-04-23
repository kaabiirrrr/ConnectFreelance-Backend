-- Migration: Add Work Delivery System (10/10+ PREMIER)
-- Tables: deliveries, delivery_files, delivery_comments

-- 1. DELIVERIES TABLE
CREATE TABLE IF NOT EXISTS public.deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    
    freelancer_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    
    message TEXT,
    work_link TEXT,
    delivery_type TEXT CHECK (delivery_type IN ('file', 'link', 'mixed')),
    
    status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'revision_requested')),
    version INTEGER DEFAULT 1,
    revision_count INTEGER DEFAULT 0,
    
    first_submission_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    final_approval_time TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_deliveries_contract ON public.deliveries(contract_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_freelancer ON public.deliveries(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_client ON public.deliveries(client_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON public.deliveries(status);

-- 2. DELIVERY_FILES TABLE
CREATE TABLE IF NOT EXISTS public.delivery_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID REFERENCES public.deliveries(id) ON DELETE CASCADE,
    
    file_url TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    file_type TEXT NOT NULL,
    file_hash TEXT, -- SHA-256 for duplicate detection
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_files_delivery ON public.delivery_files(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_files_hash ON public.delivery_files(file_hash);

-- 3. DELIVERY_COMMENTS TABLE
CREATE TABLE IF NOT EXISTS public.delivery_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID REFERENCES public.deliveries(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    
    comment TEXT NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Explicit foreign key for joining profiles by user_id
ALTER TABLE public.delivery_comments 
    ADD CONSTRAINT delivery_comments_user_id_profiles_fkey 
    FOREIGN KEY (user_id) REFERENCES public.profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_delivery_comments_delivery ON public.delivery_comments(delivery_id);

-- 4. RPC for Atomic Revision Increment
CREATE OR REPLACE FUNCTION public.increment_revision_count(delivery_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.deliveries
    SET revision_count = revision_count + 1
    WHERE id = delivery_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. TRIGGERS for updated_at
CREATE TRIGGER update_deliveries_updated_at 
    BEFORE UPDATE ON public.deliveries 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. STORAGE BUCKET CONFIGURATION (Note: This is usually done via API or Dashboard, but we document it here)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('deliveries', 'deliveries', false) ON CONFLICT DO NOTHING;
