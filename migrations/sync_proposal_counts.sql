-- Sync proposal_count on jobs table from actual proposals
-- Run this once in Supabase SQL editor to fix existing data

UPDATE public.jobs j
SET proposal_count = (
    SELECT COUNT(*)
    FROM public.proposals p
    WHERE p.job_id = j.id
    AND p.status != 'WITHDRAWN'
);
