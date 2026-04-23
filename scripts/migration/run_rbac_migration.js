const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !serviceKey) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
    const migrationPath = path.join(__dirname, 'supabase/migrations/20260312_multi_admin_rbac.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log(`Running migration on project: ${projectRef}...`);

    const body = JSON.stringify({ query: sql });
    const options = {
        hostname: `${projectRef}.supabase.co`,
        path: `/pg/query`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
            'apikey': serviceKey,
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log(`Status: ${res.statusCode}`);
            if (res.statusCode < 300) {
                console.log('Migration completed successfully!');
            } else {
                console.error('Migration failed:', data);
            }
        });
    });

    req.on('error', (e) => {
        console.error('Error running migration:', e);
    });

    req.write(body);
    req.end();
}

runMigration();
