import { NextRequest, NextResponse } from 'next/server';
import { PredictSchema } from '@/lib/validation-schemas';
import { xgboostModel } from '@/lib/xgboost-engine';
import { evaluateProductionEnsemble } from '@/lib/production-ensemble';
import { getDb } from '@/lib/db';
import { ensureMinTicks } from '@/lib/ticks-helper';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = PredictSchema.safeParse(rawBody);
    if (!parseResult.success) return NextResponse.json({ error: 'Invalid input parameters', details: parseResult.error.format() }, { status: 400 });

    const { symbol, ticks, durationSecs, assetCategory } = parseResult.data;
    let tickList = Array.isArray(ticks) && ticks.length > 0 ? ticks : [];
    if (tickList.length < 5) tickList = await ensureMinTicks(symbol, 100);
    if (tickList.length < 5) throw new Error(`Insufficient ticks for ${symbol}. Need at least 5.`);

    const startTime = Date.now();
    const ensemble = await evaluateProductionEnsemble(tickList, { symbol, durationSecs, assetCategory });
    const prediction = await xgboostModel.predictRemote(tickList, { symbol, durationSecs, assetCategory });
    const latencyMs = Math.max(1, Date.now() - startTime);
    const feat = ensemble.features;
    const microVelocity = feat.micro_velocity ?? 0;
    const shortVol = feat.short_volatility ?? 0.01;
    const noiseScore = Math.min(100, Math.max(0, Math.round((shortVol / (Math.abs(microVelocity) + 0.0001)) * 12)));

    const enrichedPrediction = {
      ...prediction,
      signal: ensemble.direction === 'RISE' ? 'CALL' : 'PUT',
      confidence: ensemble.confidence,
      probabilityUp: ensemble.probUp,
      probabilityDown: ensemble.probDown,
      ensemble,
      latencyMs,
      ticksProcessed: tickList.length,
      marketNoiseScore: noiseScore,
      marketRegime: ensemble.marketRegime,
      microVelocity,
      tickFrequency: feat.ticks_per_second ?? 1,
      volatilityRank: feat.macro_volatility ?? 0.05,
    };

    const sql = getDb();
    if (sql) {
      try {
        await sql`INSERT INTO trades (symbol, contract_type, stake, status, prediction_confidence, strategy) VALUES (${symbol}, ${enrichedPrediction.signal}, 10, 'PREDICTED', ${ensemble.confidence}, 'Production Ensemble v5')`;
      } catch (dbErr) { console.warn('[Prediction Log Warning]:', dbErr); }
    }

    return NextResponse.json({ success: true, prediction: enrichedPrediction, confidence: ensemble.confidence, marketRegime: ensemble.marketRegime, anomalyScore: ensemble.anomalyScore, modelBreakdown: ensemble.modelBreakdown, multiModelEnsemble: ensemble });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Prediction failed' }, { status: 500 });
  }
}
