-- Freelancer Services (gig-style offerings)
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    price DECIMAL(10,2) NOT NULL,
    delivery_days INTEGER NOT NULL DEFAULT 3,
    revisions INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    tags TEXT[] DEFAULT '{}',
    images TEXT[] DEFAULT '{}',
    packages JSONB, -- [{name, description, price, delivery_days, revisions}]
    faqs JSONB,     -- [{question, answer}]
    orders_count INTEGER DEFAULT 0,
    rating DECIMAL(3,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Service orders
CREATE TABLE IF NOT EXISTS public.service_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    freelancer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    package_name TEXT,
    price DECIMAL(10,2) NOT NULL,
    delivery_days INTEGER NOT NULL,
    requirements TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','DELIVERED','REVISION','COMPLETED','CANCELLED')),
    delivered_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_services_freelancer_id ON public.services(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON public.services(category);
CREATE INDEX IF NOT EXISTS idx_service_orders_service_id ON public.service_orders(service_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_client_id ON public.service_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_freelancer_id ON public.service_orders(freelancer_id);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;

-- Services: public read, freelancer manages own
DROP POLICY IF EXISTS "Public read services" ON public.services;
CREATE POLICY "Public read services" ON public.services FOR SELECT USING (is_active = true OR auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Freelancer manages services" ON public.services;
CREATE POLICY "Freelancer manages services" ON public.services FOR ALL USING (auth.uid() = freelancer_id);

-- Orders: participants only
DROP POLICY IF EXISTS "Participants view orders" ON public.service_orders;
CREATE POLICY "Participants view orders" ON public.service_orders FOR SELECT USING (auth.uid() = client_id OR auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Client creates order" ON public.service_orders;
CREATE POLICY "Client creates order" ON public.service_orders FOR INSERT WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "Participants update order" ON public.service_orders;
CREATE POLICY "Participants update order" ON public.service_orders FOR UPDATE USING (auth.uid() = client_id OR auth.uid() = freelancer_id);
