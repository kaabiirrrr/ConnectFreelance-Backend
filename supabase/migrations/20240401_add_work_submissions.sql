-- Migration: Add work_submissions table

-- Define the table
CREATE TABLE IF NOT EXISTS public.work_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    description TEXT,
    attachment_url TEXT,
    attachment_name TEXT,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REQUEST_CHANGES', 'REJECTED')),
    client_feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_work_submissions_contract ON public.work_submissions(contract_id);
CREATE INDEX IF NOT EXISTS idx_work_submissions_freelancer ON public.work_submissions(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_work_submissions_status ON public.work_submissions(status);

-- Trigger for updated_at
CREATE TRIGGER update_work_submissions_updated_at 
    BEFORE UPDATE ON public.work_submissions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update DB schema references (doc only)
COMMENT ON TABLE public.work_submissions IS 'Stores work delivered by freelancers for specific contracts';
