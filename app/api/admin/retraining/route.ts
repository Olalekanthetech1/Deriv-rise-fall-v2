import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { verifySessionToken } from '@/app/api/admin/auth/route';
import { listDurationTrainingDatasets } from '@/lib/training-dataset-builder-duration-v2';
import { enqueueTrainingJob, type TrainingQueueJob } from '@/lib/ml-training-queue';

export const dynamic = 'force-dynamic';

function isAdmin(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function getIntervalMs(): number | null {
  const raw = Number(process.env.ML_RETRAIN_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function isEligibleDataset(dataset: Record<string, unknown>): boolean {
  return dataset.status === 'completed'
    && dataset.leakage_check_passed === true
    && Number(dataset.sample_count ?? 0) > 0
    && typeof dataset.id === 'string'
    && dataset.id.trim().length > 0;
}

function newestEligibleDataset(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return rows
    .filter(isEligibleDataset)
    .sort((a, b) => new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime())[0] ?? null;
}

async function resolveLiveSymbols(req: NextRequest, symbol: string): Promise<string[]> {
  if (symbol !== 'ALL_ASSETS') return [symbol];
  const response = await fetch(new URL('/api/symbols', req.url), { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.symbols)) throw new Error(body?.error || 'Live Deriv symbol discovery is unavailable.');
  const symbols: string[] = body.symbols
    .filter((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return candidate.isOpen === true && typeof candidate.symbol === 'string' && candidate.symbol.trim().length > 0;
    })
    .map((item: { symbol: string }) => item.symbol.trim());
  if (!symbols.length) throw new Error('No open Deriv symbols are available for fleet retraining.');
  return Array.from(new Set<string>(symbols));
}

async function getLastTrainedAt(sql: ReturnType<typeof getDb>): Promise<string | null> {
  if (!sql) return null;
  const rows = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
  if (rows.length) return new Date(rows[0].trained_at).toISOString();
  const models = await sql`SELECT trained_at FROM ml_models ORDER BY trained_at DESC LIMIT 1`;
  return models.length ? new Date(models[0].trained_at).toISOString() : null;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const intervalMs = getIntervalMs();
    const connected = await initDbSchema();
    const sql = getDb();
    const lastTrainedAt = connected ? await getLastTrainedAt(sql) : null;
    const ageMs = lastTrainedAt ? Math.max(0, Date.now() - new Date(lastTrainedAt).getTime()) : null;
    const configured = intervalMs !== null;
    const due = configured && ageMs !== null ? ageMs >= intervalMs : null;
    const nextRunMs = configured && ageMs !== null ? Math.max(0, intervalMs - ageMs) : null;
    return NextResponse.json({
      success: true,
      status: connected ? (configured ? 'active' : 'schedule_not_configured') : 'database_unavailable',
      scheduleConfigured: configured,
      scheduleIntervalMs: intervalMs,
      scheduleIntervalHours: intervalMs === null ? null : intervalMs / 3_600_000,
      lastTrainedAt,
      timeSinceLastTrainMinutes: ageMs === null ? null : Math.floor(ageMs / 60_000),
      isDue: due,
      nextScheduledRunInMinutes: nextRunMs === null ? null : Math.ceil(nextRunMs / 60_000),
      executionMode: 'durable_queue',
      source: 'admin-retraining-control-plane',
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Retraining status failed.' }, { status: 500, headers });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  try {
    if (!(await initDbSchema())) return NextResponse.json({ success: false, error: 'Database unavailable; retraining requires persisted real tick data.' }, { status: 503 });
    const body = await req.json().catch(() => ({}));
    const requestedSymbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
    const force = body?.force === true;
    if (!requestedSymbol) return NextResponse.json({ success: false, error: 'A live symbol or ALL_ASSETS is required.' }, { status: 400 });

    const intervalMs = getIntervalMs();
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

    const lastTrainedAt = await getLastTrainedAt(sql);
    const due = force || (intervalMs !== null && (!lastTrainedAt || Date.now() - new Date(lastTrainedAt).getTime() >= intervalMs));
    if (!due) return NextResponse.json({ success: true, dispatched: false, reason: 'RETRAINING_INTERVAL_NOT_DUE', lastTrainedAt });
    if (!force && intervalMs === null) return NextResponse.json({ success: false, error: 'ML_RETRAIN_INTERVAL_MS is not configured.' }, { status: 503 });

    const symbols = await resolveLiveSymbols(req, requestedSymbol);
    const results: Array<Record<string, unknown>> = [];
    for (const symbol of symbols) {
      const datasets = await listDurationTrainingDatasets(symbol);
      const dataset = newestEligibleDataset(datasets as Array<Record<string, unknown>>);
      if (!dataset) {
        results.push({ symbol, queued: false, reason: 'NO_ELIGIBLE_DATASET' });
        continue;
      }
      try {
        const job: TrainingQueueJob = await enqueueTrainingJob({ datasetId: String(dataset.id), modelTypes: ['XGBoost'] });
        results.push({ symbol, queued: true, jobId: job.jobId, datasetId: job.datasetId, status: job.status });
      } catch (error) {
        results.push({ symbol, queued: false, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    const queued = results.filter((item) => item.queued === true);
    return NextResponse.json({
      success: queued.length > 0,
      dispatched: queued.length > 0,
      mode: symbols.length > 1 ? 'ALL_ASSETS_FLEET' : 'SINGLE_ASSET',
      fleetQueuedCount: queued.length,
      fleetSkippedCount: results.length - queued.length,
      symbol: symbols.length > 1 ? 'ALL_ASSETS' : requestedSymbol,
      results,
      nextScheduledRun: intervalMs === null ? null : new Date(Date.now() + intervalMs).toISOString(),
      message: queued.length > 0
        ? `Dispatched ${queued.length} retraining job(s) to the durable ML queue.`
        : 'No eligible persisted datasets were available for retraining.',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Retraining dispatch failed.' }, { status: 500 });
  }
}
