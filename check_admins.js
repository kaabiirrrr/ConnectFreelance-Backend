const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkAdmins() {
  const { data, error } = await supabase.from('admins').select('*').limit(5);
  if (error) {
    console.error('Error fetching admins:', error);
  } else {
    console.log('Admins data:', data);
  }
}
checkAdmins();
