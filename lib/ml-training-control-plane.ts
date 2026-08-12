import { getDb, initDbSchema } from './db';
import { getWorkerStatus, type WorkerStatus } from './ml-training-queue';

export type TrainingQueueHealth = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  oldestQueuedAt: string | null;
  oldestQueuedAgeMs: number | null;
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  maxAttempts: number;
};

export type TrainingControlPlaneStatus = {
  ready: boolean;
  worker: WorkerStatus;
  queue: TrainingQueueHealth;
  reason: 'ready' | 'worker_offline' | 'worker_stale' | 'database_unavailable';
};

function emptyQueueHealth(): TrainingQueueHealth {
  return {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    oldestQueuedAt: null,
    oldestQueuedAgeMs: null,
    lastCompletedAt: null,
    lastFailedAt: null,
    maxAttempts: 0,
  };
}

export async function getTrainingControlPlaneStatus(): Promise<TrainingControlPlaneStatus> {
  const worker = await getWorkerStatus();
  const sql = getDb();
  if (!sql || !(await initDbSchema())) {
    return {
      ready: false,
      worker,
      queue: emptyQueueHealth(),
      reason: 'database_unavailable',
    };
  }

  const rows = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status='queued')::int AS queued,
      COUNT(*) FILTER (WHERE status='running')::int AS running,
      COUNT(*) FILTER (WHERE status='completed')::int AS completed,
      COUNT(*) FILTER (WHERE status='failed')::int AS failed,
      MIN(created_at) FILTER (WHERE status='queued') AS oldest_queued_at,
      MAX(updated_at) FILTER (WHERE status='completed') AS last_completed_at,
      MAX(updated_at) FILTER (WHERE status='failed') AS last_failed_at,
      COALESCE(MAX(attempts),0)::int AS max_attempts
    FROM ml_training_job_queue
  `;

  const row = rows[0] || {};
  const oldestQueuedAt = row.oldest_queued_at ? new Date(row.oldest_queued_at).toISOString() : null;
  const queue: TrainingQueueHealth = {
    queued: Number(row.queued || 0),
    running: Number(row.running || 0),
    completed: Number(row.completed || 0),
    failed: Number(row.failed || 0),
    oldestQueuedAt,
    oldestQueuedAgeMs: oldestQueuedAt ? Math.max(0, Date.now() - new Date(oldestQueuedAt).getTime()) : null,
    lastCompletedAt: row.last_completed_at ? new Date(row.last_completed_at).toISOString() : null,
    lastFailedAt: row.last_failed_at ? new Date(row.last_failed_at).toISOString() : null,
    maxAttempts: Number(row.max_attempts || 0),
  };

  const reason = worker.status === 'online' ? 'ready' : worker.status === 'stale' ? 'worker_stale' : 'worker_offline';
  return { ready: reason === 'ready', worker, queue, reason };
}

export async function requireTrainingWorkerReady(): Promise<TrainingControlPlaneStatus> {
  const status = await getTrainingControlPlaneStatus();
  if (!status.ready) {
    throw new Error(`TRAINING_WORKER_UNAVAILABLE:${status.reason}`);
  }
  return status;
}
