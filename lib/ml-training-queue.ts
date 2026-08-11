import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { getDbConnectionString, initDbSchema } from './db';

type QueueStatus = 'queued' | 'running' | 'completed' | 'failed';
export type TrainingQueueRequest = { datasetId: string; modelTypes?: string[]; batchId?: string; batchItemId?: number };
export type TrainingQueueJob = {
  jobId: string;
  datasetId: string;
  modelTypes: string[];
  status: QueueStatus;
  attempts: number;
  workerId?: string | null;
  trainingRunId?: string | null;
  batchId?: string | null;
  batchItemId?: number | null;
  heartbeatAt?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
};
export type TrainingQueueResult = { trainingRunId?: string; status?: string; completedModels?: number; failedModels?: number; error?: string };
export type WorkerStatus = { workerId: string | null; status: 'online' | 'stale' | 'offline'; heartbeatAt: string | null };

let schemaReady = false;

async function getQueueDb() {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) return null;
  const sql = neon(url);
  if (!schemaReady) {
    await sql`CREATE TABLE IF NOT EXISTS ml_training_job_queue (
      job_id UUID PRIMARY KEY,
      dataset_id UUID NOT NULL,
      model_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(24) NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      worker_id VARCHAR(160),
      training_run_id UUID,
      batch_id UUID,
      batch_item_id BIGINT,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      heartbeat_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`ALTER TABLE ml_training_job_queue ADD COLUMN IF NOT EXISTS batch_id UUID`;
    await sql`ALTER TABLE ml_training_job_queue ADD COLUMN IF NOT EXISTS batch_item_id BIGINT`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ml_training_queue_claim ON ml_training_job_queue (status, available_at, created_at)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ml_training_queue_active_dataset ON ml_training_job_queue (dataset_id) WHERE status IN ('queued','running')`;
    await sql`CREATE TABLE IF NOT EXISTS ml_training_worker_heartbeats (
      worker_id VARCHAR(160) PRIMARY KEY,
      status VARCHAR(24) NOT NULL DEFAULT 'online',
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    schemaReady = true;
  }
  return sql;
}

export async function recordWorkerHeartbeat(workerId: string, status: 'online' | 'stopping' = 'online') {
  const sql = await getQueueDb();
  if (!sql) return;
  await sql`
    INSERT INTO ml_training_worker_heartbeats (worker_id,status,heartbeat_at,updated_at)
    VALUES (${workerId},${status},NOW(),NOW())
    ON CONFLICT (worker_id) DO UPDATE SET status=EXCLUDED.status,heartbeat_at=EXCLUDED.heartbeat_at,updated_at=NOW()
  `;
}

export async function getWorkerStatus(): Promise<WorkerStatus> {
  const sql = await getQueueDb();
  if (!sql) return { workerId: null, status: 'offline', heartbeatAt: null };
  const raw = Number(process.env.ML_TRAINING_STALE_AFTER_MS || 20 * 60 * 1000);
  const staleMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number.isFinite(raw) ? Math.trunc(raw) : 20 * 60 * 1000));
  const rows = await sql`SELECT worker_id,status,heartbeat_at FROM ml_training_worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 1`;
  if (!rows.length) return { workerId: null, status: 'offline', heartbeatAt: null };
  const heartbeatAt = rows[0].heartbeat_at ? new Date(rows[0].heartbeat_at) : null;
  const stale = !heartbeatAt || (Date.now() - heartbeatAt.getTime()) > staleMs;
  return {
    workerId: rows[0].worker_id ? String(rows[0].worker_id) : null,
    status: stale ? 'stale' : String(rows[0].status) === 'stopping' ? 'stale' : 'online',
    heartbeatAt: heartbeatAt ? heartbeatAt.toISOString() : null,
  };
}

export async function enqueueTrainingJob(request: TrainingQueueRequest): Promise<TrainingQueueJob> {
  if (!request.datasetId) throw new Error('datasetId is required.');
  const sql = await getQueueDb();
  if (!sql) throw new Error('DATABASE_UNAVAILABLE');
  const jobId = crypto.randomUUID();
  try {
    const rows = await sql`
      INSERT INTO ml_training_job_queue (job_id,dataset_id,model_types,status,batch_id,batch_item_id)
      VALUES (${jobId},${request.datasetId},${JSON.stringify(request.modelTypes || [])}::jsonb,'queued',${request.batchId || null},${request.batchItemId || null})
      RETURNING job_id,dataset_id,model_types,status,attempts,worker_id,training_run_id,batch_id,batch_item_id,heartbeat_at,error,created_at,updated_at
    `;
    return mapQueueJob(rows[0]);
  } catch (error: any) {
    if (String(error?.code || '').toLowerCase() === '23505') throw new Error('TRAINING_ALREADY_QUEUED');
    throw error;
  }
}

export async function listTrainingQueueJobs(): Promise<TrainingQueueJob[]> {
  const sql = await getQueueDb();
  if (!sql) return [];
  const rows = await sql`SELECT job_id,dataset_id,model_types,status,attempts,worker_id,training_run_id,batch_id,batch_item_id,heartbeat_at,error,created_at,updated_at FROM ml_training_job_queue ORDER BY created_at DESC LIMIT 100`;
  return rows.map(mapQueueJob);
}

export async function claimNextTrainingJob(workerId: string): Promise<TrainingQueueJob | null> {
  const sql = await getQueueDb();
  if (!sql) throw new Error('DATABASE_UNAVAILABLE');
  const rows = await sql`
    WITH candidate AS (
      SELECT job_id FROM ml_training_job_queue WHERE status='queued' AND available_at <= NOW() ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE ml_training_job_queue q
    SET status='running',worker_id=${workerId},attempts=q.attempts+1,heartbeat_at=NOW(),updated_at=NOW()
    FROM candidate WHERE q.job_id=candidate.job_id
    RETURNING q.job_id,q.dataset_id,q.model_types,q.status,q.attempts,q.worker_id,q.training_run_id,q.batch_id,q.batch_item_id,q.heartbeat_at,q.error,q.created_at,q.updated_at
  `;
  if (!rows.length) return null;
  const job = mapQueueJob(rows[0]);
  if (job.batchId) {
    await sql`UPDATE ml_training_batches SET status='running',worker_id=${workerId},heartbeat_at=NOW(),started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE batch_id=${job.batchId} AND status IN ('queued','partial','running')`;
    if (job.batchItemId) await sql`UPDATE ml_training_batch_items SET status='running',started_at=COALESCE(started_at,NOW()),heartbeat_at=NOW(),updated_at=NOW() WHERE id=${job.batchItemId} AND status IN ('queued','partial')`;
  }
  return job;
}

export async function heartbeatTrainingJob(jobId: string, workerId: string, trainingRunId?: string) {
  const sql = await getQueueDb();
  if (!sql) return;
  const rows = await sql`UPDATE ml_training_job_queue SET heartbeat_at=NOW(),training_run_id=COALESCE(${trainingRunId || null},training_run_id),updated_at=NOW() WHERE job_id=${jobId} AND worker_id=${workerId} AND status='running' RETURNING batch_id`;
  const batchId = rows[0]?.batch_id ? String(rows[0].batch_id) : null;
  if (batchId) await sql`UPDATE ml_training_batches SET heartbeat_at=NOW(),updated_at=NOW() WHERE batch_id=${batchId} AND status IN ('queued','running','partial')`;
}

export async function finishTrainingJob(jobId: string, workerId: string, status: 'completed' | 'failed', error?: string, trainingRunId?: string, result?: TrainingQueueResult) {
  const sql = await getQueueDb();
  if (!sql) return;
  const rows = await sql`UPDATE ml_training_job_queue SET status=${status},error=${error || result?.error || null},training_run_id=COALESCE(${trainingRunId || result?.trainingRunId || null},training_run_id),heartbeat_at=NULL,updated_at=NOW() WHERE job_id=${jobId} AND worker_id=${workerId} RETURNING batch_id,batch_item_id`;
  const batchId = rows[0]?.batch_id ? String(rows[0].batch_id) : null;
  const batchItemId = rows[0]?.batch_item_id ? Number(rows[0].batch_item_id) : null;
  if (!batchId || !batchItemId) return;
  const completedModels = Number(result?.completedModels || 0);
  const failedModels = Number(result?.failedModels || (status === 'failed' ? 1 : 0));
  const itemStatus = status === 'failed' ? 'failed' : failedModels > 0 && completedModels > 0 ? 'partial' : 'completed';
  await sql`UPDATE ml_training_batch_items SET status=${itemStatus},run_id=${trainingRunId || result?.trainingRunId || null},completed_models=${completedModels},failed_models=${failedModels},completed_at=NOW(),heartbeat_at=NULL,error=${error || result?.error || null},updated_at=NOW() WHERE id=${batchItemId}`;
  const counts = await sql`
    SELECT COUNT(*)::int AS total_items,
      COUNT(*) FILTER (WHERE status IN ('completed','skipped'))::int AS done_items,
      COUNT(*) FILTER (WHERE status IN ('failed','partial'))::int AS failed_items,
      COALESCE(SUM(completed_models),0)::int AS completed_jobs,
      COALESCE(SUM(failed_models),0)::int AS failed_jobs,
      COUNT(*) FILTER (WHERE status='skipped')::int AS skipped_items
    FROM ml_training_batch_items WHERE batch_id=${batchId}
  `;
  const row = counts[0];
  const done = Number(row?.done_items || 0);
  const total = Number(row?.total_items || 0);
  const terminal = done >= total;
  const batchStatus = terminal ? (Number(row?.failed_items || 0) === 0 ? 'completed' : Number(row?.completed_jobs || 0) > 0 || Number(row?.skipped_items || 0) > 0 ? 'partial' : 'failed') : 'running';
  await sql`UPDATE ml_training_batches SET status=${batchStatus},completed_jobs=${Number(row?.completed_jobs || 0)},failed_jobs=${Number(row?.failed_jobs || 0)},skipped_jobs=${Number(row?.skipped_items || 0)},completed_at=${terminal ? new Date().toISOString() : null},heartbeat_at=${terminal ? null : new Date().toISOString()},updated_at=NOW() WHERE batch_id=${batchId}`;
}

export async function recoverStaleTrainingJobs() {
  const sql = await getQueueDb();
  if (!sql) return 0;
  const raw = Number(process.env.ML_TRAINING_STALE_AFTER_MS || 20 * 60 * 1000);
  const staleMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number.isFinite(raw) ? Math.trunc(raw) : 20 * 60 * 1000));
  const rows = await sql`SELECT job_id,batch_id,batch_item_id FROM ml_training_job_queue WHERE status='running' AND COALESCE(heartbeat_at,updated_at,created_at) < NOW() - (${staleMs}::bigint * INTERVAL '1 millisecond')`;
  if (!rows.length) return 0;
  for (const row of rows) {
    if (row.batch_item_id) await sql`UPDATE ml_training_batch_items SET status='queued',heartbeat_at=NULL,error='Training worker heartbeat expired; item returned to queue.',updated_at=NOW() WHERE id=${Number(row.batch_item_id)} AND status='running'`;
    if (row.batch_id) await sql`UPDATE ml_training_batches SET status='queued',worker_id=NULL,heartbeat_at=NULL,error='Training worker heartbeat expired; batch returned to queue.',updated_at=NOW() WHERE batch_id=${String(row.batch_id)} AND status IN ('running','partial')`;
  }
  await sql`UPDATE ml_training_job_queue SET status='queued',worker_id=NULL,heartbeat_at=NULL,error='Training worker heartbeat expired; job returned to queue.',available_at=NOW(),updated_at=NOW() WHERE status='running' AND COALESCE(heartbeat_at,updated_at,created_at) < NOW() - (${staleMs}::bigint * INTERVAL '1 millisecond')`;
  return rows.length;
}

function mapQueueJob(row:any): TrainingQueueJob {
  return { jobId:String(row.job_id), datasetId:String(row.dataset_id), modelTypes:Array.isArray(row?.model_types)?row.model_types.map(String):[], status:String(row.status) as QueueStatus, attempts:Number(row.attempts||0), workerId:row.worker_id?String(row.worker_id):null, trainingRunId:row.training_run_id?String(row.training_run_id):null, batchId:row.batch_id?String(row.batch_id):null, batchItemId:row.batch_item_id?Number(row.batch_item_id):null, heartbeatAt:row.heartbeat_at?new Date(row.heartbeat_at).toISOString():null, error:row.error?String(row.error):null, createdAt:row.created_at?new Date(row.created_at).toISOString():undefined, updatedAt:row.updated_at?new Date(row.updated_at).toISOString():undefined };
}
