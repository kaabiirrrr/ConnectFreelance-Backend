const { getContext } = require('./utils/ragEngine');

const queries = [
    "How do I post a job?",
    "What are connects?",
    "Tell me about the payment policy",
    "Where is the 'Withdraw' button?",
    "How do I make a cake?" // Should return no context
];

queries.forEach(q => {
    console.log(`\n--- Query: "${q}" ---`);
    const context = getContext(q);
    console.log(`Context Found:\n${context || "NONE"}`);
});
