import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { getMlModelKeys, type MlModelKey } from '@/lib/ml-model-registry';
import { enqueueTrainingJob, type TrainingQueueJob } from '@/lib/ml-training-queue';
import { verifySessionToken } from '../../admin/auth/route';

function getRetrainIntervalMs(): number | null {
  const value = Number(process.env.ML_RETRAIN_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

type LiveSymbolRecord = {
  isOpen?: unknown;
  symbol?: unknown;
};

function isLiveSymbolRecord(value: unknown): value is LiveSymbolRecord {
  return typeof value === 'object' && value !== null;
}

async function resolveLiveSymbols(req: NextRequest, requestedSymbol: string): Promise<string[]> {
  if (requestedSymbol !== 'ALL_ASSETS') return [normalizeSymbol(requestedSymbol)];
  const response = await fetch(new URL('/api/symbols', req.url), { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.symbols)) {
    throw new Error(data?.error || 'Live Deriv symbol discovery is unavailable.');
  }

  const symbols: string[] = Array.from(new Set(
    data.symbols
      .filter(isLiveSymbolRecord)
      .filter((item): item is LiveSymbolRecord & { isOpen: true; symbol: string } => item.isOpen === true && typeof item.symbol === 'string' && item.symbol.trim().length > 0)
      .map((item) => normalizeSymbol(item.symbol)),
  ));

  if (!symbols.length) throw new Error('No open Deriv symbols are currently available for fleet retraining.');
  return symbols;
}

async function findLatestEligibleDataset(sql: ReturnType<typeof getDb>, symbol: string): Promise<{ id: string; horizonTicks: number } | null> {
  if (!sql) return null;
  const rows = await sql`
    SELECT id::text AS id, horizon_ticks::int AS horizon_ticks
    FROM training_datasets
    WHERE asset_symbol = ${symbol}
      AND status = 'completed'
      AND leakage_check_passed = TRUE
      AND sample_count > 0
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  return { id: String(rows[0].id), horizonTicks: Number(rows[0].horizon_ticks) };
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
      if (lastLog.length) {
        lastTrainedAt = new Date(lastLog[0].trained_at).toISOString();
        timeSinceLastTrainMs = Math.max(0, Date.now() - new Date(lastLog[0].trained_at).getTime());
      } else {
        const lastModel = await sql`SELECT trained_at FROM ml_models ORDER BY trained_at DESC LIMIT 1`;
        if (lastModel.length) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cron status check failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  try {
    const isConnected = await initDbSchema();
    if (!isConnected) return NextResponse.json({ success: false, error: 'DATABASE_UNAVAILABLE' }, { status: 503 });
    const body = await req.json().catch(() => ({}));
    const requestedSymbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    const force = body?.force === true;
    if (!requestedSymbol) return NextResponse.json({ success: false, error: 'A live symbol or ALL_ASSETS is required.' }, { status: 400 });

    const intervalMs = getRetrainIntervalMs();
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'DATABASE_UNAVAILABLE' }, { status: 503 });

    let shouldRetrain = force;
    let lastTrainedAt: Date | null = null;
    if (!force) {
      if (intervalMs === null) return NextResponse.json({ success: false, error: 'ML_RETRAIN_INTERVAL_MS is not configured.' }, { status: 503 });
      const lastLog = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
      if (lastLog.length) {
        lastTrainedAt = new Date(lastLog[0].trained_at);
        shouldRetrain = Date.now() - lastTrainedAt.getTime() >= intervalMs;
      } else {
        shouldRetrain = true;
      }
    }
    if (!shouldRetrain) {
      return NextResponse.json({ success: true, retrained: false, reason: 'The configured retraining interval has not elapsed since the last training cycle.', lastTrainedAt: lastTrainedAt?.toISOString() || null });
    }

    const symbols = await resolveLiveSymbols(req, requestedSymbol);
    const requestedModels = Array.isArray(body?.modelTypes)
      ? body.modelTypes.filter((value: unknown): value is string => typeof value === 'string')
      : getMlModelKeys();
    const modelTypes = requestedModels.length ? requestedModels : getMlModelKeys();
    const queued: TrainingQueueJob[] = [];
    const skipped: Array<{ symbol: string; error: string; horizonTicks?: number }> = [];

    for (const symbol of symbols) {
      const dataset = await findLatestEligibleDataset(sql, symbol);
      if (!dataset) {
        skipped.push({ symbol, error: 'NO_ELIGIBLE_DATASET: no completed leakage-validated dataset with samples is available.' });
        continue;
      }
      try {
        const job = await enqueueTrainingJob({ datasetId: dataset.id, modelTypes: modelTypes as MlModelKey[] });
        queued.push(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ symbol, error: message, horizonTicks: dataset.horizonTicks });
      }
    }

    const success = queued.length > 0;
    return NextResponse.json({
      success,
      retrained: false,
      queued: success,
      executionBoundary: 'dedicated-ml-worker',
      dataSource: 'persisted-real-tick-dataset',
      mode: symbols.length > 1 ? 'ALL_ASSETS_FLEET' : 'SINGLE_ASSET',
      symbol: symbols.length > 1 ? 'ALL_ASSETS' : symbols[0],
      modelTypes,
      queuedCount: queued.length,
      skippedCount: skipped.length,
      fleetTrainedCount: 0,
      jobs: queued,
      skipped,
      trainedAt: null,
      nextScheduledRun: intervalMs !== null ? new Date(Date.now() + intervalMs).toISOString() : null,
      message: success
        ? `Queued ${queued.length} retraining job(s) on the canonical ML worker boundary.`
        : 'No eligible datasets were available for retraining.',
    }, { status: success ? 202 : 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cron retraining could not be queued.';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
