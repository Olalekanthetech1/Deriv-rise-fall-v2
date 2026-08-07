import { NextRequest, NextResponse } from 'next/server';
import { TrainSchema } from '@/lib/validation-schemas';
import { getDb, registerModelInDb } from '@/lib/db';
import { ensureMinTicks } from '@/lib/ticks-helper';

const CATEGORY_MAP: Record<string, string[]> = {
  synthetic: ['R_100','1HZ100V','R_75','1HZ75V','R_50','1HZ50V','R_25','1HZ25V','R_10','1HZ10V'],
  jump: ['JD10','JD25','JD50','JD75','JD100'],
  forex: ['FRXEURUSD','FRXGBPUSD','FRXUSDJPY','FRXAUDUSD','FRXUSDCAD'],
  commodities: ['CWMXAUUSD'],
};
CATEGORY_MAP.ALL = Object.values(CATEGORY_MAP).flat();
const MODEL_TYPES = ['xgboost','lightgbm','catboost','tcn','lstm','transformer','hmm','isolation_forest'];

export async function POST(req: NextRequest) {
  try {
    const parsed = TrainSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid training parameters', details: parsed.error.format() }, { status: 400 });
    const { symbol, category, retrainAll, modelType, durationSecs, maxDepth, learningRate, numEstimators, subsample, epochs, batchSize } = parsed.data;
    const symbols = category && CATEGORY_MAP[category] ? CATEGORY_MAP[category] : (retrainAll || symbol === 'ALL') ? CATEGORY_MAP.ALL : [symbol];
    const models = modelType === 'all' || retrainAll ? MODEL_TYPES : [modelType];
    const daemon = (await import('@/lib/xgboost-daemon')).xgboostDaemon;
    const sql = getDb();
    const results: any[] = [];

    for (const sym of symbols) {
      const ticks = await ensureMinTicks(sym, 500);
      for (const model of models) {
        const result = await daemon.sendCommand('train', {
          symbol: sym, ticks, durationSecs, modelType: model, assetCategory: category === 'forex' ? 1 : category === 'commodities' ? 2 : 0,
          hyperparams: { maxDepth, learningRate, numEstimators, subsample, epochs, batchSize },
        });
        if (!result?.success) {
          results.push({ symbol: sym, modelType: model, success: false, error: result?.error || 'Training failed' });
          continue;
        }
        results.push({ symbol: sym, modelType: model, ...result });
        if (sql) {
          try {
            await registerModelInDb({
              modelId: result.modelId,
              modelName: `${sym} ${model} Production Model`,
              version: 'v5.0.0', symbol: sym, horizonSecs: durationSecs,
              format: result.format || (model === 'tcn' || model === 'lstm' || model === 'transformer' ? 'PT_STATE' : 'PKL'),
              status: 'production', accuracy: Number(result.accuracy) || 0,
              backtestWinRate: 0, backtestProfitFactor: 0,
              filePath: `${sym}_${durationSecs}s_${model}.pkl`,
              hyperparameters: { maxDepth, learningRate, numEstimators, subsample, epochs, batchSize },
            });
          } catch (dbErr) { console.warn('[ML Registry Warning]:', dbErr); }
        }
      }
    }

    const successes = results.filter(r => r.success).length;
    return NextResponse.json({ success: successes > 0, symbol: symbols.length === 1 ? symbols[0] : `GROUP (${symbols.length})`, modelTypes: models, trainedCount: successes, totalJobs: results.length, results, trainedAt: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Training failed' }, { status: 500 });
  }
}
