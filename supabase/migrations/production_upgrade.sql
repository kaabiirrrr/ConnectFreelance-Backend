-- Production Upgrade Migration
-- Adds missing indexes, new tables (reviews, wallets, milestones, bookmarks)
-- Safe to run multiple times (IF NOT EXISTS)
-- Defensive: checks column existence before creating indexes

-- ============================================================
-- INDEXES for Performance (only if columns exist)
-- ============================================================

DO $$
BEGIN
    -- Jobs indexes
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='client_id') THEN
        CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON public.jobs(client_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='status') THEN
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON public.jobs(created_at DESC);
    END IF;

    -- Proposals indexes
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='job_id') THEN
        CREATE INDEX IF NOT EXISTS idx_proposals_job_id ON public.proposals(job_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='freelancer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_proposals_freelancer_id ON public.proposals(freelancer_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='proposals' AND column_name='status') THEN
        CREATE INDEX IF NOT EXISTS idx_proposals_status ON public.proposals(status);
    END IF;

    -- Messages indexes (only columns that exist)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='conversation_id') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='messages' AND column_name='sender_id') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
    END IF;

    -- Notifications indexes
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='user_id') THEN
        CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications' AND column_name='is_read') THEN
        CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read);
    END IF;

    -- Contracts indexes
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='client_id') THEN
        CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON public.contracts(client_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='freelancer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_contracts_freelancer_id ON public.contracts(freelancer_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='status') THEN
        CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts(status);
    END IF;

    -- Payments indexes
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='contract_id') THEN
        CREATE INDEX IF NOT EXISTS idx_payments_contract_id ON public.payments(contract_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='payer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_payments_payer_id ON public.payments(payer_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='status') THEN
        CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
    END IF;

    -- Connects indexes
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='connects' AND column_name='freelancer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_connects_freelancer_id ON public.connects(freelancer_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='connects_history' AND column_name='freelancer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_connects_history_freelancer ON public.connects_history(freelancer_id);
    END IF;

    RAISE NOTICE 'Indexes created successfully';
END $$;

-- ============================================================
-- NEW TABLES
-- ============================================================

-- Reviews & Ratings
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    reviewer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    reviewee_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(contract_id, reviewer_id)  -- One review per contract per reviewer
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_contract ON public.reviews(contract_id);

-- Wallets (freelancer earnings)
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
    available_balance DECIMAL(10,2) DEFAULT 0,
    pending_balance DECIMAL(10,2) DEFAULT 0,
    total_earned DECIMAL(10,2) DEFAULT 0,
    total_withdrawn DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Milestones (contract progress tracking)
CREATE TABLE IF NOT EXISTS public.milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2),
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REVISION')),
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_contract ON public.milestones(contract_id);

-- Bookmarks (saved jobs)
CREATE TABLE IF NOT EXISTS public.bookmarks (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY(user_id, job_id)
);

-- Admin Audit Logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES public.admins(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON public.admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.admin_audit_logs(created_at DESC);

-- Add updated_at triggers for new tables (safe: drops first if exists)
DO $$
BEGIN
    -- Check if the trigger function exists
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_wallets_updated_at') THEN
            CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON public.wallets
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_milestones_updated_at') THEN
            CREATE TRIGGER update_milestones_updated_at BEFORE UPDATE ON public.milestones
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        END IF;
    END IF;
END $$;

-- ============================================================
-- CLEANUP: Remove password_hash from profiles if it exists
-- ============================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'password_hash'
    ) THEN
        ALTER TABLE public.profiles DROP COLUMN password_hash;
        RAISE NOTICE 'Dropped password_hash column from profiles table';
    END IF;
END $$;
