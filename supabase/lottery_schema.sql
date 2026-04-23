-- Lottery System Schema

-- 1. Lottery Draws Table
CREATE TABLE IF NOT EXISTS public.lottery_draws (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    month TEXT NOT NULL, -- Format: YYYY-MM (e.g., '2026-04')
    status TEXT DEFAULT 'PENDING', -- PENDING, RUNNING, COMPLETED
    reward_distribution JSONB NOT NULL, -- Array of objects: [{position: 1, amount: 5000}, ...]
    total_participants INTEGER DEFAULT 0,
    total_tickets INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(month)
);

-- 2. Lottery Tickets Table
CREATE TABLE IF NOT EXISTS public.lottery_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draw_id UUID REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    ticket_number TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(draw_id, ticket_number)
);

-- 3. Lottery Winners Table
CREATE TABLE IF NOT EXISTS public.lottery_winners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draw_id UUID REFERENCES public.lottery_draws(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    reward_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Triggers for updated_at
CREATE TRIGGER update_lottery_draws_updated_at 
BEFORE UPDATE ON public.lottery_draws 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (RLS)
ALTER TABLE public.lottery_draws ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lottery_winners ENABLE ROW LEVEL SECURITY;

-- Policies (Simplified for now, Admin access is handled via service role/API)
CREATE POLICY "Public draws are viewable by all" ON public.lottery_draws FOR SELECT USING (true);
CREATE POLICY "Users can view their own tickets" ON public.lottery_tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Winners are viewable by all" ON public.lottery_winners FOR SELECT USING (true);
