require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('Supabase URL or Anon Key not found in environment variables. Supabase client will not work properly until they are set.');
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1s

/**
 * CUSTOM FETCH WITH RETRIES AND TIMEOUT
 * We implement an automated retry mechanism (up to 3 attempts) and increase 
 * the overall timeout to 45s to handle strict 10s connection limits or 
 * unstable network conditions.
 */
const customFetch = async (url, options = {}, attempt = 1) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds total (Harden for Render boot)

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } catch (error) {
        const msg = error.message || '';
        const isRetryable = 
            error.name === 'AbortError' || 
            error.name === 'ConnectTimeoutError' ||
            msg.includes('fetch failed') ||
            msg.includes('UND_ERR_CONNECT_TIMEOUT') ||
            msg.includes('ENOTFOUND') ||
            msg.includes('EAI_AGAIN') ||
            msg.includes('connect ECONNREFUSED');

        if (isRetryable && attempt <= MAX_RETRIES) {
            console.warn(`[Supabase Fetch] Attempt ${attempt} failed. Retrying in ${INITIAL_RETRY_DELAY * attempt}ms... (${msg})`);
            
            if (msg.includes('ENOTFOUND')) {
                console.error(`[Supabase DNS] Hostname resolution failed. Please check your internet/VPN connection: ${url}`);
            }

            // Wait before retrying (exponential-ish backoff)
            await new Promise(resolve => setTimeout(resolve, INITIAL_RETRY_DELAY * attempt));
            
            clearTimeout(timeoutId);
            return customFetch(url, options, attempt + 1);
        }

        if (error.name === 'AbortError') {
            const timeoutError = new Error(`Connection timed out after 45s: ${url}`);
            timeoutError.name = 'ConnectTimeoutError';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder', {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
    },
    global: {
        fetch: customFetch
    }
});

module.exports = supabase;
