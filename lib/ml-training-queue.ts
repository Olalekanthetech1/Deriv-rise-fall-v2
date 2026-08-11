import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { getDbConnectionString, initDbSchema } from './db';

type QueueStatus = 'queued' | 'running' | 'completed' | 'failed';

export type TrainingQueueRequest = { datasetId: string; modelTypes?: string[] };
export type TrainingQueueJob = {
  jobId: string;
  datasetId: string;
  modelTypes: string[];
  status: QueueStatus;
  attempts: number;
  workerId?: string | null;
  trainingRunId?: string | null;
  heartbeatAt?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

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
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      heartbeat_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ml_training_queue_claim
      ON ml_training_job_queue (status, available_at, created_at)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ml_training_queue_active_dataset
      ON ml_training_job_queue (dataset_id) WHERE status IN ('queued','running')`;
    schemaReady = true;
  }
  return sql;
}

export async function enqueueTrainingJob(request: TrainingQueueRequest): Promise<TrainingQueueJob> {
  if (!request.datasetId) throw new Error('datasetId is required.');
  const sql = await getQueueDb();
  if (!sql) throw new Error('DATABASE_UNAVAILABLE');
  const jobId = crypto.randomUUID();
  try {
    const rows = await sql`
      INSERT INTO ml_training_job_queue (job_id, dataset_id, model_types, status)
      VALUES (${jobId}, ${request.datasetId}, ${JSON.stringify(request.modelTypes || [])}::jsonb, 'queued')
      RETURNING job_id, dataset_id, model_types, status, attempts, worker_id, training_run_id, heartbeat_at, error, created_at, updated_at
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
  const rows = await sql`
    SELECT job_id, dataset_id, model_types, status, attempts, worker_id, training_run_id, heartbeat_at, error, created_at, updated_at
    FROM ml_training_job_queue ORDER BY created_at DESC LIMIT 100
  `;
  return rows.map(mapQueueJob);
}

export async function claimNextTrainingJob(workerId: string): Promise<TrainingQueueJob | null> {
  const sql = await getQueueDb();
  if (!sql) throw new Error('DATABASE_UNAVAILABLE');
  const rows = await sql`
    WITH candidate AS (
      SELECT job_id FROM ml_training_job_queue
      WHERE status='queued' AND available_at <= NOW()
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE ml_training_job_queue q
    SET status='running', worker_id=${workerId}, attempts=q.attempts + 1, heartbeat_at=NOW(), updated_at=NOW()
    FROM candidate WHERE q.job_id=candidate.job_id
    RETURNING q.job_id, q.dataset_id, q.model_types, q.status, q.attempts, q.worker_id, q.training_run_id, q.heartbeat_at, q.error, q.created_at, q.updated_at
  `;
  return rows.length ? mapQueueJob(rows[0]) : null;
}

export async function heartbeatTrainingJob(jobId: string, workerId: string, trainingRunId?: string) {
  const sql = await getQueueDb();
  if (!sql) return;
  await sql`
    UPDATE ml_training_job_queue
    SET heartbeat_at=NOW(), training_run_id=COALESCE(${trainingRunId || null}, training_run_id), updated_at=NOW()
    WHERE job_id=${jobId} AND worker_id=${workerId} AND status='running'
  `;
}

export async function finishTrainingJob(jobId: string, workerId: string, status: 'completed' | 'failed', error?: string, trainingRunId?: string) {
  const sql = await getQueueDb();
  if (!sql) return;
  await sql`
    UPDATE ml_training_job_queue
    SET status=${status}, error=${error || null}, training_run_id=COALESCE(${trainingRunId || null}, training_run_id), heartbeat_at=NULL, updated_at=NOW()
    WHERE job_id=${jobId} AND worker_id=${workerId}
  `;
}

export async function recoverStaleTrainingJobs() {
  const sql = await getQueueDb();
  if (!sql) return 0;
  const staleMsRaw = Number(process.env.ML_TRAINING_STALE_AFTER_MS || 20 * 60 * 1000);
  const staleMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number.isFinite(staleMsRaw) ? Math.trunc(staleMsRaw) : 20 * 60 * 1000));
  const rows = await sql`
    UPDATE ml_training_job_queue
    SET status='queued', worker_id=NULL, heartbeat_at=NULL,
        error='Training worker heartbeat expired; job returned to queue.',
        available_at=NOW(), updated_at=NOW()
    WHERE status='running'
      AND COALESCE(heartbeat_at, updated_at, created_at) < NOW() - (${staleMs}::bigint * INTERVAL '1 millisecond')
    RETURNING job_id
  `;
  return rows.length;
}

function mapQueueJob(row: any): TrainingQueueJob {
  return {
    jobId: String(row.job_id),
    datasetId: String(row.dataset_id),
    modelTypes: Array.isArray(row?.model_types) ? row.model_types.map(String) : [],
    status: String(row.status) as QueueStatus,
    attempts: Number(row.attempts || 0),
    workerId: row.worker_id ? String(row.worker_id) : null,
    trainingRunId: row.training_run_id ? String(row.training_run_id) : null,
    heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at).toISOString() : null,
    error: row.error ? String(row.error) : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}
