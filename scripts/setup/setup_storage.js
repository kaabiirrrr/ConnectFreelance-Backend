require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setupStorage() {
  console.log('Setting up Supabase Storage...');

  try {
    // 1. Create buckets if they don't exist
    const { data: buckets, error: getBucketsError } = await supabase.storage.listBuckets();
    if (getBucketsError) throw getBucketsError;

    const bucketNames = buckets.map(b => b.name);

    if (!bucketNames.includes('job-attachments')) {
      const { error } = await supabase.storage.createBucket('job-attachments', { public: true });
      if (error) throw error;
      console.log('✅ Created job-attachments bucket');
    } else {
      console.log('✅ job-attachments bucket already exists');
    }

    if (!bucketNames.includes('chat-attachments')) {
      const { error } = await supabase.storage.createBucket('chat-attachments', { public: true });
      if (error) throw error;
      console.log('✅ Created chat-attachments bucket');
    } else {
      console.log('✅ chat-attachments bucket already exists');
    }

    console.log('Storage setup complete!');
  } catch (err) {
    console.error('Error setting up storage:', err);
  }
}

setupStorage();
