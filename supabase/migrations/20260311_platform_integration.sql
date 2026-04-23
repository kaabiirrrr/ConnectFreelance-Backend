-- ============================================================
-- Connect.com Platform Integration Migration
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/ogtkjtbvbkyddutnmcov/sql
-- ============================================================

-- 1. CONVERSATIONS TABLE
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  freelancer_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, freelancer_id)
);

-- 2. MESSAGES TABLE (enhanced)
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  message_type TEXT DEFAULT 'text', -- text | image | document | emoji
  message_text TEXT,
  file_url TEXT,
  file_name TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CALL LOGS TABLE
CREATE TABLE IF NOT EXISTS public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  receiver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  call_type TEXT DEFAULT 'audio', -- audio | video
  duration INTEGER DEFAULT 0, -- seconds
  status TEXT DEFAULT 'completed', -- completed | missed | rejected
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ADD MISSING JOB COLUMNS
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS budget_type TEXT DEFAULT 'fixed';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(12, 2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS experience_level TEXT DEFAULT 'beginner';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS duration TEXT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS proposal_count INTEGER DEFAULT 0;

-- 5. RLS POLICIES FOR CONVERSATIONS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their conversations" ON public.conversations;
CREATE POLICY "Users can view their conversations" ON public.conversations
  FOR SELECT USING (auth.uid() = client_id OR auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = client_id OR auth.uid() = freelancer_id);

DROP POLICY IF EXISTS "Users can update their conversations" ON public.conversations;
CREATE POLICY "Users can update their conversations" ON public.conversations
  FOR UPDATE USING (auth.uid() = client_id OR auth.uid() = freelancer_id);

-- 6. RLS POLICIES FOR MESSAGES
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in their conversations" ON public.messages;
CREATE POLICY "Users can view messages in their conversations" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON public.messages;
CREATE POLICY "Users can insert messages in their conversations" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their messages" ON public.messages;
CREATE POLICY "Users can update their messages" ON public.messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND (c.client_id = auth.uid() OR c.freelancer_id = auth.uid())
    )
  );

-- 7. RLS FOR CALL LOGS
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their call logs" ON public.call_logs;
CREATE POLICY "Users can view their call logs" ON public.call_logs
  FOR SELECT USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Users can create call logs" ON public.call_logs;
CREATE POLICY "Users can create call logs" ON public.call_logs
  FOR INSERT WITH CHECK (auth.uid() = caller_id);

DROP POLICY IF EXISTS "Users can update call logs" ON public.call_logs;
CREATE POLICY "Users can update call logs" ON public.call_logs
  FOR UPDATE USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- 8. STORAGE BUCKET FOR CHAT ATTACHMENTS
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('job-attachments', 'job-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- 9. ENABLE REALTIME FOR MESSAGES
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
