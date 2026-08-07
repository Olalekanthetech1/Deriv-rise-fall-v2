import { Redis } from '@upstash/redis';
import { getDb } from '@/lib/db';

let redisClient: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redisClient = Redis.fromEnv();
  } catch (err) {}
}

let inMemoryBlocks = 0;

export async function incrementRateLimitBlock() {
  if (redisClient) {
    try {
      await redisClient.incr('rate_limit_blocks');
    } catch {}
  } else {
    inMemoryBlocks++;
  }
}

export async function getRateLimitBlocks() {
  if (redisClient) {
    try {
      const blocks = await redisClient.get('rate_limit_blocks');
      return Number(blocks) || 0;
    } catch {
      return inMemoryBlocks;
    }
  }
  return inMemoryBlocks;
}

export async function checkDbStatus() {
  try {
    const sql = getDb();
    if (!sql) return false;
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
