-- MISSION CRITICAL: ATOMIC JOB CREATION RPC
-- Run this in your Supabase SQL Editor to enable professional-grade job posting.

CREATE OR REPLACE FUNCTION public.create_job_with_roles(
    job_data JSONB,
    roles_data JSONB[]
) RETURNS JSONB AS $$
DECLARE
    new_job_id UUID;
    final_job JSONB;
    role_record JSONB;
BEGIN
    -- 1. Insert Job
    INSERT INTO public.jobs (
        client_id, title, description, category, skills, budget_type,
        budget_amount, experience_level, duration, status, attachments,
        bid_deadline, is_bidding_open, job_mode
    ) VALUES (
        (job_data->>'client_id')::UUID,
        job_data->>'title',
        job_data->>'description',
        job_data->>'category',
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(job_data->'skills')), ARRAY[]::TEXT[]),
        job_data->>'budget_type',
        (job_data->>'budget_amount')::NUMERIC,
        job_data->>'experience_level',
        job_data->>'duration',
        (job_data->>'status')::TEXT,
        COALESCE((job_data->'attachments')::JSONB, '[]'::JSONB),
        (job_data->>'bid_deadline')::TIMESTAMPTZ,
        COALESCE((job_data->>'is_bidding_open')::BOOLEAN, true),
        job_data->>'job_mode'
    ) RETURNING id INTO new_job_id;

    -- 2. Insert Roles (if any)
    IF array_length(roles_data, 1) > 0 THEN
        FOREACH role_record IN ARRAY roles_data
        LOOP
            INSERT INTO public.job_roles (
                job_id, title, description, budget, positions, priority, status, bid_deadline
            ) VALUES (
                new_job_id,
                role_record->>'title',
                role_record->>'description',
                (role_record->>'budget')::NUMERIC,
                COALESCE((role_record->>'positions')::INTEGER, 1),
                COALESCE((role_record->>'priority')::INTEGER, 0),
                'open',
                (role_record->>'bid_deadline')::TIMESTAMPTZ
            );
        END LOOP;
    END IF;

    -- 3. Return enriched result
    SELECT jsonb_build_object(
        'job', row_to_json(j),
        'roles', (SELECT json_agg(row_to_json(r)) FROM public.job_roles r WHERE r.job_id = j.id)
    ) INTO final_job
    FROM public.jobs j
    WHERE j.id = new_job_id;

    RETURN final_job;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
