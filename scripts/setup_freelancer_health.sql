-- script to set up tables for the Freelancer Account Health feature

CREATE TABLE IF NOT EXISTS freelancer_enforcement_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    freelancer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    violation_type TEXT NOT NULL,
    description TEXT,
    severity TEXT CHECK (severity IN ('low', 'medium', 'high')),
    status TEXT CHECK (status IN ('active', 'resolved', 'appealed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DROP TABLE IF EXISTS freelancer_policies CASCADE;
DROP TABLE IF EXISTS freelancer_best_practices CASCADE;
DROP TABLE IF EXISTS freelancer_success_steps CASCADE;

CREATE TABLE IF NOT EXISTS freelancer_policy_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS freelancer_best_practice_guides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS freelancer_success_roadmap (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS freelancer_violation_appeals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    violation_id UUID REFERENCES freelancer_enforcement_history(id) ON DELETE CASCADE,
    freelancer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    appeal_text TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Policy Documents
INSERT INTO freelancer_policy_documents (slug, title, content) VALUES
('legal-information', 'Legal Information', 'Freelancers must provide accurate profile details and maintain ownership rights for submitted work. Any misrepresentation may reduce account visibility or cause restrictions.'),
('privacy-policy', 'Privacy Policy', 'Your freelancer profile data and proposals remain secure. Only relevant information is shared with clients during hiring and contract execution.'),
('terms-conditions', 'Terms & Conditions', 'Freelancers must deliver agreed work within scope and timeline. Off-platform payments before contract approval are prohibited.'),
('cookie-policy', 'Cookie Policy', 'Cookies improve job recommendations, search matching accuracy, and secure login sessions.'),
('proposal-policy', 'Proposal Policy', 'Send proposals only to relevant jobs. Repeated spam proposals reduce ranking in Best Matches search.'),
('withdrawal-policy', 'Withdrawal Policy', 'Funds become withdrawable after milestone approval. Suspicious withdrawal behavior may trigger review.'),
('communication-policy', 'Communication Policy', 'Maintain professional communication. Sharing external payment contacts before hiring violates platform policy.')
ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, title = EXCLUDED.title;

-- Seed Best Practices
TRUNCATE TABLE freelancer_best_practice_guides RESTART IDENTITY CASCADE;
INSERT INTO freelancer_best_practice_guides (title, description, priority) VALUES
('Complete Your Profile', 'Profiles with photo, skills, hourly rate, and overview receive higher search ranking.', 1),
('Add Portfolio Samples', 'Freelancers with portfolios receive up to 3x more job invitations.', 2),
('Send Targeted Proposals', 'Customize proposals for each job instead of using generic templates.', 3),
('Respond Quickly', 'Responding within 12 hours increases interview chances significantly.', 4),
('Maintain High Completion Rate', 'Successful contract completion improves Best Matches ranking.', 5),
('Verify Identity Early', 'Verification increases trust score and hiring probability.', 6);

-- Seed Success Steps
TRUNCATE TABLE freelancer_success_roadmap RESTART IDENTITY CASCADE;
INSERT INTO freelancer_success_roadmap (step_number, title, description) VALUES
(1, 'Complete Profile', 'Add profile photo, skills, hourly rate, and professional summary.'),
(2, 'Add Portfolio', 'Upload work samples that demonstrate your strongest abilities.'),
(3, 'Verify Identity', 'Identity verification improves trust and visibility.'),
(4, 'Submit First Proposal', 'Apply to jobs matching your skills with personalized proposals.'),
(5, 'Get Shortlisted', 'Respond quickly when clients interact with your proposal.'),
(6, 'Start First Contract', 'Agree on milestones and timeline before starting work.'),
(7, 'Receive First Review', 'Positive reviews increase ranking and future hiring chances.');

-- Create columns in profiles if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='profile_completion') THEN
        ALTER TABLE profiles ADD COLUMN profile_completion INTEGER DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='account_health_score') THEN
        ALTER TABLE profiles ADD COLUMN account_health_score INTEGER DEFAULT 100;
    END IF;
END $$;
