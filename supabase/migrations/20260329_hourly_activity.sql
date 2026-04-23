-- Hourly Contract Activity: timesheets, work diary entries
-- Run in Supabase SQL Editor

-- Timesheets: weekly billing periods per hourly contract
CREATE TABLE IF NOT EXISTS public.timesheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,  -- Monday of the billing week
    week_end DATE NOT NULL,    -- Sunday of the billing week
    total_hours DECIMAL(6,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DISPUTED', 'PAID')),
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT timesheets_contract_week_unique UNIQUE (contract_id, week_start)
);

-- Work diary entries: individual time log entries within a timesheet
CREATE TABLE IF NOT EXISTS public.work_diary_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
    contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    hours DECIMAL(4,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
    description TEXT NOT NULL,
    screenshot_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timesheets_contract_id ON public.timesheets(contract_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_freelancer_id ON public.timesheets(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_client_id ON public.timesheets(client_id);
CREATE INDEX IF NOT EXISTS idx_work_diary_timesheet_id ON public.work_diary_entries(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_work_diary_freelancer_id ON public.work_diary_entries(freelancer_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_timesheets_updated_at ON public.timesheets;
CREATE TRIGGER update_timesheets_updated_at
    BEFORE UPDATE ON public.timesheets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_work_diary_updated_at ON public.work_diary_entries;
CREATE TRIGGER update_work_diary_updated_at
    BEFORE UPDATE ON public.work_diary_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants view timesheets" ON public.timesheets;
CREATE POLICY "Participants view timesheets" ON public.timesheets FOR SELECT
    USING (auth.uid() = freelancer_id OR auth.uid() = client_id);

DROP POLICY IF EXISTS "Freelancer insert timesheet" ON public.timesheets;
CREATE POLICY "Freelancer insert timesheet" ON public.timesheets FOR INSERT
    WITH CHECK (auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Freelancer update timesheet" ON public.timesheets;
CREATE POLICY "Freelancer update timesheet" ON public.timesheets FOR UPDATE
    USING (auth.uid() = freelancer_id OR auth.uid() = client_id);

DROP POLICY IF EXISTS "Participants view diary" ON public.work_diary_entries;
CREATE POLICY "Participants view diary" ON public.work_diary_entries FOR SELECT
    USING (auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Freelancer manage diary" ON public.work_diary_entries;
CREATE POLICY "Freelancer manage diary" ON public.work_diary_entries FOR ALL
    USING (auth.uid() = freelancer_id);
