import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';
import { verifySessionToken } from '../auth/route';

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

let redisClient: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redisClient = Redis.fromEnv();
  } catch (err) {
    logger.warn('Unable to initialize Redis client for admin stats');
  }
}

const CACHE_KEY = 'admin_stats_cache_v3';
const CACHE_TTL_SECONDS = 30;

const emptyConfidenceBrackets = [
  { bracket: '70-79%', wins: 0, losses: 0, total: 0, winRate: 0 },
  { bracket: '80-89%', wins: 0, losses: 0, total: 0, winRate: 0 },
  { bracket: '90-100%', wins: 0, losses: 0, total: 0, winRate: 0 },
];

const emptyPnlCurve = [{ tradeIndex: 0, pnl: 0 }];

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    if (redisClient) {
      try {
        const cached = await redisClient.get(CACHE_KEY);
        if (cached) return NextResponse.json(cached);
      } catch {
        logger.warn('Redis cache read error in admin/stats');
      }
    }

    const isDbConnected = await initDbSchema();
    const sql = getDb();

    if (!sql || !isDbConnected) {
      return NextResponse.json({
        isDbConnected: false,
        isSimulated: false,
        summary: {
          totalTrades: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalProfit: 0,
          totalTicks: 0,
          totalModels: 0,
          activeModel: 'Unavailable (DB Offline)',
          activeAccuracy: null,
        },
        confidenceBrackets: emptyConfidenceBrackets,
        pnlCurve: emptyPnlCurve,
        recentTrades: [],
      });
    }

    const [tradeRows, totalTradesRes, ticksCountRes, modelCountRes, activeModelRes] = await Promise.all([
      sql`
        SELECT id, symbol, contract_type, stake, payout, status, prediction_confidence, strategy, executed_at
        FROM trades
        ORDER BY executed_at DESC
        LIMIT 100
      `.catch(() => []),
      sql`SELECT COUNT(*) as cnt FROM trades`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM ticks`.catch(() => [{ cnt: '0' }]),
      sql`SELECT COUNT(*) as cnt FROM ml_models`.catch(() => [{ cnt: '0' }]),
      sql`SELECT model_id, accuracy FROM ml_models ORDER BY trained_at DESC LIMIT 1`.catch(() => []),
    ]);

    const totalTrades = parseInt(totalTradesRes[0]?.cnt || '0', 10);
    const totalTicks = parseInt(ticksCountRes[0]?.cnt || '0', 10);
    const totalModels = parseInt(modelCountRes[0]?.cnt || '0', 10);
    const activeModel = activeModelRes.length > 0 ? activeModelRes[0].model_id : 'Unavailable (No Trained Model)';
    const parsedAccuracy = activeModelRes.length > 0 ? Number(activeModelRes[0].accuracy) : NaN;
    const activeAccuracy = Number.isFinite(parsedAccuracy) ? parsedAccuracy : null;

    if (!tradeRows || tradeRows.length === 0) {
      return NextResponse.json({
        isDbConnected: true,
        isSimulated: false,
        summary: {
          totalTrades,
          wins: 0,
          losses: 0,
          winRate: 0,
          totalProfit: 0,
          totalTicks,
          totalModels,
          activeModel,
          activeAccuracy,
        },
        confidenceBrackets: emptyConfidenceBrackets,
        pnlCurve: emptyPnlCurve,
        recentTrades: [],
      });
    }

    let wins = 0;
    let losses = 0;
    let totalProfit = 0;
    let pnlDataPoints = 0;

    const bracketsMap: Record<string, { wins: number; losses: number; total: number }> = {
      '70-79%': { wins: 0, losses: 0, total: 0 },
      '80-89%': { wins: 0, losses: 0, total: 0 },
      '90-100%': { wins: 0, losses: 0, total: 0 },
    };

    let cumPnl = 0;
    const pnlCurve: Array<{ tradeIndex: number; pnl: number }> = [];

    tradeRows.forEach((t: any, idx: number) => {
      const status = String(t.status || '').toUpperCase();
      const stake = Number(t.stake);
      const payout = Number(t.payout);
      const hasStake = Number.isFinite(stake) && stake >= 0;
      const hasPayout = Number.isFinite(payout) && payout >= 0;
      const isWin = status === 'WON' || status === 'WIN';
      const isLoss = status === 'LOST' || status === 'LOSS';

      if (isWin) wins++;
      if (isLoss) losses++;

      // Only calculate P&L from actual persisted monetary values. Never invent payout/stake values.
      if ((isWin || isLoss) && hasStake && hasPayout) {
        cumPnl += payout - stake;
        pnlDataPoints++;
      }

      pnlCurve.push({
        tradeIndex: tradeRows.length - idx,
        pnl: Number(cumPnl.toFixed(2)),
      });

      const confidence = Number(t.prediction_confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return;

      let bracketKey: string | null = null;
      if (confidence >= 90) bracketKey = '90-100%';
      else if (confidence >= 80) bracketKey = '80-89%';
      else if (confidence >= 70) bracketKey = '70-79%';

      if (!bracketKey) return;
      bracketsMap[bracketKey].total++;
      if (isWin) bracketsMap[bracketKey].wins++;
      else if (isLoss) bracketsMap[bracketKey].losses++;
    });

    const resolvedTrades = wins + losses;
    const winRate = resolvedTrades > 0 ? Number(((wins / resolvedTrades) * 100).toFixed(1)) : 0;

    const confidenceBrackets = Object.keys(bracketsMap).map((key) => {
      const b = bracketsMap[key];
      const wr = b.total > 0 ? Number(((b.wins / b.total) * 100).toFixed(1)) : 0;
      return { bracket: key, wins: b.wins, losses: b.losses, total: b.total, winRate: wr };
    });

    const responseData = {
      isDbConnected: true,
      isSimulated: false,
      summary: {
        totalTrades,
        wins,
        losses,
        winRate,
        totalProfit: Number(cumPnl.toFixed(2)),
        totalTicks,
        totalModels,
        activeModel,
        activeAccuracy,
        metricsQuality: {
          recentTradesSampled: tradeRows.length,
          resolvedTrades,
          pnlTradesWithCompleteAmounts: pnlDataPoints,
        },
      },
      confidenceBrackets,
      pnlCurve: pnlCurve.reverse(),
      recentTrades: tradeRows.slice(0, 20),
    };

    if (redisClient) {
      try {
        await redisClient.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(responseData));
      } catch {
        logger.warn('Redis cache write error in admin/stats');
      }
    }

    return NextResponse.json(responseData);
  } catch (err: any) {
    logger.error(`Error fetching admin stats: ${err.message}`);
    return NextResponse.json({ error: err.message || 'Stats fetch failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'flush_cache') {
      if (redisClient) {
        try {
          await redisClient.del(CACHE_KEY);
        } catch {
          logger.warn('Failed to flush admin stats cache');
        }
      }
      return NextResponse.json({ success: true, message: 'Stats cache flushed' });
    }

    if (action === 'sync_ticks') {
      const isDbConnected = await initDbSchema();
      if (!isDbConnected) {
        return NextResponse.json({ success: false, error: 'PostgreSQL Database not connected' }, { status: 400 });
      }

      const { ensureMinTicks } = await import('@/lib/ticks-helper');
      const symbolsToSync = ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', '1HZ50V', 'FRXEURUSD', 'CWMXAUUSD'];
      let syncedTotal = 0;

      for (const sym of symbolsToSync) {
        const ticks = await ensureMinTicks(sym, 1000, true);
        syncedTotal += ticks.length;
      }

      if (redisClient) {
        try { await redisClient.del(CACHE_KEY); } catch {}
      }

      return NextResponse.json({
        success: true,
        syncedTotal,
        message: `Successfully synchronized ${syncedTotal.toLocaleString()} real Deriv ticks across ${symbolsToSync.length} assets directly into PostgreSQL.`,
      });
    }

    if (action === 'seed_trades') {
      return NextResponse.json({
        success: false,
        error: 'Synthetic trade seeding is disabled. Admin metrics must contain real executed contracts only.',
      }, { status: 410 });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Action failed' }, { status: 500 });
  }
}
