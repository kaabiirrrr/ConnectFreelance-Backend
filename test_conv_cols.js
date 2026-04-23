const supabase = require('./supabase/client');

async function testCols() {
    const { data: conv } = await supabase.from('conversations').select('*').limit(1).single();
    if (conv) {
        console.log("Conversation Columns:", Object.keys(conv));
    } else {
        console.log("No conversation found to check columns");
    }
}

testCols();
