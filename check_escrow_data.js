const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('--- Checking Escrow Data ---');
  
  // 1. Check transactions
  const { data: txs, error: txErr } = await supabase
    .from('fake_escrow_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
    
  if (txErr) console.error('TX Error:', txErr);
  else console.log('Recent Transactions:', txs);

  // 2. Check wallets
  const { data: wallets, error: wErr } = await supabase
    .from('wallets')
    .select('*')
    .limit(5);
    
  if (wErr) console.error('Wallet Error:', wErr);
  else console.log('Recent Wallets:', wallets);
}

check();
