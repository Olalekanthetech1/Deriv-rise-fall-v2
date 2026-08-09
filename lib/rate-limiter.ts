import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// In-memory fallback is intentionally best-effort. Production deployments should provide Upstash Redis
// so rate limits are shared across instances.
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

// ML operations: high throughput because model endpoints can legitimately be called frequently.
const mlRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(300, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

// General API traffic.
const apiRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(600, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

// Authentication endpoints require a materially stricter limit to slow credential attacks.
const authRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(10, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

// Tick/feed traffic is high volume by design.
const wsRatelimit = redisClient
  ? new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(3000, '1 m'),
      ephemeralCache: new Map(),
    })
  : null;

export async function checkRateLimit(key: string, type: 'ml' | 'api' | 'auth' | 'ws' = 'api') {
  let result;

  if (type === 'ml') {
    result = mlRatelimit
      ? await mlRatelimit.limit(key)
      : getInMemoryRateLimit(key, 300, 60000);
  } else if (type === 'auth') {
    result = authRatelimit
      ? await authRatelimit.limit(key)
      : getInMemoryRateLimit(key, 10, 60000);
  } else if (type === 'ws') {
    result = wsRatelimit
      ? await wsRatelimit.limit(key)
      : getInMemoryRateLimit(key, 3000, 60000);
  } else {
    result = apiRatelimit
      ? await apiRatelimit.limit(key)
      : getInMemoryRateLimit(key, 600, 60000);
  }

  if (!result.success && redisClient) await incrementRedisBlock();
  return result;
}
