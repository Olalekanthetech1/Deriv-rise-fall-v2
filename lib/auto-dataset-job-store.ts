import { randomUUID } from 'node:crypto';
import { getDbOrThrow } from '@/lib/db';
import type { DerivDurationUnit } from '@/lib/deriv-duration-registry';

export type AutoDatasetJobStatus = 'running' | 'completed' | 'failed';
export type AutoDatasetJob = {
  id: string;
  symbol: string;
  status: AutoDatasetJobStatus;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  failures: Array<{ value: number; unit: DerivDurationUnit; error: string }>;
  startedAt: string;
  finishedAt?: string;
};
export type AutoDatasetJobItem = { id: number; itemIndex: number; value: number; unit: DerivDurationUnit; rangeId: string; attempts: number };

let schemaReady: Promise<void> | null = null;
async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const sql = getDbOrThrow();
    await sql`CREATE TABLE IF NOT EXISTS ops_ml_dataset_build_jobs (id UUID PRIMARY KEY, symbol VARCHAR(64) NOT NULL, status VARCHAR(24) NOT NULL, requested_count INTEGER NOT NULL DEFAULT 0, completed_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, failures JSONB NOT NULL DEFAULT '[]'::jsonb, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ops_ml_dataset_jobs_symbol_started ON ops_ml_dataset_build_jobs (symbol, started_at DESC)`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_ml_dataset_jobs_running_symbol ON ops_ml_dataset_build_jobs (symbol) WHERE status = 'running'`;
    await sql`CREATE TABLE IF NOT EXISTS ops_ml_dataset_build_job_items (id BIGSERIAL PRIMARY KEY, job_id UUID NOT NULL REFERENCES ops_ml_dataset_build_jobs(id) ON DELETE CASCADE, item_index INTEGER NOT NULL, duration_value INTEGER NOT NULL, duration_unit VARCHAR(1) NOT NULL, duration_range_id VARCHAR(160) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error_message TEXT, claimed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, UNIQUE (job_id, item_index))`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ops_ml_dataset_build_job_items_claim ON ops_ml_dataset_build_job_items (job_id, status, claimed_at, item_index)`;
  })();
  try { await schemaReady; } catch (error) { schemaReady = null; throw error; }
}
function mapJob(row: any): AutoDatasetJob {
  return { id: String(row.id), symbol: String(row.symbol), status: row.status as AutoDatasetJobStatus, requestedCount: Number(row.requested_count), completedCount: Number(row.completed_count), failedCount: Number(row.failed_count), failures: Array.isArray(row.failures) ? row.failures : [], startedAt: new Date(row.started_at).toISOString(), ...(row.finished_at ? { finishedAt: new Date(row.finished_at).toISOString() } : {}) };
}
export async function getAutoDatasetJob(jobId: string): Promise<AutoDatasetJob | null> {
  await ensureSchema(); const sql = getDbOrThrow(); const rows = await sql`SELECT * FROM ops_ml_dataset_build_jobs WHERE id = ${jobId} LIMIT 1`; return rows.length ? mapJob(rows[0]) : null;
}
export async function getLatestAutoDatasetJob(): Promise<AutoDatasetJob | null> {
  await ensureSchema(); const sql = getDbOrThrow(); const rows = await sql`SELECT * FROM ops_ml_dataset_build_jobs ORDER BY started_at DESC LIMIT 1`; return rows.length ? mapJob(rows[0]) : null;
}

async function runningJobMatches(sql: any, jobId: string, durations: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }>): Promise<boolean> {
  const rows = await sql`SELECT item_index, duration_value, duration_unit, duration_range_id FROM ops_ml_dataset_build_job_items WHERE job_id = ${jobId} ORDER BY item_index`;
  if (rows.length !== durations.length) return false;
  return rows.every((row: any, index: number) => Number(row.item_index) === index && Number(row.duration_value) === durations[index].value && String(row.duration_unit) === durations[index].unit && String(row.duration_range_id) === durations[index].rangeId);
}

