import { NextResponse } from 'next/server';
import { evaluateProductionEnsemble } from '@/lib/server/production-ensemble';
import { buildSignalItems, buildConsensus, buildModeRecommendations } from '@/lib/server/signal-builders';
import { ensureMinTicks, type TickPoint } from '@/lib/server/market-data';
import { getDb } from '@/lib/server/db';
import { parseDuration } from '@/lib/duration';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbol = String(body?.symbol ?? '').trim();
    if (!symbol) return NextResponse.json({ error: 'Symbol is required.' }, { status: 400 });

    const duration = parseDuration(body?.duration ?? body?.durationSecs ?? 60);
    const assetCategoryNum = Number(body?.assetCategory ?? 0);

    let assetClass: string | undefined;
    let marketType: string | undefined;
    const sql = getDb();
    if (sql) {
      try {
        const rows = await sql`SELECT asset_class, market_type FROM market_assets WHERE symbol = ${symbol} LIMIT 1`;
        assetClass = rows?.[0]?.asset_class ? String(rows[0].asset_class) : undefined;
        marketType = rows?.[0]?.market_type ? String(rows[0].market_type) : undefined;
      } catch (dbErr) {
        console.warn('[Signal Asset Context Warning]:', dbErr);
      }
    }

    let tickList: TickPoint[] = Array.isArray(body?.ticks) && body.ticks.length > 0 ? body.ticks : [];
    if (tickList.length < 25) tickList = await ensureMinTicks(symbol, 100);
    if (tickList.length < 25) throw new Error(`Insufficient real ticks for signal generation on ${symbol}. Minimum 25 required.`);

    const ensemble = await evaluateProductionEnsemble(tickList, {
      symbol,
      durationSecs: duration.seconds,
      durationValue: duration.value,
      durationUnit: duration.unit,
      assetCategory: assetCategoryNum,
      assetClass,
      marketType,
      requiredContextTicks: 100,
    });

    const now = Date.now();
    const generatedSignals = buildSignalItems(ensemble, duration, now);
    if (!generatedSignals.length) throw new Error('NO_NATIVE_MODEL_SIGNALS_AVAILABLE');

    const modeRecommendations = ensemble.strategyGate.accepted ? buildModeRecommendations(generatedSignals) : [];
    const consensusBase = buildConsensus(generatedSignals, now);
    const consensus = ensemble.strategyGate.accepted ? { ...consensusBase, modeRecommendations } : {
      ...consensusBase,
      direction: 'WAIT' as const,
      confidence: ensemble.confidence,
      status: 'WAIT' as const,
      expiresAt: now,
      expiresInSeconds: 0,
      modeRecommendations: [],
    };

    let totalVerified = 0;
    let winCount = 0;
    let accuracy = '0.0%';
    if (sql) {
      try {
        const statsRes = await sql`SELECT COUNT(*)::int AS total, COUNT(CASE WHEN status = 'WON' THEN 1 END)::int AS wins FROM trades WHERE status IN ('WON', 'LOST')`;
        if (statsRes?.length && statsRes[0].total > 0) {
          totalVerified = statsRes[0].total;
          winCount = statsRes[0].wins;
          accuracy = `${((winCount / totalVerified) * 100).toFixed(1)}%`;
        }
      } catch (statsErr) {
        console.warn('[Signal Stats Warning]:', statsErr);
      }
    }

    return NextResponse.json({
      symbol,
      duration,
      signals: generatedSignals,
      consensus,
      strategyGate: ensemble.strategyGate,
      assetContext: ensemble.assetContext,
      confidence: ensemble.confidence,
      verifiedTrades: totalVerified,
      verifiedWins: winCount,
      accuracy,
      generatedAt: now,
    });
  } catch (error) {
    console.error('[Signal Prediction Error]:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Signal generation failed.' }, { status: 500 });
  }
}
