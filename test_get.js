const supabase = require('./supabase/client');

async function testGet() {
    try {
        console.log("Testing conversation fetch...");
        
        // Test query 1
        const { data: d1, error: e1 } = await supabase
            .from('conversations')
            .select(`*, client:profiles!client_id(name)`)
            .limit(1);
        
        if (e1) {
            console.error("Query 1 Error:", JSON.stringify(e1));
        } else {
            console.log("Query 1 Success");
        }

        // Test query 2
        const { data: d2, error: e2 } = await supabase
            .from('conversations')
            .select(`*, profiles(*)`)
            .limit(1);

        if (e2) {
            console.error("Query 2 Error:", JSON.stringify(e2));
        } else {
            console.log("Query 2 Success");
        }

    } catch (e) {
        console.error("Exception:", e);
    }
}

testGet();
