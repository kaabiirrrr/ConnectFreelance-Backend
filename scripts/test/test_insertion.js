require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function testValidJob() {
  console.log('Testing job insertion with an existing user ID...');

  // 1. Get a valid user ID
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  if (userError || !users || users.users.length === 0) {
    console.log('Could not fetch test user ID:', userError);
    return;
  }
  
  const testUserId = users.users[0].id;

  // 2. Attempt to insert a job with the missing columns specified in the migration
  const { data: job, error } = await supabase.from('jobs').insert({
    client_id: testUserId,
    title: 'Test Migration Integration',
    description: 'If this succeeds, then the columns already exist.',
    category: 'Testing', // Missing column from migration
    skills: ['testing'], // Missing column from migration
    budget_type: 'fixed', // Missing column from migration
    budget_amount: 50, // Missing column from migration
    experience_level: 'beginner', // Missing column from migration
    duration: '1 week', // Missing column from migration
    attachments: [] // Missing column from migration
  }).select();

  if (error) {
    console.log('Insertion Failed - Missing Columns Confirmed. Error:', error);
  } else {
    console.log('Insertion Success! The columns already exist:', job);
    
    // clean up
    await supabase.from('jobs').delete().eq('id', job[0].id);
  }
}

testValidJob();
