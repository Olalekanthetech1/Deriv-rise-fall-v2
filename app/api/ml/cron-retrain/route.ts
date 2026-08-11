import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { verifySessionToken } from '../../admin/auth/route';
import { listDurationTrainingDatasets } from '@/lib/training-dataset-builder-duration-v2';
import { enqueueTrainingJob, type TrainingQueueJob } from '@/lib/ml-training-queue';

function getRetrainIntervalMs(): number | null {
  const value = Number(process.env.ML_RETRAIN_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function isEligibleDataset(dataset: Record<string, any>): boolean {
  return dataset?.status === 'completed'
    && dataset?.leakage_check_passed === true
    && Number(dataset?.sample_count ?? 0) > 0
    && typeof dataset?.id === 'string'
    && dataset.id.trim().length > 0;
}

function pickNewestEligibleDataset(datasets: Array<Record<string, any>>): Record<string, any> | null {
  const eligible = datasets.filter(isEligibleDataset);
  eligible.sort((a, b) => new Date(String(b?.created_at ?? 0)).getTime() - new Date(String(a?.created_at ?? 0)).getTime());
  return eligible[0] ?? null;
}

async function resolveLiveSymbols(req: NextRequest, requestedSymbol: string): Promise<string[]> {
  if (requestedSymbol !== 'ALL_ASSETS') return [requestedSymbol];
  const response = await fetch(new URL('/api/symbols', req.url), { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.symbols)) {
    throw new Error(data?.error || 'Live Deriv symbol discovery is unavailable.');
  }
  const symbols = data.symbols
    .filter((item: unknown): item is { isOpen: boolean; symbol: string } => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return candidate.isOpen === true && typeof candidate.symbol === 'string' && candidate.symbol.trim().length > 0;
    })
    .map((item) => item.symbol.trim());
  if (!symbols.length) throw new Error('No open Deriv symbols are currently available for fleet retraining.');
  return Array.from(new Set(symbols));
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    const intervalMs = getRetrainIntervalMs();
    const isConnected = await initDbSchema();
    const sql = getDb();
    let lastTrainedAt: string | null = null;
    let timeSinceLastTrainMs: number | null = null;

    if (sql && isConnected) {
      const lastLog = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
      if (lastLog.length > 0) {
        lastTrainedAt = new Date(lastLog[0].trained_at).toISOString();
        timeSinceLastTrainMs = Math.max(0, Date.now() - new Date(lastLog[0].trained_at).getTime());
      } else {
        const lastModel = await sql`SELECT trained_at FROM ml_models ORDER BY trained_at DESC LIMIT 1`;
        if (lastModel.length > 0) {
          lastTrainedAt = new Date(lastModel[0].trained_at).toISOString();
          timeSinceLastTrainMs = Math.max(0, Date.now() - new Date(lastModel[0].trained_at).getTime());
        }
      }
    }

    const scheduleConfigured = intervalMs !== null;
    const isDue = scheduleConfigured && timeSinceLastTrainMs !== null ? timeSinceLastTrainMs >= intervalMs : null;
    const nextDueInMs = scheduleConfigured && timeSinceLastTrainMs !== null ? Math.max(0, intervalMs - timeSinceLastTrainMs) : null;

    return NextResponse.json({
      status: isConnected ? (scheduleConfigured ? 'active' : 'schedule_not_configured') : 'database_unavailable',
      scheduleConfigured,
      scheduleIntervalMs: intervalMs,
      scheduleIntervalHours: intervalMs !== null ? intervalMs / 3_600_000 : null,
      lastTrainedAt,
      timeSinceLastTrainMinutes: timeSinceLastTrainMs !== null ? Math.floor(timeSinceLastTrainMs / 60000) : null,
      isDue,
      nextScheduledRunInMinutes: nextDueInMs !== null ? Math.ceil(nextDueInMs / 60000) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron status check failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    const isConnected = await initDbSchema();
    if (!isConnected) return NextResponse.json({ success: false, error: 'Database unavailable; retraining requires persisted real tick data.' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const force = body.force === true;
    if (!symbol) return NextResponse.json({ success: false, error: 'A live symbol or ALL_ASSETS is required.' }, { status: 400 });

    const intervalMs = getRetrainIntervalMs();
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

    let shouldRetrain = force;
    let lastTrainedAt: Date | null = null;
    if (!force) {
      if (intervalMs === null) return NextResponse.json({ success: false, error: 'ML_RETRAIN_INTERVAL_MS is not configured.' }, { status: 503 });
      const lastLog = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
      if (lastLog.length > 0) {
        lastTrainedAt = new Date(lastLog[0].trained_at);
        shouldRetrain = Date.now() - lastTrainedAt.getTime() >= intervalMs;
      } else {
        shouldRetrain = true;
      }
    }

    if (!shouldRetrain) {
      return NextResponse.json({
        success: true,
        retrained: false,
        reason: 'The configured retraining interval has not elapsed since the last training cycle.',
        lastTrainedAt: lastTrainedAt?.toISOString() || null,
      });
    }

    const symbols = await resolveLiveSymbols(req, symbol);
    const results: Array<Record<string, unknown>> = [];

    for (const sym of symbols) {
      const datasets = await listDurationTrainingDatasets(sym);
      const dataset = pickNewestEligibleDataset(datasets as Array<Record<string, any>>);
      if (!dataset) {
        results.push({ symbol: sym, queued: false, reason: 'NO_ELIGIBLE_DATASET' });
        continue;
      }

      try {
        const queueJob: TrainingQueueJob = await enqueueTrainingJob({
          datasetId: String(dataset.id),
          modelTypes: ['XGBoost'],
        });
        results.push({
          symbol: sym,
          queued: true,
          jobId: queueJob.jobId,
          datasetId: queueJob.datasetId,
          status: queueJob.status,
        });
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ symbol: sym, queued: false, reason: message });
      }
    }

    const queued = results.filter((item) => item.queued === true);
    const skipped = results.filter((item) => item.queued !== true);
    const nextScheduledRun = intervalMs !== null ? new Date(Date.now() + intervalMs).toISOString() : null;

    return NextResponse.json({
      success: queued.length > 0,
      retrained: false,
      dispatched: queued.length > 0,
      mode: symbols.length > 1 ? 'ALL_ASSETS_FLEET' : 'SINGLE_ASSET',
      fleetQueuedCount: queued.length,
      fleetSkippedCount: skipped.length,
      symbol: symbols.length > 1 ? 'ALL_ASSETS' : symbol,
      results,
      trainedAt: null,
      nextScheduledRun,
      message: queued.length > 0
        ? `Dispatched ${queued.length} asset retraining job(s) to the durable ML queue; the worker owns execution and completion.`
        : 'No eligible persisted datasets were available for retraining.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron retraining dispatch failed' }, { status: 500 });
  }
}
