import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { getDbConnectionString, initDbSchema } from './db';
import { ensureTrainingDurationSchema } from './training-duration-schema';
import { ensureTrainingBatchSchema } from './training-batch-schema';
import { getMlModelKeys, type MlModelKey } from './ml-model-registry';
import { enqueueTrainingJob } from './ml-training-queue';
import { getTrainingBatch } from './ml-training-batch-orchestrator';

type TrainingBatchPlan = { datasetIds: string[]; modelTypes?: MlModelKey[]; skipCompleted?: boolean; retryFailed?: boolean };

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())).map((value) => value.trim()))];
}

function normalizeModels(values: unknown): MlModelKey[] {
  const valid = new Set(getMlModelKeys());
  if (!Array.isArray(values)) return [...getMlModelKeys()];
  return [...new Set(values.filter((value): value is MlModelKey => typeof value === 'string' && valid.has(value as MlModelKey)))];
}

async function existingCompletedModels(sql: any, datasetId: string, candidates: MlModelKey[]) {
  const rows = await sql`
    SELECT model_family
    FROM ml_model_registry_v2
    WHERE dataset_id=${datasetId}
      AND status IN ('candidate','staging','production')
  `;
  const existing = new Set(rows.map((row: any) => String(row.model_family || '').trim().toLowerCase()));
  return candidates.filter((model) => existing.has(model));
}

async function db() {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  await ensureTrainingBatchSchema(sql);
  return sql;
}

async function enqueueBatchItems(sql: any, batchId: string) {
  const items = await sql`SELECT id,dataset_id,requested_models,status FROM ml_training_batch_items WHERE batch_id=${batchId} AND status='queued' ORDER BY id ASC`;
  for (const item of items) {
    await enqueueTrainingJob({
      datasetId: String(item.dataset_id),
      modelTypes: normalizeModels(item.requested_models),
      batchId,
      batchItemId: Number(item.id),
    });
  }
}

export async function createTrainingBatchQueued(plan: TrainingBatchPlan) {
  const sql = await db();
  const datasetIds = normalizeIds(plan.datasetIds);
  const modelTypes = normalizeModels(plan.modelTypes);
  if (!datasetIds.length) throw new Error('NO_DATASETS_SELECTED');
  if (!modelTypes.length) throw new Error('NO_MODELS_SELECTED');
  if (datasetIds.length > 100) throw new Error('TRAINING_BATCH_DATASET_LIMIT_EXCEEDED');

  const active = await sql`SELECT batch_id FROM ml_training_batches WHERE status IN ('running','queued') ORDER BY created_at DESC LIMIT 1`;
  if (active.length) throw new Error('TRAINING_BATCH_ALREADY_RUNNING');
  const runningRun = await sql`SELECT run_id FROM ml_training_runs WHERE status='running' ORDER BY created_at DESC LIMIT 1`;
  if (runningRun.length) throw new Error('TRAINING_ALREADY_RUNNING');

  const rows = await sql`SELECT id,asset_symbol,duration_value,duration_unit,horizon_ticks,status,leakage_check_passed,sample_count FROM training_datasets WHERE id = ANY(${datasetIds}::uuid[])`;
  const datasetMap = new Map(rows.map((row: any) => [String(row.id), row]));
  if (datasetMap.size !== datasetIds.length) throw new Error('ONE_OR_MORE_DATASETS_NOT_FOUND');

  const batchId = crypto.randomUUID();
  let totalJobs = 0;
  let skippedJobs = 0;
  const plans: Array<{ datasetId: string; requestedModels: MlModelKey[]; skippedModels: MlModelKey[] }> = [];

  for (const datasetId of datasetIds) {
    const dataset = datasetMap.get(datasetId);
    if (dataset.status !== 'completed' || dataset.leakage_check_passed !== true) throw new Error(`DATASET_NOT_READY_FOR_TRAINING:${datasetId}`);
    const skippedModels = plan.skipCompleted === false ? [] : await existingCompletedModels(sql, datasetId, modelTypes);
    const requestedModels = modelTypes.filter((model) => !skippedModels.includes(model));
    plans.push({ datasetId, requestedModels, skippedModels });
    totalJobs += requestedModels.length;
    skippedJobs += skippedModels.length;
  }

  await sql`INSERT INTO ml_training_batches (batch_id,status,requested_datasets,requested_models,total_jobs,completed_jobs,failed_jobs,skipped_jobs,worker_id,metadata)
    VALUES (${batchId},${totalJobs ? 'queued' : 'completed'},${datasetIds.length},${modelTypes.length},${totalJobs},0,0,${skippedJobs},NULL,${JSON.stringify({ datasetIds, modelTypes, skipCompleted:plan.skipCompleted !== false, retryFailed:plan.retryFailed === true, executionBoundary:'dedicated-ml-worker' })}::jsonb)`;

  for (const item of plans) {
    await sql`INSERT INTO ml_training_batch_items (batch_id,dataset_id,status,requested_models,skipped_models,completed_models,failed_models,metadata)
      VALUES (${batchId},${item.datasetId},${item.requestedModels.length ? 'queued' : 'skipped'},${JSON.stringify(item.requestedModels)}::jsonb,${JSON.stringify(item.skippedModels)}::jsonb,0,0,${JSON.stringify({ retryFailed:plan.retryFailed === true })}::jsonb)`;
  }

  if (totalJobs) await enqueueBatchItems(sql, batchId);
  return { batchId, status: totalJobs ? 'queued' : 'completed', requestedDatasets: datasetIds.length, requestedModels: modelTypes.length, totalJobs, skippedJobs, remainingJobs: totalJobs };
}

export async function resumeTrainingBatchQueued(batchId: string) {
  const sql = await db();
  const batch = await getTrainingBatch(batchId);
  if (!['queued','running','partial'].includes(batch.status)) return batch;

  const queued = await sql`SELECT id,dataset_id,requested_models,status FROM ml_training_batch_items WHERE batch_id=${batchId} AND status IN ('queued','failed','partial') ORDER BY id ASC`;
  for (const item of queued) {
    const existing = await sql`SELECT job_id FROM ml_training_job_queue WHERE batch_id=${batchId} AND batch_item_id=${Number(item.id)} AND status IN ('queued','running') LIMIT 1`;
    if (existing.length) continue;
    await sql`UPDATE ml_training_batch_items SET status='queued',error=NULL,heartbeat_at=NULL,updated_at=NOW() WHERE id=${Number(item.id)}`;
    await enqueueTrainingJob({ datasetId:String(item.dataset_id), modelTypes:normalizeModels(item.requested_models), batchId, batchItemId:Number(item.id) });
  }
  await sql`UPDATE ml_training_batches SET status='queued',error=NULL,heartbeat_at=NULL,updated_at=NOW() WHERE batch_id=${batchId} AND status IN ('partial','running','queued')`;
  return { ...(await getTrainingBatch(batchId)), resumed:true };
}
