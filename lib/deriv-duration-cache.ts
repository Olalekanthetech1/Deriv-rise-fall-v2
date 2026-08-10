import type { DerivDurationDiscovery } from './deriv-duration-registry';
import { getDb, initDbSchema } from './db';

const CACHE_KEY = 'derivDurationDiscovery';

export type CachedDurationDiscovery = {
  discovery: DerivDurationDiscovery;
  cachedAt: string;
};

export async function readCachedDurationDiscovery(symbol: string): Promise<CachedDurationDiscovery | null> {
  const normalized = String(symbol ?? '').trim().toUpperCase();
  if (!normalized) return null;
  const sql = getDb();
  if (!sql || !(await initDbSchema())) return null;
  try {
    const rows = await sql`
      SELECT metadata->${CACHE_KEY} AS cached
      FROM market_assets
      WHERE symbol = ${normalized}
      LIMIT 1
    `;
    const cached = rows?.[0]?.cached as CachedDurationDiscovery | null | undefined;
    if (!cached?.discovery?.ranges?.length) return null;
    return cached;
  } catch (error) {
    console.warn(`[DerivDurationCache] read failed for ${normalized}:`, error);
    return null;
  }
}

export async function writeCachedDurationDiscovery(discovery: DerivDurationDiscovery): Promise<void> {
  const normalized = discovery.symbol.trim().toUpperCase();
  if (!normalized) return;
  const sql = getDb();
  if (!sql || !(await initDbSchema())) return;
  const cached: CachedDurationDiscovery = {
    discovery: { ...discovery, symbol: normalized },
    cachedAt: new Date().toISOString(),
  };
  try {
    await sql`
      INSERT INTO market_assets (symbol, asset_class, market_type, source, metadata)
      VALUES (${normalized}, 'unknown', 'unknown', 'deriv', ${JSON.stringify({ [CACHE_KEY]: cached })}::jsonb)
      ON CONFLICT (symbol) DO UPDATE
      SET metadata = COALESCE(market_assets.metadata, '{}'::jsonb) || ${JSON.stringify({ [CACHE_KEY]: cached })}::jsonb,
          updated_at = NOW()
    `;
  } catch (error) {
    console.warn(`[DerivDurationCache] write failed for ${normalized}:`, error);
  }
}
