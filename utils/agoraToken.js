const { RtcTokenBuilder, RtcRole } = require('agora-token');

/**
 * Generate an Agora RTC token for a user to join a channel.
 * @param {string} channelName - The Agora channel name
 * @param {number|string} uid - User ID (0 = let Agora assign)
 * @param {'publisher'|'subscriber'} role - User role
 * @param {number} expireSeconds - Token lifetime in seconds (default 1 hour)
 */
function generateRtcToken(channelName, uid = 0, role = 'publisher', expireSeconds = 3600) {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;

    if (!appId || !appCertificate) {
        throw new Error('AGORA_APP_ID and AGORA_APP_CERTIFICATE must be set in .env');
    }

    const agoraRole = role === 'subscriber' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
    const expireTime = Math.floor(Date.now() / 1000) + expireSeconds;
    const privilegeExpireTime = expireTime;

    // uid must be a number for Agora
    const numericUid = typeof uid === 'string'
        ? parseInt(uid.replace(/-/g, '').slice(0, 8), 16) % 100000
        : uid;

    const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        appCertificate,
        channelName,
        numericUid,
        agoraRole,
        expireTime,
        privilegeExpireTime
    );

    return { token, uid: numericUid, expireTime };
}

module.exports = { generateRtcToken };
