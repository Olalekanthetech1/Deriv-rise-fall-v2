import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { getDbConnectionString, initDbSchema } from './db';
import { ensureTrainingDurationSchema } from './training-duration-schema';
import { ensureTrainingBatchSchema } from './training-batch-schema';
import { getMlModelKeys, type MlModelKey } from './ml-model-registry';
import { trainDatasetModels } from './ml-training-orchestrator';

export type TrainingBatchPlan = {
  datasetIds: string[];
  modelTypes?: MlModelKey[];
  skipCompleted?: boolean;
  retryFailed?: boolean;
};

function workerId() {
  return `${process.env.RENDER_INSTANCE_ID?.trim() || 'node'}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value.trim())).map((value) => value.trim()))];
}

function normalizeModels(values: unknown): MlModelKey[] {
  const valid = new Set(getMlModelKeys());
  if (!Array.isArray(values)) return [...getMlModelKeys()];
  return [...new Set(values.filter((value): value is MlModelKey => typeof value === 'string' && valid.has(value as MlModelKey)))];
}

async function existingCompletedModels(sql: any, datasetId: string, candidates: MlModelKey[]): Promise<MlModelKey[]> {
  const rows = await sql`
    SELECT metrics->>'engine' AS engine
    FROM ml_model_registry_v2
    WHERE dataset_id=${datasetId}
      AND status IN ('candidate','staging','production')
  `;
  const existing = new Set(rows.map((row: any) => String(row.engine || '').trim().toLowerCase()));
  return candidates.filter((model) => existing.has(model));
}

async function existingFailedModels(sql: any, datasetId: string, candidates: MlModelKey[]): Promise<MlModelKey[]> {
  const rows = await sql`
    SELECT DISTINCT m.model_type
    FROM ml_training_run_models m
    INNER JOIN ml_training_runs r ON r.run_id=m.run_id
    WHERE r.dataset_id=${datasetId}
      AND m.status IN ('failed','timed_out')
  `;
  const failed = new Set(rows.map((row: any) => String(row.model_type || '').trim().toLowerCase()));
  return candidates.filter((model) => failed.has(model));
}

async function updateBatch(sql: any, batchId: string, values: Record<string, unknown>) {
  const entries = Object.entries(values);
  for (const [key, value] of entries) {
    if (key === 'metadata') await sql`UPDATE ml_training_batches SET metadata=${JSON.stringify(value)}::jsonb,updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'status') await sql`UPDATE ml_training_batches SET status=${String(value)},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'total_jobs') await sql`UPDATE ml_training_batches SET total_jobs=${Number(value)},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'completed_jobs') await sql`UPDATE ml_training_batches SET completed_jobs=${Number(value)},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'failed_jobs') await sql`UPDATE ml_training_batches SET failed_jobs=${Number(value)},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'skipped_jobs') await sql`UPDATE ml_training_batches SET skipped_jobs=${Number(value)},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'started_at') await sql`UPDATE ml_training_batches SET started_at=${value ? new Date(String(value)).toISOString() : null},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'completed_at') await sql`UPDATE ml_training_batches SET completed_at=${value ? new Date(String(value)).toISOString() : null},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'heartbeat_at') await sql`UPDATE ml_training_batches SET heartbeat_at=${value ? new Date(String(value)).toISOString() : null},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'worker_id') await sql`UPDATE ml_training_batches SET worker_id=${value ? String(value) : null},updated_at=NOW() WHERE batch_id=${batchId}`;
    else if (key === 'error') await sql`UPDATE ml_training_batches SET error=${value ? String(value) : null},updated_at=NOW() WHERE batch_id=${batchId}`;
  }
}

