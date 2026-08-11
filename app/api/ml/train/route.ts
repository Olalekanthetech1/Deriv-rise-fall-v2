import { NextRequest, NextResponse } from 'next/server';
import { TrainSchema } from '@/lib/validation-schemas';
import { getDb } from '@/lib/db';
import { initializeMlPipelineConfig } from '@/lib/ml-pipeline-config';
import { getMlModelKeys, type MlModelKey } from '@/lib/ml-model-registry';
import { enqueueTrainingJob, type TrainingQueueJob } from '@/lib/ml-training-queue';
import { verifySessionToken } from '../../admin/auth/route';

const CATEGORY_MAP: Record<string, string[]> = {
  synthetic: ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', '1HZ50V', 'R_25', '1HZ25V', 'R_10', '1HZ10V'],
  jump: ['JD10', 'JD25', 'JD50', 'JD75', 'JD100'],
  forex: ['FRXEURUSD', 'FRXGBPUSD', 'FRXUSDJPY', 'FRXAUDUSD', 'FRXUSDCAD'],
  commodities: ['CWMXAUUSD'],
};
CATEGORY_MAP.ALL = [...new Set(Object.values(CATEGORY_MAP).flat())];

function isAdmin(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

async function findEligibleDatasetId(sql: ReturnType<typeof getDb>, symbol: string, horizonTicks: number): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql`
    SELECT id::text AS id
    FROM training_datasets
    WHERE asset_symbol = ${symbol}
      AND horizon_ticks = ${horizonTicks}::integer
      AND status = 'completed'
      AND leakage_check_passed = TRUE
      AND sample_count > 0
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows.length ? String(rows[0].id) : null;
}

function modelTypesFromRequest(modelType: MlModelKey | 'all', retrainAll: boolean): string[] {
  return modelType === 'all' || retrainAll ? getMlModelKeys() : [modelType];
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    const parsed = TrainSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid training parameters', details: parsed.error.format() }, { status: 400 });
    }

    const {
      symbol,
      category,
      retrainAll,
      modelType,
      durationSecs,
    } = parsed.data;

    await initializeMlPipelineConfig();
    const sql = getDb();
    if (!sql) return NextResponse.json({ error: 'DATABASE_UNAVAILABLE' }, { status: 503 });

    const symbols = category && CATEGORY_MAP[category]
      ? CATEGORY_MAP[category]
      : (retrainAll || symbol === 'ALL')
        ? CATEGORY_MAP.ALL
        : [symbol];
    const requestedModelTypes = modelTypesFromRequest(modelType, retrainAll) as string[];
    const queued: TrainingQueueJob[] = [];
    const skipped: Array<{ symbol: string; error: string }> = [];

    for (const rawSymbol of symbols) {
      const normalized = normalizeSymbol(rawSymbol);
      const datasetId = await findEligibleDatasetId(sql, normalized, durationSecs);
      if (!datasetId) {
        skipped.push({
          symbol: normalized,
          error: `NO_ELIGIBLE_DATASET: no completed leakage-validated dataset exists for ${normalized} at ${durationSecs} ticks. Build/select a dataset first.`,
        });
        continue;
      }

      try {
        const job = await enqueueTrainingJob({
          datasetId,
          modelTypes: requestedModelTypes,
        });
        queued.push(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ symbol: normalized, error: message });
      }
    }

    const success = queued.length > 0;
    return NextResponse.json({
      success,
      queued: success,
      executionBoundary: 'dedicated-ml-worker',
      dataSource: 'persisted-real-tick-dataset',
      queuedCount: queued.length,
      skippedCount: skipped.length,
      totalJobs: queued.length,
      modelTypes: requestedModelTypes,
      durationSecs,
      jobs: queued,
      skipped,
      message: success
        ? `Training queued for ${queued.length} eligible dataset(s). Execution is handled by the dedicated ML worker.`
        : 'No eligible datasets were found for the requested training operation.',
      trainedAt: null,
    }, { status: success ? 202 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Training could not be queued.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
