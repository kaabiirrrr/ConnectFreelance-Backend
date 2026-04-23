-- Migration: Add performance indexes to frequently queried columns
-- These indexes improve query performance for common operations

-- ============================================
-- JOBS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_skills ON jobs USING GIN(skills_required);
CREATE INDEX IF NOT EXISTS idx_jobs_budget ON jobs(budget);

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at DESC);

-- ============================================
-- PROPOSALS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_proposals_job ON proposals(job_id);
CREATE INDEX IF NOT EXISTS idx_proposals_freelancer ON proposals(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON proposals(created_at DESC);

-- Composite index for job proposals by status
CREATE INDEX IF NOT EXISTS idx_proposals_job_status ON proposals(job_id, status);

-- ============================================
-- CONTRACTS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_contracts_client ON contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer ON contracts(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_job ON contracts(job_id);
CREATE INDEX IF NOT EXISTS idx_contracts_proposal ON contracts(proposal_id);
CREATE INDEX IF NOT EXISTS idx_contracts_created ON contracts(created_at DESC);

-- Composite index for active contracts by user
CREATE INDEX IF NOT EXISTS idx_contracts_user_status ON contracts(client_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer_status ON contracts(freelancer_id, status);

-- ============================================
-- PAYMENTS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_payee ON payments(payee_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_stripe ON payments(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at DESC);

-- ============================================
-- MESSAGES TABLE INDEXES (already in previous migration but repeating for clarity)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

-- Composite for conversation messages
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);

-- ============================================
-- CONVERSATIONS TABLE INDEXES (already added but repeating)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_conversations_participant1 ON conversations(participant_1);
CREATE INDEX IF NOT EXISTS idx_conversations_participant2 ON conversations(participant_2);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- ============================================
-- NOTIFICATIONS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- Index for unread notifications (common query)
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

-- ============================================
-- DISPUTES TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_disputes_contract ON disputes(contract_id);
CREATE INDEX IF NOT EXISTS idx_disputes_raised_by ON disputes(raised_by);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_created ON disputes(created_at DESC);

-- ============================================
-- REPORTS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_item ON reports(item_type, item_id);

-- ============================================
-- VIOLATIONS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_violations_user ON violations(user_id);
CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status);
CREATE INDEX IF NOT EXISTS idx_violations_severity ON violations(severity);

-- ============================================
-- SUBSCRIPTIONS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON subscriptions(tier);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

-- ============================================
-- USERS/PROFILES TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_verification ON profiles(is_verified);
CREATE INDEX IF NOT EXISTS idx_profiles_completion ON profiles(profile_completion_percentage);

-- Text search index for profile names (if using PostgreSQL full-text search)
-- CREATE INDEX IF NOT EXISTS idx_profiles_name_search ON profiles USING GIN(to_tsvector('english', name));

-- ============================================
-- ADMINS TABLE INDEXES (already added but repeating)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_admins_role ON admins(role);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);
CREATE INDEX IF NOT EXISTS idx_admins_2fa ON admins(two_factor_enabled);

-- ============================================
-- TEAMS TABLE INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_teams_client ON teams(client_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- ============================================
-- CONNECTS TABLE INDEXES (already added but repeating)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_connects_freelancer ON connects(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_connects_history_freelancer ON connects_history(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_connects_history_created ON connects_history(created_at DESC);

-- ============================================
-- CALL_LOGS TABLE INDEXES (already added but repeating)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_call_logs_caller ON call_logs(caller_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_receiver ON call_logs(receiver_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_type ON call_logs(call_type);

-- ============================================
-- PERFORMANCE NOTES
-- ============================================
-- Run ANALYZE after creating indexes to update statistics:
ANALYZE public.jobs;
ANALYZE public.proposals;
ANALYZE public.contracts;
ANALYZE public.payments;
ANALYZE public.messages;
ANALYZE public.notifications;
ANALYZE public.disputes;
ANALYZE public.reports;
ANALYZE public.profiles;
ANALYZE public.admins;