export async function createAutoDatasetJob(symbol: string, durations: Array<{ value: number; unit: DerivDurationUnit; rangeId: string }>): Promise<AutoDatasetJob> {
  await ensureSchema(); const sql = getDbOrThrow();
  const running = await sql`SELECT * FROM ops_ml_dataset_build_jobs WHERE symbol = ${symbol} AND status = 'running' ORDER BY started_at DESC LIMIT 1`;
  if (running.length) {
    const existing = running[0];
    if (await runningJobMatches(sql, String(existing.id), durations)) return mapJob(existing);
    await sql`UPDATE ops_ml_dataset_build_jobs SET status = 'failed', failures = ${JSON.stringify([{ value: 0, unit: 't', error: 'Superseded by a new AUTO horizon scope.' }])}::jsonb, finished_at = NOW(), updated_at = NOW() WHERE id = ${existing.id} AND status = 'running'`;
  }
  const id = randomUUID();
  try { await sql`INSERT INTO ops_ml_dataset_build_jobs (id, symbol, status, requested_count) VALUES (${id}, ${symbol}, 'running', ${durations.length})`; }
  catch (error) { const retry = await sql`SELECT * FROM ops_ml_dataset_build_jobs WHERE symbol = ${symbol} AND status = 'running' ORDER BY started_at DESC LIMIT 1`; if (retry.length && await runningJobMatches(sql, String(retry[0].id), durations)) return mapJob(retry[0]); throw error; }
  try {
    if (durations.length) {
      const jobIds = durations.map(() => id), indices = durations.map((_, index) => index), values = durations.map((item) => item.value), units = durations.map((item) => item.unit), rangeIds = durations.map((item) => item.rangeId);
      await sql`INSERT INTO ops_ml_dataset_build_job_items (job_id, item_index, duration_value, duration_unit, duration_range_id) SELECT * FROM UNNEST(${jobIds}::uuid[], ${indices}::integer[], ${values}::integer[], ${units}::text[], ${rangeIds}::text[])`;
    }
  } catch (error) {
    await sql`UPDATE ops_ml_dataset_build_jobs SET status = 'failed', failures = ${JSON.stringify([{ value: 0, unit: 't', error: error instanceof Error ? error.message : String(error) }])}::jsonb, finished_at = NOW(), updated_at = NOW() WHERE id = ${id}`;
    throw error;
  }
  return (await getAutoDatasetJob(id))!;
}
export async function claimNextAutoDatasetJobItem(jobId: string, staleAfterMinutes = 10): Promise<AutoDatasetJobItem | null> {
  await ensureSchema(); const sql = getDbOrThrow();
  const rows = await sql`
    WITH candidate AS (
      SELECT id FROM ops_ml_dataset_build_job_items
      WHERE job_id = ${jobId} AND (status = 'pending' OR (status = 'running' AND claimed_at < NOW() - (${staleAfterMinutes} * INTERVAL '1 minute')))
      ORDER BY item_index FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE ops_ml_dataset_build_job_items AS item
    SET status = 'running', attempts = item.attempts + 1, claimed_at = NOW(), error_message = NULL
    FROM candidate WHERE item.id = candidate.id
    RETURNING item.id, item.item_index, item.duration_value, item.duration_unit, item.duration_range_id, item.attempts
  `;
  if (!rows.length) return null;
  return { id: Number(rows[0].id), itemIndex: Number(rows[0].item_index), value: Number(rows[0].duration_value), unit: rows[0].duration_unit as DerivDurationUnit, rangeId: String(rows[0].duration_range_id), attempts: Number(rows[0].attempts) };
}
export async function completeAutoDatasetJobItem(jobId: string, itemId: number): Promise<void> {
  await ensureSchema(); const sql = getDbOrThrow(); await sql`UPDATE ops_ml_dataset_build_job_items SET status = 'completed', completed_at = NOW(), error_message = NULL WHERE id = ${itemId} AND job_id = ${jobId}`; await refreshAutoDatasetJobStatus(jobId);
}
export async function failAutoDatasetJobItem(jobId: string, itemId: number, error: string): Promise<void> {
  await ensureSchema(); const sql = getDbOrThrow(); await sql`UPDATE ops_ml_dataset_build_job_items SET status = 'failed', completed_at = NOW(), error_message = ${error.slice(0, 2000)} WHERE id = ${itemId} AND job_id = ${jobId}`; await refreshAutoDatasetJobStatus(jobId);
}
export async function refreshAutoDatasetJobStatus(jobId: string): Promise<AutoDatasetJob | null> {
  await ensureSchema(); const sql = getDbOrThrow();
  const rows = await sql`
    WITH counts AS (
      SELECT COUNT(*) FILTER (WHERE status = 'completed')::integer AS completed_count, COUNT(*) FILTER (WHERE status = 'failed')::integer AS failed_count, COUNT(*)::integer AS total_count
      FROM ops_ml_dataset_build_job_items WHERE job_id = ${jobId}
    ), updated AS (
      UPDATE ops_ml_dataset_build_jobs AS job
      SET completed_count = counts.completed_count, failed_count = counts.failed_count,
          failures = COALESCE((SELECT jsonb_agg(jsonb_build_object('value', item.duration_value, 'unit', item.duration_unit, 'error', COALESCE(item.error_message, 'Dataset build failed.')) ORDER BY item.item_index) FROM ops_ml_dataset_build_job_items AS item WHERE item.job_id = job.id AND item.status = 'failed'), '[]'::jsonb),
          status = CASE WHEN counts.total_count > 0 AND counts.completed_count + counts.failed_count >= counts.total_count THEN CASE WHEN counts.completed_count = 0 THEN 'failed' ELSE 'completed' END ELSE 'running' END,
          finished_at = CASE WHEN counts.total_count > 0 AND counts.completed_count + counts.failed_count >= counts.total_count THEN COALESCE(job.finished_at, NOW()) ELSE NULL END,
          updated_at = NOW()
      FROM counts WHERE job.id = ${jobId} RETURNING job.*
    ) SELECT * FROM updated
  `;
  return rows.length ? mapJob(rows[0]) : null;
}
