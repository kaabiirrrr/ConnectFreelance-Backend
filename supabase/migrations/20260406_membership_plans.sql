-- Migration: Membership Plans Table

CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  original_price NUMERIC NOT NULL,
  offer_price NUMERIC NOT NULL,
  discount_percentage NUMERIC DEFAULT 0,
  duration VARCHAR(50) NOT NULL, -- 'monthly', 'yearly'
  features JSONB DEFAULT '[]'::jsonb,
  is_popular BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- RLS Policies
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plans are viewable by everyone" ON public.plans
  FOR SELECT USING (true);

-- No insert/update/delete policies needed here since the super admin uses admin_role key which bypasses RLS,
-- but we can add one just in case we ever access it directly via UI client as an admin (we won't, we'll use our express API).

-- Seed the initial plans (Monthly)
INSERT INTO public.plans (name, original_price, offer_price, discount_percentage, duration, features, is_popular)
VALUES 
(
  'Starter Membership', 
  0, 
  0, 
  0, 
  'monthly', 
  '["10 Connects per month", "Standard Profile Visibility", "10% Service Fee", "Community Support"]'::jsonb,
  false
),
(
  'Professional Membership', 
  2500, -- e.g. 2500 original
  1499, -- e.g. 1499 offer
  40, 
  'monthly', 
  '["80 Connects per month", "Verified Pro Badge", "5% Service Fee", "2x Search Visibility", "AI Proposal Generator", "Priority Support"]'::jsonb,
  true
),
(
  'Elite Membership', 
  7000, 
  4999, 
  28, 
  'monthly', 
  '["Unlimited Connects", "Elite Partner Status", "2% Service Fee", "Priority Job Placement", "Dedicated Account Manager"]'::jsonb,
  false
);

-- Seed the initial plans (Yearly)
INSERT INTO public.plans (name, original_price, offer_price, discount_percentage, duration, features, is_popular)
VALUES 
(
  'Starter Membership', 
  0, 
  0, 
  0, 
  'yearly', 
  '["10 Connects per month", "Standard Profile Visibility", "10% Service Fee", "Community Support"]'::jsonb,
  false
),
(
  'Professional Membership', 
  30000, 
  14990, 
  50, 
  'yearly', 
  '["80 Connects per month", "Verified Pro Badge", "5% Service Fee", "2x Search Visibility", "AI Proposal Generator", "Priority Support"]'::jsonb,
  true
),
(
  'Elite Membership', 
  84000, 
  49990, 
  40, 
  'yearly', 
  '["Unlimited Connects", "Elite Partner Status", "2% Service Fee", "Priority Job Placement", "Dedicated Account Manager"]'::jsonb,
  false
);
