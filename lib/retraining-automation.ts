import { initDbSchema, getDb } from '@/lib/db';
import { listDurationTrainingDatasets } from '@/lib/training-dataset-builder-duration-v2';
import { enqueueTrainingJob, type TrainingQueueJob } from '@/lib/ml-training-queue';

export type RetrainingStatus = {
  status: 'active' | 'schedule_not_configured' | 'database_unavailable';
  scheduleConfigured: boolean;
  scheduleIntervalMs: number | null;
  scheduleIntervalHours: number | null;
  lastTrainingAt: string | null;
  timeSinceLastTrainingMinutes: number | null;
  due: boolean | null;
  nextRunInMinutes: number | null;
};

export type RetrainingDispatchResult = {
  symbol: string;
  queued: boolean;
  jobId?: string;
  datasetId?: string;
  status?: string;
  reason?: string;
};

function getRetrainIntervalMs(): number | null {
  const value = Number(process.env.ML_RETRAIN_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isEligibleDataset(dataset: Record<string, unknown>): boolean {
  return dataset.status === 'completed'
    && dataset.leakage_check_passed === true
    && Number(dataset.sample_count ?? 0) > 0
    && typeof dataset.id === 'string'
    && dataset.id.trim().length > 0;
}

function pickNewestEligibleDataset(datasets: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return datasets
    .filter(isEligibleDataset)
    .sort((a, b) => new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime())[0] ?? null;
}

async function resolveLastTrainingAt() {
  const isConnected = await initDbSchema();
  const sql = getDb();
  if (!isConnected || !sql) return { isConnected: false, lastTrainingAt: null as Date | null };

  const rows = await sql`SELECT MAX(completed_at) AS trained_at FROM ml_training_runs WHERE completed_at IS NOT NULL`;
  const trainedAt = rows[0]?.trained_at ? new Date(rows[0].trained_at) : null;
  return { isConnected: true, lastTrainingAt: trainedAt && !Number.isNaN(trainedAt.getTime()) ? trainedAt : null };
}

export async function getRetrainingStatus(): Promise<RetrainingStatus> {
  const intervalMs = getRetrainIntervalMs();
  const { isConnected, lastTrainingAt } = await resolveLastTrainingAt();
  const configured = intervalMs !== null;
  const elapsedMs = lastTrainingAt ? Math.max(0, Date.now() - lastTrainingAt.getTime()) : null;
  const due = configured && elapsedMs !== null ? elapsedMs >= intervalMs! : configured && lastTrainingAt === null ? true : null;
  const nextMs = configured && elapsedMs !== null ? Math.max(0, intervalMs! - elapsedMs) : null;

  return {
    status: !isConnected ? 'database_unavailable' : configured ? 'active' : 'schedule_not_configured',
    scheduleConfigured: configured,
    scheduleIntervalMs: intervalMs,
    scheduleIntervalHours: intervalMs !== null ? intervalMs / 3_600_000 : null,
    lastTrainingAt: lastTrainingAt?.toISOString() ?? null,
    timeSinceLastTrainingMinutes: elapsedMs === null ? null : Math.floor(elapsedMs / 60_000),
    due,
    nextRunInMinutes: nextMs === null ? null : Math.ceil(nextMs / 60_000),
  };
}

async function resolveLiveSymbols(request: Request, requestedSymbol: string): Promise<string[]> {
  if (requestedSymbol !== 'ALL_ASSETS') return [requestedSymbol];
  const response = await fetch(new URL('/api/symbols', request.url), { cache: 'no-store' });
  const data = await response.json().catch(() => null) as { symbols?: Array<{ isOpen?: boolean; symbol?: string }>; error?: string } | null;
  if (!response.ok || !Array.isArray(data?.symbols)) throw new Error(data?.error || 'Live Deriv symbol discovery is unavailable.');
  const symbols = data.symbols.filter((item) => item.isOpen === true && typeof item.symbol === 'string' && item.symbol.trim()).map((item) => item.symbol!.trim());
  if (!symbols.length) throw new Error('No open Deriv symbols are currently available for fleet retraining.');
  return Array.from(new Set(symbols));
}

export async function dispatchRetraining(request: Request, requestedSymbol: string, force: boolean): Promise<{ dispatched: boolean; mode: 'SINGLE_ASSET' | 'ALL_ASSETS_FLEET'; results: RetrainingDispatchResult[] }> {
  const isConnected = await initDbSchema();
  if (!isConnected) throw new Error('DATABASE_UNAVAILABLE');

  const intervalMs = getRetrainIntervalMs();
  if (!force && intervalMs === null) throw new Error('ML_RETRAIN_INTERVAL_MS is not configured.');

  if (!force) {
    const status = await getRetrainingStatus();
    if (!status.due) return { dispatched: false, mode: 'SINGLE_ASSET', results: [{ symbol: requestedSymbol, queued: false, reason: 'RETRAINING_NOT_DUE' }] };
  }

  const symbols = await resolveLiveSymbols(request, requestedSymbol);
  const results: RetrainingDispatchResult[] = [];

  for (const symbol of symbols) {
    const datasets = await listDurationTrainingDatasets(symbol);
    const dataset = pickNewestEligibleDataset(datasets as Array<Record<string, unknown>>);
    if (!dataset) {
      results.push({ symbol, queued: false, reason: 'NO_ELIGIBLE_DATASET' });
      continue;
    }

    try {
      const queued: TrainingQueueJob = await enqueueTrainingJob({ datasetId: String(dataset.id), modelTypes: ['XGBoost'] });
      results.push({ symbol, queued: true, jobId: queued.jobId, datasetId: queued.datasetId, status: queued.status });
    } catch (error) {
      results.push({ symbol, queued: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    dispatched: results.some((result) => result.queued),
    mode: symbols.length > 1 ? 'ALL_ASSETS_FLEET' : 'SINGLE_ASSET',
    results,
  };
}
