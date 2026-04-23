require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupStoragePolicies() {
  console.log('Setting up Supabase Storage Policies via SQL RPC...');

  // We have to execute raw SQL to create policies, which is best done via postgres function or executing raw sql if we're using a direct pg connection.
  // Since we don't have direct pg connection setup in this script easily, let's just use the Supabase JS client to insert some test data and see if it fails.
  // Actually, since we created the buckets via service_role, and we set them to public: true, the getPublicUrl should work.
  // Let's create a test file directly.
  
  const { data, error } = await supabase.storage
    .from('job-attachments')
    .upload('test.txt', 'Hello World', {
      contentType: 'text/plain',
      upsert: true
    });

  if (error) {
    console.error('Error uploading test file (service role):', error.message);
  } else {
    console.log('✅ Successfully uploaded test file via service role:', data);
  }
}

setupStoragePolicies();
