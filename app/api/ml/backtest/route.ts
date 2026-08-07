import { NextRequest, NextResponse } from 'next/server';
import { BacktestSchema } from '@/lib/validation-schemas';
import { getTicksHistory, initDbSchema, saveBacktestResults } from '@/lib/db';
import { xgboostDaemon } from '@/lib/xgboost-daemon';

export async function POST(req: NextRequest) {
  try {
    await initDbSchema();
    const rawBody = await req.json().catch(() => ({}));
    const parseResult = BacktestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input parameters', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { symbol, horizons, sampleLimit } = parseResult.data;

    const ticks = await getTicksHistory(symbol, sampleLimit);

    if (!ticks || ticks.length < 50) {
      throw new Error(`Insufficient historical ticks for backtesting ${symbol}. Minimum 50 required.`);
    }

    const backtestRes = await xgboostDaemon.sendCommand('backtest', {
      symbol,
      ticks,
      horizons,
    });

    if (!backtestRes || !backtestRes.success) {
      throw new Error(`Python backtest daemon failed: ${backtestRes?.error || 'Unknown Error'}`);
    }

    if (backtestRes.horizonMatrix) {
      for (const [hz, hzData] of Object.entries(backtestRes.horizonMatrix)) {
        const hData: any = hzData;
        await saveBacktestResults({
          symbol,
          durationSec: hData.horizonSecs,
          totalTrades: hData.trades,
          winningTrades: hData.wins,
          profitFactor: hData.profitFactor,
        });
      }
    }

    return NextResponse.json(backtestRes);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Backtest failed' }, { status: 500 });
  }
}

