const adminClient = require('../../supabase/adminClient');

async function setupStorage() {
    console.log('--- Initializing Storage Setup ---');
    
    try {
        const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
        if (listError) throw listError;

        const exists = buckets.find(b => b.id === 'deliveries');
        
        if (!exists) {
            console.log('Creating "deliveries" bucket...');
            const { error: createError } = await adminClient.storage.createBucket('deliveries', {
                public: false
            });
            if (createError) throw createError;
            console.log('✅ Bucket "deliveries" created successfully.');
        } else {
            console.log('ℹ️ Bucket "deliveries" already exists.');
        }

    } catch (err) {
        console.error('❌ Storage Setup Failed:', err.message);
        process.exit(1);
    }
}

setupStorage();
