-- Migration: Trust Graph v2 - Relationship Stats
-- Description: Creates the client_freelancer_stats table for personalized relationship intelligence.

CREATE TABLE IF NOT EXISTS public.client_freelancer_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    total_projects INTEGER DEFAULT 0,
    completed_projects INTEGER DEFAULT 0,
    cancelled_projects INTEGER DEFAULT 0,
    avg_rating_by_client DECIMAL(3,2) DEFAULT 0,
    on_time_rate DECIMAL(5,2) DEFAULT 100,
    avg_response_time INTEGER DEFAULT 0, -- in minutes
    revisions_avg DECIMAL(3,2) DEFAULT 0,
    communication_score INTEGER DEFAULT 100,
    trust_score INTEGER DEFAULT 75,
    last_project_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    last_project_name TEXT,
    last_project_date TIMESTAMP WITH TIME ZONE,
    ai_summary TEXT DEFAULT 'Insights updating...',
    compatibility_score INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(client_id, freelancer_id)
);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_client_freelancer_stats_updated_at ON public.client_freelancer_stats;
CREATE TRIGGER update_client_freelancer_stats_updated_at 
BEFORE UPDATE ON public.client_freelancer_stats 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE public.client_freelancer_stats ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Clients can view their own relationship stats" 
ON public.client_freelancer_stats FOR SELECT 
USING (auth.uid() = client_id);

CREATE POLICY "Admins can view all relationship stats" 
ON public.client_freelancer_stats FOR ALL 
USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

-- Global index for lookups
CREATE INDEX IF NOT EXISTS idx_relationship_stats_client_freelancer ON public.client_freelancer_stats(client_id, freelancer_id);

COMMENT ON TABLE public.client_freelancer_stats IS 'Stores personalized trust and relationship metrics between clients and freelancers';
