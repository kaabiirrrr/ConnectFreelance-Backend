const supabase = require('./supabase/client');

async function check() {
  const targetEmail = 'lets.connectbro@gmail.com';
  console.log(`\n--- ROBUST DB CHECK for ${targetEmail} ---`);
  
  try {
    // 1. Fetch ALL admins to see if there's any variation
    const { data: allAdmins, error: adminErr } = await supabase.from('admins').select('*');
    if (adminErr) {
        console.error('Error fetching admins:', adminErr.message);
    } else {
        console.log(`Found ${allAdmins.length} admins:`);
        allAdmins.forEach(a => {
            console.log(`- ID: ${a.id}, Email: [${a.email}], Role: ${a.role}, Length: ${a.email?.length}`);
            if (a.email?.toLowerCase().trim() === targetEmail.toLowerCase()) {
                console.log('  >>> MATCH FOUND on normalized email!');
            }
        });
    }

    // 2. Fetch from profiles
    const { data: profiles, error: profErr } = await supabase.from('profiles').select('*').ilike('email', targetEmail);
    console.log(`\nProfiles matching "${targetEmail}":`, profiles?.length || 0);
    profiles?.forEach(p => console.log(`- ID: ${p.id}, Email: [${p.email}], Role: ${p.role}`));

    // 3. Fetch from auth.users (if possible via RPC or if service role permits)
    // Usually we can't select from auth.users directly without RPC, but we can check the 'users' table if it exists
    const { data: users, error: userErr } = await supabase.from('users').select('*').ilike('email', targetEmail);
    console.log(`\nUsers table matching "${targetEmail}":`, users?.length || 0);
    users?.forEach(u => console.log(`- ID: ${u.id}, Email: [${u.email}], Role: ${u.role}`));

  } catch (err) {
    console.error('Check failed:', err.message);
  }
}

check();
