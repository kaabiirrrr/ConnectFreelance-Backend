-- Unified RLS Policy Setup
-- This script enables RLS on all tables and applies strict ownership-based policies.
-- It correctly handles tables where the primary key or owner column is 'user_id' instead of 'id'.

-- 1. Enable RLS on all tables in public schema
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY;';
    END LOOP;
END $$;

-- 2. Drop existing policies to avoid conflicts
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename);
    END LOOP;
END $$;

-- 3. Profiles (PK: user_id)
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- 4. Wallets (PK: user_id)
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);

-- 5. Contracts (PK: id)
CREATE POLICY "Users can view their own contracts" ON public.contracts 
FOR SELECT USING (auth.uid() = client_id OR auth.uid() = freelancer_id);

-- 6. Proposals (PK: id)
CREATE POLICY "Freelancers can view their own proposals" ON public.proposals 
FOR SELECT USING (auth.uid() = freelancer_id);

CREATE POLICY "Clients can view proposals for their jobs" ON public.proposals 
FOR SELECT USING (auth.uid() IN (SELECT client_id FROM public.jobs WHERE id = job_id));

-- 7. Escrow Ledger (PK: id)
CREATE POLICY "Users can view their escrow transactions" ON public.escrow_ledger 
FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- 8. Jobs (PK: id)
CREATE POLICY "Anyone can view open jobs" ON public.jobs FOR SELECT USING (status = 'OPEN' OR auth.uid() = client_id);
CREATE POLICY "Clients can manage their own jobs" ON public.jobs FOR ALL USING (auth.uid() = client_id);

-- 9. Work Submissions
CREATE POLICY "Contract parties can view submissions" ON public.work_submissions 
FOR SELECT USING (auth.uid() IN (SELECT client_id FROM public.contracts WHERE id = contract_id) OR auth.uid() IN (SELECT freelancer_id FROM public.contracts WHERE id = contract_id));

-- 10. Users (PK: id)
CREATE POLICY "Users can view their own record" ON public.users FOR SELECT USING (auth.uid() = id);

-- 11. Notifications (Owner: user_id)
CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own notifications" ON public.notifications FOR ALL USING (auth.uid() = user_id);

-- 12. DROP DEPRECATED TABLE
DROP TABLE IF EXISTS public.fake_escrow_transactions;
