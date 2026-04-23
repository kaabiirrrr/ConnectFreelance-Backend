require('dotenv').config();
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function parseJSON(raw) {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
}

async function test() {
    const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            {
                role: 'system',
                content: 'You are a freelance career coach. Respond ONLY with raw JSON, no markdown, no explanation. Format: {"optimizedBio":"...","optimizedTitle":"...","improvements":["i1","i2"]}'
            },
            { role: 'user', content: 'Bio: IT student focused on tech and trading.' }
        ],
        max_tokens: 300
    });

    const raw = result.choices[0].message.content;
    console.log('RAW OUTPUT:\n', raw);
    console.log('\n---\nPARSED:');
    console.log(JSON.stringify(parseJSON(raw), null, 2));
}

test().catch(e => console.error('FAILED:', e.message));
