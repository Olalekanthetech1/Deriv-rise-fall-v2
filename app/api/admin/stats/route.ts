import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

let redisClient: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    redisClient = Redis.fromEnv();
  } catch (err) {}
}

const CACHE_KEY = 'admin_stats_cache';
const CACHE_TTL_SECONDS = 30; // 30 seconds

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const forceSimulated = searchParams.get('mode') === 'simulated';

    if (redisClient && !forceSimulated) {
      try {
        const cached = await redisClient.get(CACHE_KEY);
        if (cached) {
          return NextResponse.json(cached);
        }
      } catch (err) {
        logger.warn('Redis cache read error in admin/stats');
      }
    }

    const isDbConnected = await initDbSchema();
    const sql = getDb();

    // Default dynamic simulated dataset when DB has no trades or is offline
    const dynamicDefaultBrackets = [
      { bracket: '70-79%', wins: 14, losses: 5, total: 19, winRate: 73.7 },
      { bracket: '80-89%', wins: 22, losses: 3, total: 25, winRate: 88.0 },
      { bracket: '90-100%', wins: 18, losses: 1, total: 19, winRate: 94.7 },
    ];

    const dynamicDefaultPnlCurve = Array.from({ length: 20 }, (_, i) => {
      const idx = i + 1;
      const baseProfit = idx * 12.5 + Math.sin(idx * 0.8) * 15;
      return { tradeIndex: idx, pnl: Number(baseProfit.toFixed(2)) };
    });

    const dynamicDefaultSummary = {
      totalTrades: 63,
      wins: 54,
      losses: 9,
      winRate: 85.7,
      totalProfit: 268.50,
      totalTicks: 124500,
      totalModels: 5,
      activeModel: 'XGBoost-Ensemble-v4.2',
      activeAccuracy: 88.4,
    };

    if (forceSimulated || !sql || !isDbConnected) {
      return NextResponse.json({
        isDbConnected: Boolean(isDbConnected) && !forceSimulated,
        isSimulated: true,
        summary: dynamicDefaultSummary,
        confidenceBrackets: dynamicDefaultBrackets,
        pnlCurve: dynamicDefaultPnlCurve,
        recentTrades: [
          { id: 101, symbol: 'R_100', contract_type: 'RISE', stake: 10, payout: 19.5, status: 'WON', prediction_confidence: 91.2, strategy: 'XGBoost Horizon 5t', executed_at: new Date(Date.now() - 1000 * 60 * 2).toISOString() },
          { id: 102, symbol: 'R_75', contract_type: 'FALL', stake: 10, payout: 19.5, status: 'WON', prediction_confidence: 88.4, strategy: 'LightGBM Multi-Feature', executed_at: new Date(Date.now() - 1000 * 60 * 5).toISOString() },
          { id: 103, symbol: 'R_50', contract_type: 'RISE', stake: 10, payout: 0, status: 'LOST', prediction_confidence: 76.1, strategy: 'ONNX Deep Classifier', executed_at: new Date(Date.now() - 1000 * 60 * 12).toISOString() },
          { id: 104, symbol: '1HZ100V', contract_type: 'RISE', stake: 10, payout: 19.5, status: 'WON', prediction_confidence: 93.8, strategy: 'XGBoost Horizon 5t', executed_at: new Date(Date.now() - 1000 * 60 * 18).toISOString() },
        ],
      });
    }

    // Query real PostgreSQL stats
    const tradeRows = await sql`
      SELECT id, symbol, contract_type, stake, payout, status, prediction_confidence, strategy, executed_at
      FROM trades
      ORDER BY executed_at DESC
      LIMIT 100
    `;

    if (tradeRows.length === 0) {
      return NextResponse.json({
        isDbConnected: true,
        isSimulated: true,
        summary: dynamicDefaultSummary,
        confidenceBrackets: dynamicDefaultBrackets,
        pnlCurve: dynamicDefaultPnlCurve,
        recentTrades: [],
      });
    }

    const ticksCountRes = await sql`SELECT COUNT(*) as cnt FROM ticks`;
    const totalTicks = parseInt(ticksCountRes[0]?.cnt || '0', 10);

    const modelCountRes = await sql`SELECT COUNT(*) as cnt FROM ml_models`;
    const totalModels = parseInt(modelCountRes[0]?.cnt || '0', 10);

    const activeModelRes = await sql`SELECT model_id, accuracy FROM ml_models ORDER BY trained_at DESC LIMIT 1`;
    const activeModel = activeModelRes.length > 0 ? activeModelRes[0].model_id : 'XGBoost-Default-v3';
    const activeAccuracy = activeModelRes.length > 0 ? parseFloat(activeModelRes[0].accuracy) || 88.4 : 88.4;

    // Process trade metrics
    let wins = 0;
    let losses = 0;
    let totalProfit = 0;

    const bracketsMap: Record<string, { wins: number; losses: number; total: number }> = {
      '70-79%': { wins: 0, losses: 0, total: 0 },
      '80-89%': { wins: 0, losses: 0, total: 0 },
      '90-100%': { wins: 0, losses: 0, total: 0 },
    };

    let cumPnl = 0;
    const pnlCurve: Array<{ tradeIndex: number; pnl: number }> = [];

    tradeRows.forEach((t: any, idx: number) => {
      const isWin = t.status === 'WON' || t.status === 'WIN' || (parseFloat(t.payout) > parseFloat(t.stake));
      const conf = parseFloat(t.prediction_confidence) || 85.0;
      const stakeNum = parseFloat(t.stake) || 10;
      const payoutNum = parseFloat(t.payout) || (isWin ? stakeNum * 1.95 : 0);

      if (isWin) {
        wins++;
        cumPnl += (payoutNum - stakeNum);
      } else {
        losses++;
        cumPnl -= stakeNum;
      }

      pnlCurve.push({ tradeIndex: tradeRows.length - idx, pnl: parseFloat(cumPnl.toFixed(2)) });

      // Assign to bracket
      let bracketKey = '70-79%';
      if (conf >= 90) bracketKey = '90-100%';
      else if (conf >= 80) bracketKey = '80-89%';

      bracketsMap[bracketKey].total += 1;
      if (isWin) bracketsMap[bracketKey].wins += 1;
      else bracketsMap[bracketKey].losses += 1;
    });

    const totalTrades = tradeRows.length || 1;
    const winRate = parseFloat(((wins / totalTrades) * 100).toFixed(1));

    const confidenceBrackets = Object.keys(bracketsMap).map((key) => {
      const b = bracketsMap[key];
      const wr = b.total > 0 ? parseFloat(((b.wins / b.total) * 100).toFixed(1)) : 0;
      return {
        bracket: key,
        wins: b.wins,
        losses: b.losses,
        total: b.total,
        winRate: wr,
      };
    });

    const responseData = {
      isDbConnected: true,
      summary: {
        totalTrades: tradeRows.length,
        wins,
        losses,
        winRate,
        totalProfit: parseFloat(cumPnl.toFixed(2)),
        totalTicks,
        totalModels,
        activeModel,
        activeAccuracy,
      },
      confidenceBrackets,
      pnlCurve: pnlCurve.reverse(),
      recentTrades: tradeRows.slice(0, 20),
    };

    if (redisClient) {
      try {
        await redisClient.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(responseData));
        logger.info(`Cached admin stats for ${CACHE_TTL_SECONDS}s`);
      } catch (err) {
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
  try {
    const body = await req.json();
    const { action, count = 20 } = body;

    if (action === 'flush_cache') {
      if (redisClient) {
        try {
          await redisClient.del(CACHE_KEY);
        } catch (err) {}
      }
      return NextResponse.json({ success: true, message: 'Stats cache flushed' });
    }

    if (action === 'seed_trades') {
      const isDbConnected = await initDbSchema();
      const sql = getDb();

      if (!sql || !isDbConnected) {
        return NextResponse.json({ success: false, error: 'Database not connected to seed trades' }, { status: 400 });
      }

      const symbols = ['R_100', 'R_75', 'R_50', 'R_25', '1HZ100V'];
      const strategies = ['XGBoost Horizon 5t', 'LightGBM Multi-Feature', 'ONNX Deep Classifier', 'Random Forest Baseline'];

      for (let i = 0; i < count; i++) {
        const symbol = symbols[Math.floor(Math.random() * symbols.length)];
        const strategy = strategies[Math.floor(Math.random() * strategies.length)];
        const confidence = parseFloat((72 + Math.random() * 26).toFixed(1));
        const isWin = Math.random() < (confidence > 85 ? 0.88 : 0.65);
        const stake = 10;
        const payout = isWin ? parseFloat((stake * 1.95).toFixed(2)) : 0;
        const status = isWin ? 'WON' : 'LOST';
        const contractType = Math.random() > 0.5 ? 'RISE' : 'FALL';

        await sql`
          INSERT INTO trades (symbol, contract_type, stake, payout, status, prediction_confidence, strategy, executed_at)
          VALUES (${symbol}, ${contractType}, ${stake}, ${payout}, ${status}, ${confidence}, ${strategy}, NOW() - (${i} * INTERVAL '1 minute'))
        `;
      }

      if (redisClient) {
        try { await redisClient.del(CACHE_KEY); } catch (e) {}
      }

      return NextResponse.json({ success: true, message: `Successfully seeded ${count} trades.` });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Action failed' }, { status: 500 });
  }
}
