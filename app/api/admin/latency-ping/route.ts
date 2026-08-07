import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { extract37TickFeatures } from '@/lib/ml-feature-extractor';

export async function POST(req: NextRequest) {
  // Session token verification
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace('Bearer ', '');
  const isAuth = verifySessionToken(cookieToken) || verifySessionToken(headerToken);

  if (!isAuth) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const startTotal = process.hrtime.bigint();

  try {
    const body = await req.json().catch(() => ({}));
    const symbol = body.symbol || 'R_100';

    // 1. Measure Feature Extraction Latency
    const startFeat = process.hrtime.bigint();

    // Get real tick sequence from database / tick engine
    const { getTicksHistory, initDbSchema } = await import('@/lib/db');
    await initDbSchema();
    let ticks = await getTicksHistory(symbol, 50);

    if (!ticks || ticks.length < 5) {
      const { generateSyntheticTicks } = await import('@/lib/ticks-helper');
      ticks = generateSyntheticTicks(symbol, 50);
    }

    const featureObj = extract37TickFeatures(ticks, { symbol });
    const features = Object.values(featureObj);
    const endFeat = process.hrtime.bigint();
    const featureExtractTimeMs = Number(endFeat - startFeat) / 1_000_000;

    // 2. Measure Model Inference Overhead using actual XGBoost ML Engine
    const startInference = process.hrtime.bigint();
    const { xgboostModel } = await import('@/lib/xgboost-engine');
    const prediction = xgboostModel.predict(ticks, { symbol });
    const endInference = process.hrtime.bigint();
    const modelInferenceTimeMs = Number(endInference - startInference) / 1_000_000;

    const endTotal = process.hrtime.bigint();
    const serverExecutionTimeMs = Number(endTotal - startTotal) / 1_000_000;

    // Diagnostics diagnosis
    let diagnosisStatus: 'optimal' | 'warning' | 'critical' = 'optimal';
    let diagnosisMessage = 'Candidate model inference operating at optimal high-frequency speed (<15ms).';

    if (serverExecutionTimeMs > 50) {
      diagnosisStatus = 'critical';
      diagnosisMessage = `Candidate ${symbol} model execution delay detected (${serverExecutionTimeMs.toFixed(2)}ms > 50ms threshold). Recommend feature cache pre-loading.`;
    } else if (serverExecutionTimeMs > 15) {
      diagnosisStatus = 'warning';
      diagnosisMessage = `Elevated feature calculation time (${serverExecutionTimeMs.toFixed(2)}ms). Non-blocking background worker active.`;
    }

    return NextResponse.json({
      success: true,
      symbol,
      serverExecutionTimeMs: Number(serverExecutionTimeMs.toFixed(3)),
      featureExtractTimeMs: Number(featureExtractTimeMs.toFixed(3)),
      modelInferenceTimeMs: Number(modelInferenceTimeMs.toFixed(3)),
      featureCount: features.length,
      candidateModel: `XGBoost-${symbol}-v4.2-ONNX`,
      diagnosisStatus,
      diagnosisMessage,
      timestamp: new Date().toISOString(),
      timeEpoch: Date.now(),
    });
  } catch (err: any) {
    const endTotal = process.hrtime.bigint();
    const serverExecutionTimeMs = Number(endTotal - startTotal) / 1_000_000;

    return NextResponse.json({
      success: false,
      error: err.message || 'Latency diagnostic calculation failed',
      serverExecutionTimeMs: Number(serverExecutionTimeMs.toFixed(3)),
    }, { status: 500 });
  }
}
