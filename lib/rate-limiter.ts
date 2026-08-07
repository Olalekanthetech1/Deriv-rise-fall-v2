import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Simple in-memory rate limiter fallback
const memoryStore = new Map<string, { count: number; resetAt: number }>();
export let inMemoryBlocks = 0;

function getInMemoryRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const record = memoryStore.get(key);

  if (!record || record.resetAt < now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, limit, remaining: limit - 1, reset: now + windowMs };
  }

  if (record.count >= limit) {
    inMemoryBlocks++;
    return { success: false, limit, remaining: 0, reset: record.resetAt };
  }

  record.count += 1;
  return { success: true, limit, remaining: limit - record.count, reset: record.resetAt };
}

export let redisClient: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redisClient = Redis.fromEnv();
  } catch (err) {
    console.warn('Failed to initialize Upstash Redis, falling back to in-memory.', err);
  }
}

export async function incrementRedisBlock() {
  if (redisClient) {
    try {
      await redisClient.incr('rate_limit_blocks');
    } catch {}
  }
}

// Generous, high-throughput rate limits for ML operations, live WebSocket ticks, and general APIs
const mlRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(300, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

// 600 req/min for General API
const apiRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(600, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

// 3000 req/min for WS feed / Ticks (High volume)
const wsRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(3000, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

export async function checkRateLimit(key: string, type: 'ml' | 'api' | 'ws' = 'api') {
  let result;
  
  if (type === 'ml') {
    if (mlRatelimit) {
      result = await mlRatelimit.limit(key);
    } else {
      result = getInMemoryRateLimit(key, 300, 60000);
    }
  } else if (type === 'ws') {
    if (wsRatelimit) {
      result = await wsRatelimit.limit(key);
    } else {
      result = getInMemoryRateLimit(key, 3000, 60000);
    }
  } else {
    if (apiRatelimit) {
      result = await apiRatelimit.limit(key);
    } else {
      result = getInMemoryRateLimit(key, 600, 60000);
    }
  }

  if (!result.success) {
    if (redisClient) await incrementRedisBlock();
  }
  
  return result;
}

