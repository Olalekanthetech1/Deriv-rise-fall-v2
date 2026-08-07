import { NextRequest, NextResponse } from 'next/server';
import { PredictSchema } from '@/lib/validation-schemas';
import { xgboostModel } from '@/lib/xgboost-engine';
import { initDbSchema, getDb } from '@/lib/db';
import { ensureMinTicks } from '@/lib/ticks-helper';

export async function POST(req: NextRequest) {
  try {
    await initDbSchema();
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = PredictSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input parameters', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { symbol, ticks, durationSecs, assetCategory } = parseResult.data;

    let tickList = Array.isArray(ticks) && ticks.length > 0 ? ticks : [];

    // If no client ticks passed, query latest ticks or fetch directly from Deriv WS
    if (tickList.length < 5) {
      tickList = await ensureMinTicks(symbol, 100);
    }

    if (tickList.length < 5) {
      throw new Error(`Insufficient ticks to generate prediction for ${symbol}. Need at least 5.`);
    }

    const startTime = Date.now();
    const prediction = await xgboostModel.predictRemote(tickList, {
      symbol,
      durationSecs,
      assetCategory,
    });
    const latencyMs = Math.max(1, Date.now() - startTime);

    const feat = prediction.features || {};
    const microVelocity = feat.micro_velocity ?? 0;
    const shortVol = feat.short_volatility ?? 0.01;
    const noiseScore = Math.min(100, Math.max(0, Math.round((shortVol / (Math.abs(microVelocity) + 0.0001)) * 12)));
    const marketRegime = noiseScore > 65 ? 'High Chop / Erratic Noise' : noiseScore < 35 ? 'Low Noise / High Trend' : 'Moderate Market Oscillation';

    const enrichedPrediction = {
      ...prediction,
      latencyMs,
      ticksProcessed: tickList.length,
      marketNoiseScore: noiseScore,
      marketRegime,
      microVelocity,
      tickFrequency: feat.ticksPerSecond ?? 1.0,
      volatilityRank: feat.macro_volatility ?? 0.05,
    };

    // Optionally record prediction log into Neon Postgres
    const sql = getDb();
    if (sql) {
      try {
        await sql`
          INSERT INTO trades (symbol, contract_type, stake, status, prediction_confidence, strategy)
          VALUES (${symbol}, ${prediction.signal}, 10, 'PREDICTED', ${prediction.confidence}, 'XGBoost v3.4')
        `;
      } catch (dbErr) {
        console.warn('[Trade Log Save Warning]:', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      prediction: enrichedPrediction,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Prediction failed' }, { status: 500 });
  }
}
