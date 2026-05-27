const adminClient = require('../supabase/adminClient');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * TrustGraph & Identity Linkage Service
 * Detects multi-account fraud by linking users via behavioral signals.
 */
class TrustGraphService {
    /**
     * Hash sensitive details for storage (e.g., bank account, UPI)
     */
    static hashValue(value) {
        if (!value) return null;
        return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
    }

    /**
     * Update user signals (Device, IP, Payout Hash)
     * Triggered on Login, Signup, Withdrawal, etc.
     */
    static async updateSignals(userId, { deviceId, ip, payoutDetails }) {
        try {
            logger.info(`[TrustGraphService] Updating signals for user: ${userId}`);

            // 1. Fetch current signals
            const { data: profile, error: fetchErr } = await adminClient
                .from('profiles')
                .select('device_ids, ip_history, payout_hashes')
                .eq('user_id', userId)
                .single();

            if (fetchErr) throw fetchErr;

            const now = new Date().toISOString();
            let updated = false;

            // 2. Process Device ID
            let deviceIds = profile.device_ids || [];
            if (deviceId) {
                const existing = deviceIds.find(d => d.id === deviceId);
                if (existing) {
                    existing.lastUsedAt = now;
                } else {
                    deviceIds.push({ id: deviceId, firstUsedAt: now, lastUsedAt: now });
                }
                updated = true;
            }

            // 3. Process IP History
            let ipHistory = profile.ip_history || [];
            if (ip) {
                const existing = ipHistory.find(i => i.ip === ip);
                if (existing) {
                    existing.lastUsedAt = now;
                    existing.count = (existing.count || 1) + 1;
                } else {
                    ipHistory.push({ ip, firstUsedAt: now, lastUsedAt: now, count: 1 });
                }
                // Keep last 10 IPs to prevent bloat
                if (ipHistory.length > 10) ipHistory.shift();
                updated = true;
            }

            // 4. Process Payout Hashes
            let payoutHashes = profile.payout_hashes || [];
            if (payoutDetails) {
                const hashed = this.hashValue(payoutDetails);
                if (!payoutHashes.includes(hashed)) {
                    payoutHashes.push(hashed);
                    updated = true;
                }
            }

            if (!updated) return;

            // 5. Save updated signals
            const { error: updateErr } = await adminClient
                .from('profiles')
                .update({
                    device_ids: deviceIds,
                    ip_history: ipHistory,
                    payout_hashes: payoutHashes,
                    updated_at: now
                })
                .eq('user_id', userId);

            if (updateErr) throw updateErr;

            // 6. Trigger link detection
            await this.detectLinks(userId, { deviceId, ip, payoutHashes });

        } catch (err) {
            logger.error('[TrustGraphService] Signal update failed', err);
        }
    }

    /**
     * Scan for other users sharing the same signals
     */
    static async detectLinks(userId, { deviceId, ip, payoutHashes }) {
        try {
            const links = [];

            // A. Same Device ID (Critical Link)
            if (deviceId) {
                const { data: matchedDevices } = await adminClient
                    .from('profiles')
                    .select('user_id')
                    .neq('user_id', userId)
                    .filter('device_ids', 'cs', JSON.stringify([{ id: deviceId }]));

                if (matchedDevices) {
                    matchedDevices.forEach(m => {
                        links.push({ type: 'DEVICE', otherId: m.user_id, weight: 1.0, meta: { deviceId } });
                    });
                }
            }

            // B. Same Payout Hash (Critical Link)
            if (payoutHashes && payoutHashes.length > 0) {
                const { data: matchedPayouts } = await adminClient
                    .from('profiles')
                    .select('user_id, payout_hashes')
                    .neq('user_id', userId);
                
                if (matchedPayouts) {
                    matchedPayouts.forEach(m => {
                        const intersection = m.payout_hashes.filter(h => payoutHashes.includes(h));
                        if (intersection.length > 0) {
                            links.push({ type: 'PAYOUT', otherId: m.user_id, weight: 1.0, meta: { hashes: intersection } });
                        }
                    });
                }
            }

            // C. Same IP Address (Potential Link)
            if (ip) {
                const { data: matchedIPs } = await adminClient
                    .from('profiles')
                    .select('user_id')
                    .neq('user_id', userId)
                    .filter('ip_history', 'cs', JSON.stringify([{ ip }]));

                if (matchedIPs) {
                    matchedIPs.forEach(m => {
                        links.push({ type: 'IP', otherId: m.user_id, weight: 0.3, meta: { ip } });
                    });
                }
            }

            if (links.length === 0) return;

            // Persist links
            for (const link of links) {
                const [user_a_id, user_b_id] = [userId, link.otherId].sort();
                await adminClient
                    .from('fraud_links')
                    .upsert({
                        user_a_id,
                        user_b_id,
                        link_type: link.type,
                        weight: link.weight,
                        metadata: link.meta
                    }, { onConflict: 'user_a_id, user_b_id, link_type' });
            }

            logger.info(`[TrustGraphService] Detected ${links.length} new potential links for user: ${userId}`);

        } catch (err) {
            logger.error('[TrustGraphService] Link detection failed', err);
        }
    }

