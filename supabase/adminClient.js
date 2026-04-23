require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('[AdminClient] Supabase URL or Service Role Key not found. Administrative functions may fail.');
}

/**
 * STATELESS ADMIN CLIENT
 * This client uses the service_role key to bypass RLS.
 * It is configured with persistSession: false to prevent session pollution
 * which was causing 403 Forbidden errors in concurrent requests.
 */
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1s

/**
 * CUSTOM FETCH WITH RETRIES AND TIMEOUT
 * Implements automated retry mechanism for ECONNRESET and timeout errors
 */
const customFetch = async (url, options = {}, attempt = 1) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 seconds total

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
            msg.includes('ECONNRESET') ||
            msg.includes('connect ECONNREFUSED');

        if (isRetryable && attempt <= MAX_RETRIES) {
            console.warn(`[AdminClient Fetch] Attempt ${attempt} failed. Retrying in ${INITIAL_RETRY_DELAY * attempt}ms... (${msg})`);
            
            if (msg.includes('ENOTFOUND')) {
                console.error(`[Supabase DNS] Hostname resolution failed for AdminClient. Please check your internet/VPN connection: ${url}`);
            }

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

const adminClient = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseKey || 'placeholder', 
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
        },
        global: {
            fetch: customFetch
        }
    }
);

module.exports = adminClient;
