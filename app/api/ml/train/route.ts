import { NextRequest, NextResponse } from 'next/server';
import { TrainSchema } from '@/lib/validation-schemas';
import { getDb, registerModelInDb } from '@/lib/db';
import { ensureMinTicks } from '@/lib/ticks-helper';
import { initializeMlPipelineConfig } from '@/lib/ml-pipeline-config';
import { getMlRuntimeSchemaContract } from '@/lib/ml-runtime-schema';
import { buildSequenceFeatureDataset, buildTabularFeatureDataset } from '@/lib/ml-feature-dataset';
import { getMlModelKeys, getSequenceModelKeys } from '@/lib/ml-model-registry';
import { verifySessionToken } from '../../admin/auth/route';

const CATEGORY_MAP: Record<string, string[]> = {
  synthetic: ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', '1HZ50V', 'R_25', '1HZ25V', 'R_10', '1HZ10V'],
  jump: ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'],
  forex: ['FRXEURUSD', 'FRXGBPUSD', 'FRXUSDJPY', 'FRXAUDUSD', 'FRXUSDCAD'],
  commodities: ['CWMXAUUSD'],
};
CATEGORY_MAP.ALL = Object.values(CATEGORY_MAP).flat();

function isAdmin(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    const parsed = TrainSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid training parameters', details: parsed.error.format() }, { status: 400 });

    const { symbol, category, retrainAll, modelType, durationSecs, maxDepth, learningRate, numEstimators, subsample, epochs, batchSize } = parsed.data;
    await initializeMlPipelineConfig();
    const schema = await getMlRuntimeSchemaContract();
    const requiredContextTicks = Math.max(schema.canonicalFeatureWindowTicks, schema.sequenceLength);
    const minimumTrainingTicks = requiredContextTicks + Math.max(1, durationSecs);
    const symbols = category && CATEGORY_MAP[category] ? CATEGORY_MAP[category] : (retrainAll || symbol === 'ALL') ? CATEGORY_MAP.ALL : [symbol];
    const models = modelType === 'all' || retrainAll ? getMlModelKeys() : [modelType];
    const sequenceModels = new Set(getSequenceModelKeys());
    const daemon = (await import('@/lib/xgboost-daemon')).xgboostDaemon;
    const sql = getDb();
    const results: any[] = [];

    for (const sym of symbols) {
      const ticks = await ensureMinTicks(sym, minimumTrainingTicks);
      if (!ticks || ticks.length < minimumTrainingTicks) {
        for (const model of models) results.push({ symbol: sym, modelType: model, success: false, error: 'INSUFFICIENT_REAL_TICKS', requiredTicks: minimumTrainingTicks, availableTicks: ticks?.length ?? 0 });
        continue;
      }

      const assetCategory = category === 'forex' ? 1 : category === 'commodities' ? 2 : 0;
      const context = { symbol: sym, durationSecs, assetCategory };
      let tabularDataset: Awaited<ReturnType<typeof buildTabularFeatureDataset>> | null = null;
      let sequenceDataset: Awaited<ReturnType<typeof buildSequenceFeatureDataset>> | null = null;

      for (const model of models) {
        if (sequenceModels.has(model)) {
          sequenceDataset ??= await buildSequenceFeatureDataset(ticks, context);
        } else {
          tabularDataset ??= await buildTabularFeatureDataset(ticks, context);
        }

        const result = await daemon.sendCommand('train', {
          symbol: sym,
          durationSecs,
          modelType: model,
          assetCategory,
          featureDataset: tabularDataset,
          sequenceDataset,
          hyperparams: { maxDepth, learningRate, numEstimators, subsample, epochs, batchSize },
        });

        if (!result?.success) {
          results.push({ symbol: sym, modelType: model, success: false, error: result?.error || 'Training failed', schemaVersion: result?.schemaVersion, schemaFingerprint: result?.schemaFingerprint });
          continue;
        }

        results.push({ symbol: sym, modelType: model, ...result });

        if (sql) {
          try {
            await registerModelInDb({
              modelId: result.modelId,
              modelName: `${sym} ${model} Production Model`,
              version: result.modelVersion || result.schemaVersion || 'native-runtime',
              symbol: sym,
              horizonSecs: durationSecs,
              format: result.format || (sequenceModels.has(model) ? 'PT_STATE' : 'PKL'),
              status: 'production',
              accuracy: Number.isFinite(Number(result.accuracy)) ? Number(result.accuracy) : undefined,
              backtestWinRate: undefined,
              backtestProfitFactor: undefined,
              filePath: `${sym}_${durationSecs}s_${model}.pkl`,
              hyperparameters: { maxDepth, learningRate, numEstimators, subsample, epochs, batchSize },
              metrics: {
                schemaFingerprint: result.schemaFingerprint || schema.schemaFingerprint,
                featureSchemaVersion: result.schemaVersion || schema.featureSchemaVersion,
                featureCount: result.featureCount || schema.featureCount,
                sequenceLength: result.sequenceLength || schema.sequenceLength,
              },
            });
          } catch (dbErr) {
            console.warn('[ML Registry Warning]:', dbErr);
          }
        }
      }
    }

    const successes = results.filter((result) => result.success).length;
    return NextResponse.json({
      success: successes > 0,
      symbol: symbols.length === 1 ? symbols[0] : `GROUP (${symbols.length})`,
      modelTypes: models,
      trainedCount: successes,
      totalJobs: results.length,
      requiredTrainingTicks: minimumTrainingTicks,
      schemaVersion: schema.featureSchemaVersion,
      schemaFingerprint: schema.schemaFingerprint,
      featureCount: schema.featureCount,
      results,
      trainedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Training failed' }, { status: 500 });
  }
}
