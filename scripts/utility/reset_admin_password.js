const supabase = require('./supabase/client');

async function reset() {
  const email = 'lets.connectbro@gmail.com';
  const newPassword = 'Connect@123';
  
  console.log(`Resetting credentials for: ${email}`);

  try {
    // 1. Get the user ID first
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    
    const user = users.find(u => u.email === email);
    if (!user) {
      console.error('User not found in auth.users!');
      return;
    }
    
    const userId = user.id;
    console.log(`User ID: ${userId}`);

    // 2. Update password and metadata
    const { data, error } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
      user_metadata: { role: 'SUPER_ADMIN' }
    });
    
    if (error) throw error;
    console.log('Password reset successful.');

    // 3. Force update the admins table just in case
    await supabase.from('admins').upsert({
      id: userId,
      email: email,
      role: 'SUPER_ADMIN'
    });
    console.log('Admins table entry ensured.');

    // 4. Delete ANY traces in profiles/users
    await supabase.from('profiles').delete().eq('user_id', userId);
    await supabase.from('users').delete().eq('id', userId);
    console.log('Conflicting records deleted.');

    console.log('\n--- NEW CREDENTIALS ---');
    console.log(`Email: ${email}`);
    console.log(`Password: ${newPassword}`);
    console.log('------------------------');

  } catch (err) {
    console.error('Reset failed:', err.message);
  }
}

reset();
