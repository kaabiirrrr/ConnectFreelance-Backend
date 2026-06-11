-- Fix: Remove the check constraint on profiles.category
-- The constraint was blocking valid category values like "Design & Creative".
-- Category is a free-text field and should not be constrained to an enum.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_category_check;
