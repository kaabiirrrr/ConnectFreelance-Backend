const supabase = require('./supabase/client');

async function testInsert() {
    try {
        console.log("Testing conversation insert...");
        const { data, error } = await supabase
            .from('conversations')
            .insert([{ 
                client_id: 'a12ba159-fdf2-4ce0-a61d-84fdad71eadd', // dummy valid looking uuid
                freelancer_id: 'b12ba159-fdf2-4ce0-a61d-84fdad71eadd'
            }])
            .select()
            .single();
        
        if (error) {
            console.error("Supabase Error:", JSON.stringify(error, null, 2));
        } else {
            console.log("Success:", data);
        }
    } catch (e) {
        console.error("Exception:", e);
    }
}

testInsert();
