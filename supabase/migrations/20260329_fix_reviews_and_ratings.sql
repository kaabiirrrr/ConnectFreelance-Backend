-- Migration: Fix Reviews and Ratings
-- Description: Creates the missing reviews table and adds rating tracking to profiles

-- 1. Create REVIEWS table (if not exists)
CREATE TABLE IF NOT EXISTS public.reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
    reviewer_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    reviewee_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(contract_id, reviewer_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON public.reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_contract ON public.reviews(contract_id);

-- 2. Add RATING column to PROFILES (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'rating'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN rating NUMERIC(3,2) DEFAULT 0;
    END IF;
END $$;

-- 3. Create AVG_RATING RPC function
CREATE OR REPLACE FUNCTION public.avg_rating(user_id_input UUID)
RETURNS TABLE (avg_rating NUMERIC, total_reviews BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(AVG(rating), 0)::NUMERIC as avg_rating,
        COUNT(*)::BIGINT as total_reviews
    FROM public.reviews
    WHERE reviewee_id = user_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create trigger to update profiles.rating automatically
CREATE OR REPLACE FUNCTION public.update_profile_rating()
RETURNS TRIGGER AS $$
DECLARE
    new_avg NUMERIC(3,2);
BEGIN
    -- Calculate new average for the reviewee
    SELECT COALESCE(AVG(rating), 0)::NUMERIC(3,2)
    INTO new_avg
    FROM public.reviews
    WHERE reviewee_id = COALESCE(NEW.reviewee_id, OLD.reviewee_id);

    -- Update the profiles table
    UPDATE public.profiles
    SET rating = new_avg
    WHERE id = COALESCE(NEW.reviewee_id, OLD.reviewee_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safe trigger creation
DROP TRIGGER IF EXISTS trigger_update_profile_rating ON public.reviews;
CREATE TRIGGER trigger_update_profile_rating
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.update_profile_rating();

COMMENT ON TABLE public.reviews IS 'Stores reviews for completed contracts between clients and freelancers';
COMMENT ON COLUMN public.profiles.rating IS 'Cached average rating from the reviews table';
