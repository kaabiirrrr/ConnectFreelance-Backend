-- Site/Platform Reviews (public testimonials — separate from contract reviews)
CREATE TABLE IF NOT EXISTS public.site_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_reviews_created ON public.site_reviews(created_at DESC);
