require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  // Check if wallets table exists
  const { data, error } = await supabase.from('wallets').select('id').limit(1);
  
  if (error && error.code === '42P01') {
    console.log('❌ wallets table does NOT exist.');
    console.log('\nPlease run this SQL in your Supabase SQL Editor:');
    console.log('https://supabase.com/dashboard/project/ogtkjtbvbkyddutnmcov/sql/new\n');
    console.log(`
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
    available_balance DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
    pending_balance DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
    total_earned DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
    total_withdrawn DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
    last_topup_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    payment_id TEXT,
    reference_id TEXT,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON public.wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_id ON public.wallet_transactions(user_id);
    `);
  } else if (error) {
    console.log('❌ Error checking wallets table:', error.message);
  } else {
    console.log('✅ wallets table already exists and is accessible');
  }

  // Check wallet_transactions
  const { error: txError } = await supabase.from('wallet_transactions').select('id').limit(1);
  if (txError && txError.code === '42P01') {
    console.log('❌ wallet_transactions table does NOT exist — run the SQL above');
  } else if (!txError) {
    console.log('✅ wallet_transactions table exists');
  }
}

run().catch(console.error);