export async function createTrainingBatch(plan: TrainingBatchPlan) {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  await ensureTrainingBatchSchema(sql);

  const datasetIds = normalizeIds(plan.datasetIds);
  const modelTypes = normalizeModels(plan.modelTypes);
  if (!datasetIds.length) throw new Error('NO_DATASETS_SELECTED');
  if (!modelTypes.length) throw new Error('NO_MODELS_SELECTED');
  if (datasetIds.length > 100) throw new Error('TRAINING_BATCH_DATASET_LIMIT_EXCEEDED');

  const runningBatch = await sql`SELECT batch_id FROM ml_training_batches WHERE status='running' ORDER BY created_at DESC LIMIT 1`;
  if (runningBatch.length) throw new Error('TRAINING_BATCH_ALREADY_RUNNING');
  const runningRun = await sql`SELECT run_id FROM ml_training_runs WHERE status='running' ORDER BY created_at DESC LIMIT 1`;
  if (runningRun.length) throw new Error('TRAINING_ALREADY_RUNNING');

  const datasets = await sql`
    SELECT id,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_ticks,status,leakage_check_passed,sample_count
    FROM training_datasets
    WHERE id = ANY(${datasetIds}::text[])
  `;
  const datasetMap = new Map(datasets.map((row: any) => [String(row.id), row]));
  if (datasetMap.size !== datasetIds.length) throw new Error('ONE_OR_MORE_DATASETS_NOT_FOUND');

  const batchId = crypto.randomUUID();
  const activeWorkerId = workerId();
  let totalJobs = 0;
  let skippedJobs = 0;
  const itemPlans: Array<{ datasetId: string; requestedModels: MlModelKey[]; skippedModels: MlModelKey[] }> = [];

  for (const datasetId of datasetIds) {
    const dataset = datasetMap.get(datasetId);
    if (dataset.status !== 'completed' || dataset.leakage_check_passed !== true) throw new Error(`DATASET_NOT_READY_FOR_TRAINING:${datasetId}`);
    const completedModels = plan.skipCompleted === false ? [] : await existingCompletedModels(sql, datasetId, modelTypes);
    const failedModels = plan.retryFailed === true ? [] : await existingFailedModels(sql, datasetId, modelTypes);
    const skippedModels = [...new Set([...completedModels, ...failedModels])];
    const requestedModels = modelTypes.filter((model) => !skippedModels.includes(model));
    itemPlans.push({ datasetId, requestedModels, skippedModels });
    totalJobs += requestedModels.length;
    skippedJobs += skippedModels.length;
  }

  await sql`
    INSERT INTO ml_training_batches (batch_id,status,requested_datasets,requested_models,total_jobs,completed_jobs,failed_jobs,skipped_jobs,worker_id,metadata)
    VALUES (${batchId},'queued',${datasetIds.length},${modelTypes.length},${totalJobs},0,0,${skippedJobs},${activeWorkerId},${JSON.stringify({datasetIds,modelTypes,skipCompleted:plan.skipCompleted !== false,retryFailed:plan.retryFailed === true})}::jsonb)
  `;

  for (const item of itemPlans) {
    const status = item.requestedModels.length ? 'queued' : 'skipped';
    await sql`
      INSERT INTO ml_training_batch_items (batch_id,dataset_id,status,requested_models,skipped_models,completed_models,failed_models,metadata)
      VALUES (${batchId},${item.datasetId},${status},${JSON.stringify(item.requestedModels)}::jsonb,${JSON.stringify(item.skippedModels)}::jsonb,0,0,${JSON.stringify({requestedModels:item.requestedModels,skippedModels:item.skippedModels})}::jsonb)
    `;
  }

  void processTrainingBatch(batchId);
  return { batchId, status: totalJobs ? 'queued' : 'completed', requestedDatasets: datasetIds.length, requestedModels: modelTypes.length, totalJobs, skippedJobs, remainingJobs: totalJobs };
}

