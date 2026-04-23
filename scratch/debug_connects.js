const adminClient = require('./supabase/adminClient');

async function debugConnects() {
    try {
        console.log("--- SETTINGS ---");
        const { data: settings } = await adminClient.from('connect_settings').select('*');
        console.log(JSON.stringify(settings, null, 2));

        console.log("\n--- WALLETS (Top 5) ---");
        const { data: wallets } = await adminClient.from('user_connects').select('*').limit(5);
        console.log(JSON.stringify(wallets, null, 2));

        console.log("\n--- PACKAGES (Mock) ---");
        const packages = [
            { id: 'small', connects: 50, price: 10 },
            { id: 'medium', connects: 100, price: 15, isBestValue: true },
            { id: 'large', connects: 200, price: 25 }
        ];
        console.log(JSON.stringify(packages, null, 2));
    } catch (err) {
        console.error(err);
    }
}

debugConnects();
