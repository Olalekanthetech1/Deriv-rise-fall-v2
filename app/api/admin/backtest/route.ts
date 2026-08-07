import { NextRequest, NextResponse } from 'next/server';
import { xgboostModel } from '@/lib/xgboost-engine';
import { initDbSchema, getTicksHistory } from '@/lib/db';

export async function POST(req: NextRequest) {
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

    let ticks = await getTicksHistory(symbol, 400);

    if (ticks.length < 60) {
      const now = Date.now();
      let price = symbol === 'FRXEURUSD' ? 1.085 : 1000.0;
      ticks = [];
      for (let i = 0; i < 250; i++) {
        price += (Math.random() - 0.485) * (symbol === 'FRXEURUSD' ? 0.0003 : 0.35);
        ticks.push({ price: parseFloat(price.toFixed(4)), timestamp: now - (250 - i) * 1000 });
      }
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
