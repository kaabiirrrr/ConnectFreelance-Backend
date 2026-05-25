-- Migration: Service Reviews
-- Adds a service_reviews table tied to service_orders,
-- and a trigger to keep services.rating + services.reviews_count in sync.

-- 1. Add reviews_count column to services (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'reviews_count'
    ) THEN
        ALTER TABLE public.services ADD COLUMN reviews_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- 2. Create service_reviews table
CREATE TABLE IF NOT EXISTS public.service_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id) -- one review per order
);

CREATE INDEX IF NOT EXISTS idx_service_reviews_service_id ON public.service_reviews(service_id);
CREATE INDEX IF NOT EXISTS idx_service_reviews_client_id ON public.service_reviews(client_id);

-- RLS
ALTER TABLE public.service_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read service reviews" ON public.service_reviews;
CREATE POLICY "Public read service reviews" ON public.service_reviews FOR SELECT USING (true);

DROP POLICY IF EXISTS "Client creates service review" ON public.service_reviews;
CREATE POLICY "Client creates service review" ON public.service_reviews FOR INSERT WITH CHECK (auth.uid() = client_id);

-- 3. Trigger function to recalculate services.rating and services.reviews_count
CREATE OR REPLACE FUNCTION public.update_service_rating()
RETURNS TRIGGER AS $$
DECLARE
    sid UUID;
    new_avg DECIMAL(3,2);
    new_count INTEGER;
BEGIN
    sid := COALESCE(NEW.service_id, OLD.service_id);

    SELECT
        COALESCE(AVG(rating), 0)::DECIMAL(3,2),
        COUNT(*)::INTEGER
    INTO new_avg, new_count
    FROM public.service_reviews
    WHERE service_id = sid;

    UPDATE public.services
    SET rating = new_avg, reviews_count = new_count
    WHERE id = sid;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_service_rating ON public.service_reviews;
CREATE TRIGGER trigger_update_service_rating
AFTER INSERT OR UPDATE OR DELETE ON public.service_reviews
FOR EACH ROW EXECUTE FUNCTION public.update_service_rating();