    /**
     * BFS to find all connected users in a cluster
     */
    static async getCluster(userId, depth = 3) {
        try {
            const visited = new Set();
            const queue = [{ id: userId, d: 0 }];
            const cluster = [];
            const links = [];

            while (queue.length > 0) {
                const { id, d } = queue.shift();
                if (visited.has(id)) continue;
                visited.add(id);

                // Fetch user basic info
                const { data: user } = await adminClient
                    .from('profiles')
                    .select('user_id, name, avatar_url, role, internal_trust_score, is_banned')
                    .eq('user_id', id)
                    .single();
                
                if (user) cluster.push(user);

                if (d < depth) {
                    // Fetch neighbors
                    const { data: userLinks } = await adminClient
                        .from('fraud_links')
                        .select('*')
                        .or(`user_a_id.eq.${id},user_b_id.eq.${id}`);

                    if (userLinks) {
                        userLinks.forEach(l => {
                            links.push(l);
                            const neighborId = l.user_a_id === id ? l.user_b_id : l.user_a_id;
                            queue.push({ id: neighborId, d: d + 1 });
                        });
                    }
                }
            }

            // Deduplicate links
            const uniqueLinks = Array.from(new Set(links.map(l => l.id)))
                .map(id => links.find(l => l.id === id));

            return { nodes: cluster, links: uniqueLinks };
        } catch (err) {
            logger.error('[TrustGraphService] Cluster discovery failed', err);
            return { nodes: [], links: [] };
        }
    }

    /**
     * Discover all clusters (connected components) in the fraud graph
     */
    static async discoverClusters() {
        try {
            // 1. Fetch all links
            const { data: allLinks, error } = await adminClient
                .from('fraud_links')
                .select('*');

            // Gracefully handle missing table or empty data
            if (error) {
                logger.warn('[TrustGraphService] fraud_links table may not exist yet:', error.message);
                return [];
            }
            if (!allLinks || allLinks.length === 0) return [];

            // 2. Build adjacency list
            const adj = {};
            const linkTypes = {}; // To track the strongest link type in a cluster

            allLinks.forEach(link => {
                if (!adj[link.user_a_id]) adj[link.user_a_id] = [];
                if (!adj[link.user_b_id]) adj[link.user_b_id] = [];
                adj[link.user_a_id].push(link.user_b_id);
                adj[link.user_b_id].push(link.user_a_id);
                
                // Store link types for type determination
                const clusterKey = [link.user_a_id, link.user_b_id].sort().join(':');
                linkTypes[clusterKey] = link.link_type;
            });

            // 3. Find connected components (Clusters)
            const visited = new Set();
            const clusters = [];

            const users = Object.keys(adj);
            for (const userId of users) {
                if (!visited.has(userId)) {
                    const cluster = [];
                    const types = new Set();
                    const queue = [userId];
                    visited.add(userId);

                    while (queue.length > 0) {
                        const curr = queue.shift();
                        cluster.push(curr);

                        (adj[curr] || []).forEach(neighbor => {
                            if (!visited.has(neighbor)) {
                                visited.add(neighbor);
                                queue.push(neighbor);
                                
                                // Record the link type
                                const key = [curr, neighbor].sort().join(':');
                                if (linkTypes[key]) types.add(linkTypes[key]);
                            }
                        });
                    }

                    // Only return clusters with more than 1 user
                    if (cluster.length > 1) {
                        // Determine predominant type (Priority: DEVICE > PAYOUT > IP)
                        let predominantType = 'IP';
                        if (types.has('DEVICE')) predominantType = 'DEVICE';
                        else if (types.has('PAYOUT')) predominantType = 'PAYOUT';

                        clusters.push({
                            userIds: cluster,
                            type: predominantType,
                            allTypes: Array.from(types)
                        });
                    }
                }
            }

            return clusters;
        } catch (err) {
            logger.error('[TrustGraphService] Global cluster discovery failed', err);
            return [];
        }
    }
}

module.exports = TrustGraphService;
