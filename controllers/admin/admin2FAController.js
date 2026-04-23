const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const supabase = require('../../supabase/adminClient');
const logger = require('../../utils/logger');

/**
 * Generate 2FA secret and QR code for admin
 */
exports.setup2FA = async (req, res, next) => {
    try {
        const userId = req.user.id;
        
        // Check if already enabled
        const { data: adminData } = await supabase
            .from('admins')
            .select('two_factor_enabled, two_factor_secret')
            .eq('id', userId)
            .single();
        
        if (adminData?.two_factor_enabled) {
            return res.status(400).json({ 
                success: false, 
                message: '2FA is already enabled for your account' 
            });
        }
        
        // Generate new secret
        const secret = speakeasy.generateSecret({
            name: `Connect.com Admin (${req.user.email})`,
            issuer: 'Connect.com',
            length: 32
        });
        
        // Save secret temporarily (not enabling yet)
        const { error: updateError } = await supabase
            .from('admins')
            .update({ 
                two_factor_secret: secret.base32,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (updateError) throw updateError;
        
        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
        
        res.status(200).json({
            success: true,
            data: {
                secret: secret.base32,
                qrCode: qrCodeUrl,
                otpAuthUrl: secret.otpauth_url
            },
            message: 'Scan QR code with your authenticator app'
        });
        
    } catch (error) {
        next(error);
    }
};

/**
 * Verify 2FA token and enable
 */
exports.verifyAndEnable2FA = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Token is required' 
            });
        }
        
        // Get admin's secret
        const { data: adminData } = await supabase
            .from('admins')
            .select('two_factor_secret')
            .eq('id', userId)
            .single();
        
        if (!adminData?.two_factor_secret) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please setup 2FA first by scanning the QR code' 
            });
        }
        
        // Verify token
        const verified = speakeasy.totp.verify({
            secret: adminData.two_factor_secret,
            encoding: 'base32',
            token: token,
            window: 2 // Allow 2 time steps before/after for clock skew
        });
        
        if (!verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid verification code' 
            });
        }
        
        // Enable 2FA
        const { error: updateError } = await supabase
            .from('admins')
            .update({ 
                two_factor_enabled: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (updateError) throw updateError;
        
        res.status(200).json({
            success: true,
            message: '2FA enabled successfully'
        });
        
    } catch (error) {
        next(error);
    }
};

/**
 * Disable 2FA
 */
exports.disable2FA = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { token, password } = req.body;
        
        // Verify current password (optional but recommended)
        if (password) {
            // Note: Password verification would require re-authentication
            // This is a simplified version
            logger.warn('[Disable2FA] Password verification skipped - implement in production');
        }
        
        // Verify 2FA token one last time
        const { data: adminData } = await supabase
            .from('admins')
            .select('two_factor_secret, two_factor_enabled')
            .eq('id', userId)
            .single();
        
        if (!adminData?.two_factor_enabled) {
            return res.status(400).json({ 
                success: false, 
                message: '2FA is not enabled on your account' 
            });
        }
        
        const verified = speakeasy.totp.verify({
            secret: adminData.two_factor_secret,
            encoding: 'base32',
            token: token,
            window: 2
        });
        
        if (!verified) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid verification code' 
            });
        }
        
        // Disable 2FA and clear secret
        const { error: updateError } = await supabase
            .from('admins')
            .update({ 
                two_factor_enabled: false,
                two_factor_secret: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        
        if (updateError) throw updateError;
        
        res.status(200).json({
            success: true,
            message: '2FA disabled successfully'
        });
        
    } catch (error) {
        next(error);
    }
};

/**
 * Verify 2FA during login (called after successful auth)
 */
exports.verify2FALogin = async (req, res, next) => {
    try {
        const { email, token } = req.body;
        
        if (!email || !token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and token are required' 
            });
        }
        
        // Find admin by email
        const { data: adminData } = await supabase
            .from('admins')
            .select('*')
            .eq('email', email)
            .single();
        
        if (!adminData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Admin not found' 
            });
        }
        
        // Check if 2FA is enabled
        if (!adminData.two_factor_enabled) {
            return res.status(400).json({ 
                success: false, 
                message: '2FA is not enabled on this account' 
            });
        }
        
        // Verify token
        const verified = speakeasy.totp.verify({
            secret: adminData.two_factor_secret,
            encoding: 'base32',
            token: token,
            window: 2
        });
        
        if (!verified) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid 2FA code' 
            });
        }
        
        // 2FA verified - generate session token
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password: req.body.password // Original password from login attempt
        });
        
        if (authError) throw authError;
        
        res.status(200).json({
            success: true,
            data: {
                user: authData.user,
                session: authData.session,
                role: adminData.role,
                twoFactorVerified: true
            },
            message: '2FA verified successfully'
        });
        
    } catch (error) {
        next(error);
    }
};
