-- Migration: Add work_diary table
-- Stores hourly work logs for freelancers on hourly contracts

-- Define the table
CREATE TABLE IF NOT EXISTS public.work_diary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    hours DECIMAL(4,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    description TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'BILLED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_work_diary_contract ON public.work_diary(contract_id);
CREATE INDEX IF NOT EXISTS idx_work_diary_freelancer ON public.work_diary(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_work_diary_date ON public.work_diary(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_work_diary_status ON public.work_diary(status);

-- Trigger for updated_at
CREATE TRIGGER update_work_diary_updated_at 
    BEFORE UPDATE ON public.work_diary 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update DB schema references (doc only)
COMMENT ON TABLE public.work_diary IS 'Stores hourly work logs for freelancers on hourly contracts';
