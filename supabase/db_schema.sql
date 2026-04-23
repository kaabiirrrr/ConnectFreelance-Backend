-- Connect.com Database Schema (Supabase PostgreSQL)

-- ENUMS
CREATE TYPE user_role AS ENUM ('CLIENT', 'FREELANCER');
CREATE TYPE job_status AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE proposal_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE contract_status AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED');
CREATE TYPE subscription_tier AS ENUM ('BASIC', 'PLUS', 'BUSINESS');
CREATE TYPE admin_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'FINANCE_ADMIN', 'SUPPORT_ADMIN');
CREATE TYPE dispute_status AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'CLOSED');
CREATE TYPE report_status AS ENUM ('PENDING', 'INVESTIGATING', 'ACTION_TAKEN', 'DISMISSED');
CREATE TYPE call_status AS ENUM ('completed', 'missed', 'rejected', 'failed');

-- 1. USERS TABLE
-- (Extended from Supabase auth.users)
CREATE TABLE public.users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    role user_role NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. PROFILES TABLE
CREATE TABLE public.profiles (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_url TEXT,
    -- Freelancer specifics
    title TEXT,
    skills TEXT[],
    hourly_rate DECIMAL(10,2),
    bio TEXT,
    portfolio JSONB[], -- Array of objects {title, url, image}
    experience JSONB[], -- Array of objects {company, role, start_date, end_date}
    education JSONB[], -- Array of objects {institution, degree, graduation_year}
    is_verified BOOLEAN DEFAULT FALSE,
    -- Client specifics
    company_name TEXT,
    company_description TEXT,
    -- Common
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. TEAMS TABLE (Clients can invite team members)
CREATE TABLE public.teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TEAM MEMBERS (Join table)
CREATE TABLE public.team_members (
    team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'MEMBER', -- ADMIN, MEMBER
    PRIMARY KEY(team_id, user_id)
);

-- 4. JOBS TABLE
CREATE TABLE public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    skills_required TEXT[],
    budget DECIMAL(10,2),
    project_type TEXT, -- Hourly, Fixed
    status job_status DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. PROPOSALS TABLE
CREATE TABLE public.proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    cover_letter TEXT NOT NULL,
    proposed_rate DECIMAL(10,2) NOT NULL,
    estimated_duration TEXT,
    status proposal_status DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. CONTRACTS TABLE
CREATE TABLE public.contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES public.proposals(id),
    job_id UUID REFERENCES public.jobs(id),
    client_id UUID REFERENCES public.users(id),
    freelancer_id UUID REFERENCES public.users(id),
    agreed_rate DECIMAL(10,2) NOT NULL,
    status contract_status DEFAULT 'ACTIVE',
    start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. MESSAGES TABLE (updated with conversation_id)
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    message_type TEXT DEFAULT 'text',
    message_text TEXT,
    file_url TEXT,
    file_name TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. CONVERSATIONS TABLE (metadata for messaging)
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_1 UUID REFERENCES public.users(id) ON DELETE CASCADE,
    participant_2 UUID REFERENCES public.users(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    last_message TEXT,
    last_message_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(participant_1, participant_2)
);

-- 9. CALL_LOGS TABLE (audio/video call history)
CREATE TABLE public.call_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
    duration INTEGER DEFAULT 0,
    status call_status DEFAULT 'completed',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. PAYMENTS TABLE
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    payer_id UUID REFERENCES public.users(id),
    payee_id UUID REFERENCES public.users(id),
    stripe_payment_intent_id TEXT UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL, -- e.g., 'requires_payment_method', 'escrow', 'released', 'refunded'
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. SUBSCRIPTIONS TABLE
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    tier subscription_tier DEFAULT 'BASIC',
    status TEXT NOT NULL, -- 'active', 'canceled', 'past_due'
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. NOTIFICATIONS TABLE
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL, -- 'JOB_ALERT', 'MESSAGE', 'CONTRACT_UPDATE', 'SYSTEM'
    is_read BOOLEAN DEFAULT FALSE,
    link TEXT, -- Optional URL to redirect to
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. VIOLATIONS TABLE (Account Health)
CREATE TABLE public.violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    severity TEXT NOT NULL, -- 'WARNING', 'SUSPENSION', 'BAN'
    status TEXT DEFAULT 'ACTIVE', -- 'ACTIVE', 'RESOLVED'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. ADMINS TABLE (extended with more fields)
CREATE TABLE public.admins (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    role admin_role DEFAULT 'MODERATOR',
    name TEXT,
    phone TEXT,
    photo_url TEXT,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. DISPUTES TABLE
CREATE TABLE public.disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
    raised_by UUID REFERENCES public.users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status dispute_status DEFAULT 'OPEN',
    resolution TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 16. REPORTS TABLE (Content Moderation)
CREATE TABLE public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reported_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL, -- 'PROFILE', 'JOB', 'PROPOSAL', 'MESSAGE'
    item_id UUID, -- Optional UUID of the specific item
    reason TEXT NOT NULL,
    status report_status DEFAULT 'PENDING',
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 17. PLATFORM SETTINGS TABLE
CREATE TABLE public.platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key TEXT UNIQUE NOT NULL,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 18. CONNECTS TABLE (virtual currency for freelancers)
CREATE TABLE public.connects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    balance INTEGER DEFAULT 0,
    purchased_connects INTEGER DEFAULT 0,
    free_connects INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 19. CONNECTS_HISTORY TABLE
CREATE TABLE public.connects_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    change_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TRIGGERS for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_proposals_updated_at BEFORE UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON public.disputes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reports_updated_at BEFORE UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_platform_settings_updated_at BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_admins_updated_at BEFORE UPDATE ON public.admins FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_connects_updated_at BEFORE UPDATE ON public.connects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 20. IDENTITY VERIFICATIONS TABLE
CREATE TABLE public.identity_verifications (
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
    user_role TEXT, -- CLIENT, FREELANCER
    status TEXT DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
    document_type TEXT, -- aadhaar, pan, dl
    document_front_url TEXT,
    document_back_url TEXT,
    extracted_name TEXT,
    extracted_dob TEXT,
    extracted_gender TEXT,
    document_number TEXT,
    rejection_reason TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Relationship for admin dashboard joins
    CONSTRAINT fk_idv_profiles FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE
);

-- Indexes for verification
CREATE INDEX IF NOT EXISTS idx_identity_verifications_status ON public.identity_verifications(status);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_role ON public.identity_verifications(user_role);

-- TRIGGER for identity_verifications
CREATE TRIGGER update_identity_verifications_updated_at BEFORE UPDATE ON public.identity_verifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