export async function processTrainingBatch(batchId: string) {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) return;
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  await ensureTrainingBatchSchema(sql);

  const batchRows = await sql`SELECT * FROM ml_training_batches WHERE batch_id=${batchId} LIMIT 1`;
  if (!batchRows.length) return;
  const activeWorkerId = String(batchRows[0].worker_id || workerId());
  await updateBatch(sql, batchId, { status: 'running', started_at: batchRows[0].started_at || new Date().toISOString(), heartbeat_at: new Date().toISOString(), worker_id: activeWorkerId });

  const heartbeat = setInterval(() => { void updateBatch(sql, batchId, { heartbeat_at: new Date().toISOString() }).catch(() => undefined); }, 15_000);

  try {
    const items = await sql`SELECT * FROM ml_training_batch_items WHERE batch_id=${batchId} AND status='queued' ORDER BY id ASC`;
    for (const item of items) {
      await sql`UPDATE ml_training_batch_items SET status='running',started_at=NOW(),heartbeat_at=NOW(),updated_at=NOW() WHERE id=${item.id} AND status='queued'`;
      try {
        const requestedModels = normalizeModels(item.requested_models);
        if (!requestedModels.length) {
          await sql`UPDATE ml_training_batch_items SET status='skipped',completed_at=NOW(),heartbeat_at=NULL,updated_at=NOW() WHERE id=${item.id}`;
          continue;
        }
        const result = await trainDatasetModels({ datasetId: String(item.dataset_id), modelTypes: requestedModels });
        const failedModels = Number(result.failedModels || 0);
        const completedModels = Number(result.completedModels || 0);
        const itemStatus = result.status === 'completed' ? 'completed' : failedModels > 0 && completedModels > 0 ? 'partial' : 'failed';
        await sql`
          UPDATE ml_training_batch_items
          SET status=${itemStatus},run_id=${result.runId},completed_models=${completedModels},failed_models=${failedModels},completed_at=NOW(),heartbeat_at=NULL,error=${failedModels ? JSON.stringify(result.results.filter((r:any)=>!r.success)) : null},updated_at=NOW()
          WHERE id=${item.id}
        `;
      } catch (error) {
        await sql`UPDATE ml_training_batch_items SET status='failed',error=${error instanceof Error ? error.message : 'Batch item failed.'},completed_at=NOW(),heartbeat_at=NULL,updated_at=NOW() WHERE id=${item.id}`;
      }

      const counts = await sql`
        SELECT COALESCE(SUM(completed_models),0)::int AS completed_models,
               COALESCE(SUM(failed_models),0)::int AS failed_models
        FROM ml_training_batch_items WHERE batch_id=${batchId}
      `;
      await updateBatch(sql, batchId, { completed_jobs: Number(counts[0]?.completed_models || 0), failed_jobs: Number(counts[0]?.failed_models || 0), heartbeat_at: new Date().toISOString() });
    }

    const final = await sql`
      SELECT COUNT(*) FILTER (WHERE status='skipped')::int AS skipped_items,
             COUNT(*) FILTER (WHERE status='completed')::int AS completed_items,
             COUNT(*) FILTER (WHERE status IN ('failed','partial'))::int AS failed_items,
             COALESCE(SUM(completed_models),0)::int AS completed_jobs,
             COALESCE(SUM(failed_models),0)::int AS failed_jobs
      FROM ml_training_batch_items WHERE batch_id=${batchId}
    `;
    const row = final[0];
    const terminalStatus = Number(row.failed_items || 0) === 0 ? 'completed' : Number(row.completed_items || 0) > 0 || Number(row.skipped_items || 0) > 0 ? 'partial' : 'failed';
    await updateBatch(sql, batchId, { status: terminalStatus, completed_jobs: Number(row.completed_jobs || 0), failed_jobs: Number(row.failed_jobs || 0), skipped_jobs: Number(row.skipped_items || 0), completed_at: new Date().toISOString(), heartbeat_at: null });
  } catch (error) {
    await updateBatch(sql, batchId, { status: 'failed', error: error instanceof Error ? error.message : 'Training batch failed.', completed_at: new Date().toISOString(), heartbeat_at: null });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function getTrainingBatch(batchId: string) {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  await ensureTrainingBatchSchema(sql);
  const rows = await sql`SELECT * FROM ml_training_batches WHERE batch_id=${batchId} LIMIT 1`;
  if (!rows.length) throw new Error('TRAINING_BATCH_NOT_FOUND');
  const items = await sql`SELECT i.*,d.name,d.asset_symbol,d.duration_value,d.duration_unit,d.horizon_ticks FROM ml_training_batch_items i LEFT JOIN training_datasets d ON d.id=i.dataset_id WHERE i.batch_id=${batchId} ORDER BY i.id ASC`;
  return { ...rows[0], items };
}

export async function resumeTrainingBatch(batchId: string) {
  const batch = await getTrainingBatch(batchId);
  if (!['queued','running','partial'].includes(String(batch.status))) return batch;
  void processTrainingBatch(batchId);
  return { ...batch, resumed: true };
}
