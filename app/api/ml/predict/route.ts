import { NextRequest, NextResponse } from 'next/server';
import { PredictSchema } from '@/lib/validation-schemas';
import { evaluateProductionEnsemble } from '@/lib/production-ensemble';
import { ensureMinTicks } from '@/lib/ticks-helper';

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = PredictSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json({ success: false, error: 'Invalid input parameters', details: parseResult.error.format() }, { status: 400 });
    }

    const { symbol, ticks, durationSecs, assetCategory } = parseResult.data;
    let tickList = Array.isArray(ticks) && ticks.length > 0 ? ticks : [];
    if (tickList.length < 5) tickList = await ensureMinTicks(symbol, 100);
    if (tickList.length < 5) return NextResponse.json({ success: false, error: `Insufficient ticks for ${symbol}.` }, { status: 422 });

    const startTime = Date.now();
    const ensemble = await evaluateProductionEnsemble(tickList, { symbol, durationSecs, assetCategory });
    const feat = ensemble.features;
    const microVelocity = Number.isFinite(Number(feat.micro_velocity)) ? Number(feat.micro_velocity) : null;
    const shortVol = Number.isFinite(Number(feat.short_volatility)) ? Number(feat.short_volatility) : null;
    const noiseScore = microVelocity !== null && shortVol !== null && Number.isFinite(shortVol / (Math.abs(microVelocity) + 0.0001))
      ? Math.min(100, Math.max(0, Math.round((shortVol / (Math.abs(microVelocity) + 0.0001)) * 12)))
      : null;

    const prediction = {
      signal: ensemble.direction === 'RISE' ? ('CALL' as const) : ('PUT' as const),
      confidence: ensemble.confidence,
      rawScore: Number(((ensemble.probUp - ensemble.probDown) / 100).toFixed(4)),
      features: feat,
      symbol,
      timestamp: Date.now(),
      modelVersion: 'production-ensemble',
    };

    const enrichedPrediction = {
      ...prediction,
      signal: ensemble.direction === 'RISE' ? 'CALL' : 'PUT',
      confidence: ensemble.confidence,
      probabilityUp: ensemble.probUp,
      probabilityDown: ensemble.probDown,
      ensemble,
      latencyMs: Date.now() - startTime,
      ticksProcessed: tickList.length,
      marketNoiseScore: noiseScore,
      marketRegime: ensemble.marketRegime,
      microVelocity,
      tickFrequency: Number.isFinite(Number(feat.ticks_per_second)) ? Number(feat.ticks_per_second) : null,
      volatilityRank: Number.isFinite(Number(feat.macro_volatility)) ? Number(feat.macro_volatility) : null,
    };

    return NextResponse.json({
      success: true,
      prediction: enrichedPrediction,
      confidence: ensemble.confidence,
      marketRegime: ensemble.marketRegime,
      anomalyScore: ensemble.anomalyScore,
      modelBreakdown: ensemble.modelBreakdown,
      multiModelEnsemble: ensemble,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    console.error('[ML Predict Route Error]:', err);
    return NextResponse.json({ success: false, error: err?.message || 'Prediction failed' }, { status: 500 });
  }
}
