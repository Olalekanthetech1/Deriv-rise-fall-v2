import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '../auth/route';
import { getMlModelKeys, type MlModelKey } from '@/lib/ml-model-registry';
import { clearTrainingRunHistory, listTrainingRuns } from '@/lib/ml-training-orchestrator';
import { enqueueTrainingJob, listTrainingQueueJobs, recoverStaleTrainingJobs } from '@/lib/ml-training-queue';
import { getDb } from '@/lib/db';
import { xgboostDaemon } from '@/lib/xgboost-daemon';
import { requireTrainingWorkerReady } from '@/lib/ml-training-control-plane';

function isAdmin(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}
function noStore() { return { 'Cache-Control': 'no-store, max-age=0' }; }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

function withLiveDiagnostics(runs: any[]) {
  return runs.map((run) => ({
    ...run,
    models: Array.isArray(run?.models) ? run.models.map((model: any) => {
      const live = xgboostDaemon.getLiveTrainingDiagnostic(String(run.run_id), String(model.model_type));
      if (!live) return model;
      const metrics = model.metrics && typeof model.metrics === 'object' ? model.metrics : {};
      const timings = live.timings && typeof live.timings === 'object' ? live.timings : {};
      return {
        ...model,
        metrics: {
          ...metrics,
          timings: { ...(metrics.timings && typeof metrics.timings === 'object' ? metrics.timings : {}), ...timings },
          liveDiagnostics: {
            phase: live.phase,
            elapsedMs: live.elapsedMs,
            message: live.message,
            updatedAt: live.updatedAt,
            source: 'native-python-runtime-live',
          },
        },
      };
    }) : run?.models,
  }));
}

async function mergeActiveQueueIntoRuns(runs: any[], queue: any[]) {
  const visibleQueue = queue.filter((job) => ['queued', 'running', 'failed'].includes(String(job.status)));
  if (!visibleQueue.length) return runs;

  const existingRunIds = new Set(runs.map((run) => String(run.run_id)));
  const jobs = visibleQueue.filter((job) => !job.trainingRunId || !existingRunIds.has(String(job.trainingRunId)));
  if (!jobs.length) return runs;

  const sql = getDb();
  if (!sql) return runs;
  const datasetIds = [...new Set(jobs.map((job) => String(job.datasetId)).filter(isUuid))];
  if (!datasetIds.length) return runs;

  const rows = await sql`
    SELECT id,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_ticks
    FROM training_datasets
    WHERE id = ANY(${datasetIds}::uuid[])
  `;
  const datasets = new Map(rows.map((row: any) => [String(row.id), row]));

  const queuedRuns = jobs.map((job) => {
    const dataset = datasets.get(String(job.datasetId));
    const requestedModels: MlModelKey[] = (Array.isArray(job.modelTypes) && job.modelTypes.length ? job.modelTypes : getMlModelKeys()) as MlModelKey[];
    const status = String(job.status);
    const modelStatus = status === 'failed' ? 'failed' : status;
    return {
      run_id: String(job.trainingRunId || job.jobId),
      dataset_id: String(job.datasetId),
      asset_symbol: dataset?.asset_symbol ? String(dataset.asset_symbol) : String(job.datasetId),
      duration_value: Number(dataset?.duration_value || 0),
      duration_unit: dataset?.duration_unit ? String(dataset.duration_unit) : '',
      duration_seconds: dataset?.duration_seconds != null ? Number(dataset.duration_seconds) : null,
      horizon_ticks: Number(dataset?.horizon_ticks || 0),
      status,
      completed_models: 0,
      failed_models: status === 'failed' ? requestedModels.length : 0,
      requested_models: requestedModels,
      models: requestedModels.map((model_type) => ({
        model_type,
        status: modelStatus,
        error: job.error || undefined,
        heartbeat_at: job.heartbeatAt || null,
      })),
      created_at: job.createdAt || new Date().toISOString(),
      completed_at: null,
      heartbeat_at: job.heartbeatAt || null,
      queue_job_id: String(job.jobId),
      execution_boundary: 'dedicated-ml-worker',
    };
  });

  return [...queuedRuns, ...runs];
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    await recoverStaleTrainingJobs();
    const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase() || undefined;
    const [runs, queue] = await Promise.all([listTrainingRuns(symbol), listTrainingQueueJobs()]);
    const visibleRuns = await mergeActiveQueueIntoRuns(runs, queue);
    return NextResponse.json({
      success: true,
      runs: withLiveDiagnostics(visibleRuns),
      queue,
      modelTypes: getMlModelKeys(),
      dataSource: 'live-database-plus-native-runtime-plus-worker-queue',
    }, { headers: noStore() });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to load training runs.' }, { status: 503, headers: noStore() });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const body = await req.json().catch(() => ({}));
    const datasetId = typeof body?.datasetId === 'string' ? body.datasetId.trim() : '';
    if (!datasetId) return NextResponse.json({ success: false, error: 'datasetId is required. Select a completed leakage-validated dataset.' }, { status: 400, headers: noStore() });
    const requested = Array.isArray(body?.modelTypes) ? body.modelTypes.filter((value: unknown): value is MlModelKey => typeof value === 'string' && getMlModelKeys().includes(value as MlModelKey)) : undefined;
    if (Array.isArray(body?.modelTypes) && body.modelTypes.length > 0 && (!requested || requested.length !== body.modelTypes.length)) return NextResponse.json({ success: false, error: 'One or more requested model types are not registered for production training. Experimental models must be launched explicitly from the Experimental Lab.' }, { status: 400, headers: noStore() });

    const dispatch = await requireTrainingWorkerReady();
    const job = await enqueueTrainingJob({ datasetId, modelTypes: requested });
    return NextResponse.json({
      success: true,
      queued: true,
      dataSource: 'persisted-real-tick-dataset',
      workerBoundary: 'dedicated-ml-worker',
      dispatch,
      ...job,
    }, { status: 202, headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model training could not be queued.';
    const workerUnavailable = /TRAINING_WORKER_UNAVAILABLE/i.test(message);
    const status = workerUnavailable ? 503 : /TRAINING_ALREADY_(RUNNING|QUEUED)/i.test(message) ? 409 : /REQUIRED/i.test(message) ? 400 : /DATABASE/i.test(message) ? 503 : 500;
    return NextResponse.json({ success: false, error: workerUnavailable ? 'Training worker is unavailable. No new training job was queued.' : message, code: workerUnavailable ? message : undefined }, { status, headers: noStore() });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const confirmation = req.headers.get('x-confirm-training-history-reset');
    if (confirmation !== 'DELETE_TRAINING_HISTORY') return NextResponse.json({ success: false, error: 'Explicit confirmation is required to clear training history.' }, { status: 400, headers: noStore() });
    const result = await clearTrainingRunHistory();
    return NextResponse.json({ success: true, message: 'Training history cleared. Datasets, dataset samples, registered models, artifacts, market data and configuration were not targeted.', ...result }, { headers: noStore() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to clear training history.';
    if (message === 'TRAINING_HISTORY_RESET_BLOCKED_BY_RUNNING_JOBS') {
      const runningRuns = (error as Error & { runningRuns?: unknown[] }).runningRuns || [];
      return NextResponse.json({ success: false, error: 'Training history cannot be cleared while a training job is running. Let the active run finish first.', code: message, runningRuns }, { status: 409, headers: noStore() });
    }
    return NextResponse.json({ success: false, error: message }, { status: 503, headers: noStore() });
  }
}