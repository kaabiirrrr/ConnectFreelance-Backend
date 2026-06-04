require('dotenv').config();
const axios = require('axios');
const adminClient = require('../supabase/adminClient');
const supabase = require('../supabase/client');
const bcrypt = require('bcryptjs');

async function testOtpFlow() {
    const email = 'kabirmore8904@gmail.com';
    const userId = '8272917d-d670-4977-8251-06cb2b1c4098';
    const password = 'Connect41!';

    console.log('=== LOGGING IN ===');
    let token = '';
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        token = data.session.access_token;
        console.log('Login successful. Token acquired.');
    } catch (err) {
        console.error('Login failed:', err.message);
        return;
    }

    const api = axios.create({
        baseURL: 'http://localhost:5001',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    console.log('\n=== TESTING POST /api/otp/send ===');
    try {
        const res = await api.post('/api/otp/send', { action: 'job_post' });
        console.log('Send OTP response:', res.status, res.data);
    } catch (err) {
        console.error('Send OTP failed:', err.response?.status, err.response?.data || err.message);
        return;
    }

    console.log('\n=== VERIFYING DB STATE AFTER SEND ===');
    let dbOtp = null;
    try {
        const { data: profile, error } = await adminClient
            .from('profiles')
            .select('email_otp, otp_purpose, otp_attempts, otp_expires_at')
            .eq('user_id', userId)
            .single();
        if (error) throw error;

        console.log('DB Profile Status:');
        console.log('- email_otp present:', !!profile.email_otp);
        console.log('- otp_purpose:', profile.otp_purpose);
        console.log('- otp_attempts:', profile.otp_attempts);
        console.log('- otp_expires_at:', profile.otp_expires_at);
        dbOtp = profile.email_otp;
    } catch (err) {
        console.error('DB check failed:', err.message);
        return;
    }

    console.log('\n=== TESTING POST /api/otp/verify (INVALID CODE) ===');
    try {
        await api.post('/api/otp/verify', { otp: '000000', purpose: 'job_post' });
        console.error('Verify unexpectedly succeeded for wrong code!');
    } catch (err) {
        console.log('Verify failed as expected:', err.response?.status, err.response?.data);
    }

    console.log('\n=== VERIFYING DB ATTEMPTS INCREMENTED ===');
    try {
        const { data: profile, error } = await adminClient
            .from('profiles')
            .select('otp_attempts')
            .eq('user_id', userId)
            .single();
        if (error) throw error;
        console.log('Failed attempts count in DB:', profile.otp_attempts);
    } catch (err) {
        console.error('DB check failed:', err.message);
        return;
    }

    console.log('\n=== TESTING POST /api/otp/verify (MISMATCHED PURPOSE) ===');
    try {
        await api.post('/api/otp/verify', { otp: '000000', purpose: 'proposal_submit' });
        console.error('Verify mismatch purpose unexpectedly succeeded!');
    } catch (err) {
        console.log('Verify mismatch purpose failed as expected:', err.response?.status, err.response?.data);
    }

    console.log('\n=== TESTING POST /api/otp/verify (VALID CODE OVERRIDE) ===');
    try {
        console.log('Overriding DB hash for test code "123456"...');
        const salt = await bcrypt.genSalt(10);
        const testHash = await bcrypt.hash('123456', salt);

        await adminClient
            .from('profiles')
            .update({ email_otp: testHash })
            .eq('user_id', userId);

        const res = await api.post('/api/otp/verify', { otp: '123456', purpose: 'job_post' });
        console.log('Verify success response:', res.status, res.data);
    } catch (err) {
        console.error('Verify failed:', err.response?.status, err.response?.data || err.message);
    }

    console.log('\n=== VERIFYING DB WIPED ON SUCCESS ===');
    try {
        const { data: profile, error } = await adminClient
            .from('profiles')
            .select('email_otp, otp_purpose, otp_attempts, otp_expires_at')
            .eq('user_id', userId)
            .single();
        if (error) throw error;

        console.log('DB Profile Status after success:');
        console.log('- email_otp:', profile.email_otp);
        console.log('- otp_purpose:', profile.otp_purpose);
        console.log('- otp_attempts:', profile.otp_attempts);
        console.log('- otp_expires_at:', profile.otp_expires_at);
    } catch (err) {
        console.error('DB check failed:', err.message);
    }
}

testOtpFlow();
