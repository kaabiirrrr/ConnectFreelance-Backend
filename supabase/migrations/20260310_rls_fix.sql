-- Add INSERT policies for Admins
-- These allow admins to create announcements and log their actions

-- Announcements INSERT policy
CREATE POLICY "Admins can create announcements" ON public.announcements
    FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

-- Admin Logs INSERT policy
CREATE POLICY "Admins can insert logs" ON public.admin_logs
    FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

-- Admin Logs SELECT policy (Already exists but for completeness)
-- CREATE POLICY "Admins can view all logs" ON public.admin_logs
--    FOR SELECT USING (EXISTS (SELECT 1 FROM public.admins WHERE id = auth.uid()));

-- Announcements SELECT policy (Important for the dropdown to work)
CREATE POLICY "Everyone can view announcements" ON public.announcements
    FOR SELECT USING (TRUE);
