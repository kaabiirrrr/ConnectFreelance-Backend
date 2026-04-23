const adminClient = require('./supabase/adminClient');

async function checkTables() {
    try {
        console.log("Checking tables...");
        // This is a hacky way to check for table existence by attempting a select on a non-existent column or similar
        // but easier to just check if they respond 404/PGRST204/205
        
        const tables = [
            'connect_settings',
            'connects_settings',
            'user_connects',
            'connect_transactions',
            'connects_transactions'
        ];

        for (const table of tables) {
            const { error } = await adminClient.from(table).select('*').limit(1);
            if (error) {
                console.log(`Table '${table}': ERROR - ${error.message} (${error.code})`);
            } else {
                console.log(`Table '${table}': EXISTS`);
            }
        }
    } catch (err) {
        console.error(err);
    }
}

checkTables();
