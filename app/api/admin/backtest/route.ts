import { NextRequest, NextResponse } from 'next/server';
import { xgboostModel } from '@/lib/xgboost-engine';
import { initDbSchema, getTicksHistory } from '@/lib/db';
import { verifySessionToken } from '../auth/route';

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace('Bearer ', '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    await initDbSchema();
    const body = await req.json().catch(() => ({}));
    const {
      symbol = 'R_100',
      minConfidence = 78.0,
      stake = 10,
      payoutRate = 0.95,
      maxDepth,
      learningRate,
      numEstimators,
      subsample,
    } = body;

    if (maxDepth || learningRate || numEstimators || subsample) {
      xgboostModel.setHyperparameters({
        ...(maxDepth ? { maxDepth: Number(maxDepth) } : {}),
        ...(learningRate ? { learningRate: Number(learningRate) } : {}),
        ...(numEstimators ? { numEstimators: Number(numEstimators) } : {}),
        ...(subsample ? { subsample: Number(subsample) } : {}),
      });
    }

    const { ensureMinTicks } = await import('@/lib/ticks-helper');
    let ticks = await getTicksHistory(symbol, 1000);

    if (ticks.length < 100) {
      ticks = await ensureMinTicks(symbol, 1000);
    }

    const backtestData = xgboostModel.backtest(ticks, {
      minConfidence: Number(minConfidence),
      stake: Number(stake),
      payoutRate: Number(payoutRate),
      symbol,
    });

    return NextResponse.json({
      success: true,
      ...backtestData,
      hyperparameters: xgboostModel.getHyperparameters(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Backtest evaluation failed' }, { status: 500 });
  }
}
