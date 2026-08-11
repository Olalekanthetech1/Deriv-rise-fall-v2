import { neon } from '@neondatabase/serverless';
import { getDbConnectionString } from './db';
import { listTrainingQueueJobs } from './ml-training-queue';

/**
 * Remove terminal worker-queue records that are part of training history.
 * Active queued/running work is intentionally preserved.
 *
 * The model-training history API merges failed queue jobs back into the UI when
 * their persisted ml_training_runs row no longer exists. Clearing only the run
 * tables therefore makes failed jobs reappear on the next GET request.
 */
export async function clearTerminalTrainingQueueHistory(): Promise<number> {
  const url = getDbConnectionString();
  if (!url) throw new Error('DATABASE_UNAVAILABLE');

  // listTrainingQueueJobs() also initializes the durable queue schema for older
  // deployments before we issue the cleanup query below.
  await listTrainingQueueJobs();

  const sql = neon(url);
  const running = await sql`
    SELECT job_id,dataset_id,training_run_id,worker_id,heartbeat_at
    FROM ml_training_job_queue
    WHERE status='running'
    ORDER BY created_at DESC
  `;
  if (running.length) {
    const error = new Error('TRAINING_HISTORY_RESET_BLOCKED_BY_RUNNING_JOBS');
    (error as Error & { runningQueueJobs?: unknown[] }).runningQueueJobs = running;
    throw error;
  }

  const deleted = await sql`
    DELETE FROM ml_training_job_queue
    WHERE status='failed'
    RETURNING job_id
  `;

  return deleted.length;
}
