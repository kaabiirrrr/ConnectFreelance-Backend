const Redis = require('ioredis');
const logger = require('./logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const BUFFER_SIZE = 10;
const BUFFER_TTL = 300; // 5 minutes

let redis;
let redisAvailable = false;
let lastErrorLogged = 0;
const ERROR_LOG_COOLDOWN = 60000 * 5; // Log error once every 5 mins

/**
 * IN-MEMORY FALLBACK (Degraded Mode)
 * Simple store that mimics Redis behavior for single-process resilience.
 */
class InProcessCache {
    constructor() {
        this.buffers = new Map(); // key -> []
        this.hashes = new Map();  // key -> count
        this.expiries = new Map(); // key -> timestamp
    }

    _cleanup(key) {
        if (this.expiries.has(key) && Date.now() > this.expiries.get(key)) {
            this.buffers.delete(key);
            this.hashes.delete(key);
            this.expiries.delete(key);
            return true;
        }
        return false;
    }

    expire(key, seconds) {
        this.expiries.set(key, Date.now() + (seconds * 1000));
    }

    async lpush(key, value) {
        this._cleanup(key);
        if (!this.buffers.has(key)) this.buffers.set(key, []);
        this.buffers.get(key).unshift(value);
    }

    async ltrim(key, start, end) {
        if (!this.buffers.has(key)) return;
        const list = this.buffers.get(key);
        this.buffers.set(key, list.slice(start, end + 1));
    }

    async lrange(key, start, end) {
        this._cleanup(key);
        if (!this.buffers.has(key)) return [];
        return this.buffers.get(key).slice(start, end + 1);
    }

    async incr(key) {
        this._cleanup(key);
        const count = (this.hashes.get(key) || 0) + 1;
        this.hashes.set(key, count);
        return count;
    }
}

const memStore = new InProcessCache();

try {
    redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
            // Aggressive backoff to prevent spamming
            return Math.min(times * 1000, 30000); 
        },
        reconnectOnError(err) {
            return true;
        }
    });

    redis.on('error', (err) => {
        redisAvailable = false;
        const now = Date.now();
        if (now - lastErrorLogged > ERROR_LOG_COOLDOWN) {
            logger.warn(`[Redis] Unavailable: ${err.message}. Switching to In-Memory Fallback.`);
            lastErrorLogged = now;
        }
    });

    redis.on('connect', () => {
        redisAvailable = true;
        logger.info('[Redis] Connected successfully (Elite State Active)');
    });
} catch (err) {
    logger.error('[Redis] Initialization failed', err);
}

/**
 * Stateful buffer for conversation-aware moderation
 */
const storeMessage = async (userId, content) => {
    const key = `chat_buffer:${userId}`;
    if (redisAvailable && redis) {
        try {
            await redis.lpush(key, content);
            await redis.ltrim(key, 0, BUFFER_SIZE - 1);
            await redis.expire(key, BUFFER_TTL);
            return;
        } catch (err) {
            redisAvailable = false;
        }
    }
    // Fallback
    await memStore.lpush(key, content);
    await memStore.ltrim(key, 0, BUFFER_SIZE - 1);
    memStore.expire(key, BUFFER_TTL);
};

const getHistory = async (userId) => {
    const key = `chat_buffer:${userId}`;
    let messages = [];
    
    if (redisAvailable && redis) {
        try {
            messages = await redis.lrange(key, 0, BUFFER_SIZE - 1);
            return messages.reverse();
        } catch (err) {
            redisAvailable = false;
        }
    }
    
    // Fallback
    messages = await memStore.lrange(key, 0, BUFFER_SIZE - 1);
    return messages.reverse();
};

/**
 * Anti-spam fingerprinting
 */
const checkFingerprint = async (userId, hash) => {
    const key = `msg_hash:${userId}:${hash}`;
    
    if (redisAvailable && redis) {
        try {
            const count = await redis.incr(key);
            if (count === 1) await redis.expire(key, BUFFER_TTL);
            return count;
        } catch (err) {
            redisAvailable = false;
        }
    }

    // Fallback
    const count = await memStore.incr(key);
    if (count === 1) memStore.expire(key, BUFFER_TTL);
    return count;
};

module.exports = {
    redis,
    storeMessage,
    getHistory,
    checkFingerprint,
    isRedisAvailable: () => redisAvailable
};
