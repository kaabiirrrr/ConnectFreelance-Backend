-- Migration to add direct foreign keys between contracts and profiles
-- This enables PostgREST joins like profiles!contracts_freelancer_id_profiles_fkey

ALTER TABLE public.contracts
    ADD CONSTRAINT contracts_client_id_profiles_fkey 
    FOREIGN KEY (client_id) REFERENCES public.profiles(user_id),
    
    ADD CONSTRAINT contracts_freelancer_id_profiles_fkey 
    FOREIGN KEY (freelancer_id) REFERENCES public.profiles(user_id);
