import { NextRequest, NextResponse } from 'next/server';
import { PredictSchema } from '@/lib/validation-schemas';
import { xgboostModel } from '@/lib/xgboost-engine';
import { initDbSchema, getTicksHistory, getDb } from '@/lib/db';

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

    // If no client ticks passed, query latest ticks from Neon PostgreSQL database
    if (tickList.length < 5) {
      const dbTicks = await getTicksHistory(symbol, 100);
      if (dbTicks.length > 0) {
        tickList = dbTicks;
      }
    }

    if (tickList.length < 5) {
      throw new Error(`Insufficient ticks to generate prediction for ${symbol}. Need at least 5.`);
    }

    const prediction = await xgboostModel.predictRemote(tickList, {
      symbol,
      durationSecs,
      assetCategory,
    });

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
      prediction,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Prediction failed' }, { status: 500 });
  }
}
