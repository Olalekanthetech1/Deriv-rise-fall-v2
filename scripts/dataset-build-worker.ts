import crypto from 'node:crypto';
import { getDbOrThrow } from '@/lib/db';
import { migrateHistoricalFeasibilityFailures, getAutoDatasetJob, claimNextAutoDatasetJobItem, getAutoDatasetJobItemStatus, completeAutoDatasetJobItem, failAutoDatasetJobItem, skipAutoDatasetJobItem, discardAutoDatasetBuild, refreshAutoDatasetJobStatus } from '@/lib/auto-dataset-job-store';
import { listDurationTrainingDatasets, buildDurationTrainingDataset } from '@/lib/training-dataset-builder-duration-v2';
import type { DerivDurationUnit } from '@/lib/deriv-duration-registry';

const workerId = `dataset-worker:${process.env.RENDER_INSTANCE_ID?.trim() || 'local'}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const pollMs = Math.max(1000, Math.min(60000, Number(process.env.DATASET_WORKER_POLL_INTERVAL_MS || 2000)));
const staleAfterMinutes = Math.max(2, Math.min(30, Number(process.env.DATASET_WORKER_STALE_AFTER_MINUTES || 10)));
const heartbeatMs = Math.max(5000, Math.min(120000, Number(process.env.DATASET_WORKER_HEARTBEAT_MS || 30000)));
let stopping = false;
let activeItem: { jobId: string; itemId: number } | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function feasibility(message: string) {
  return /^(No persisted real ticks can satisfy|No non-flat directional samples could be constructed|Temporal split validation failed|Insufficient real Deriv ticks|The duration-aware feature window requires)/i.test(message.trim());
}

async function heartbeat() {
  if (!activeItem) return;
  try {
    const sql = getDbOrThrow();
    await sql`UPDATE ops_ml_dataset_build_job_items SET claimed_at = NOW() WHERE id = ${activeItem.itemId} AND job_id = ${activeItem.jobId} AND status = 'running'`;
  } catch (error) {
    console.error('[Dataset Worker] heartbeat failed:', error);
  }
}

function startHeartbeat(jobId: string, itemId: number) {
  activeItem = { jobId, itemId };
  void heartbeat();
  heartbeatTimer = setInterval(() => void heartbeat(), heartbeatMs);
}
function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  activeItem = null;
}

async function runningJobIds(): Promise<string[]> {
  const sql = getDbOrThrow();
  const rows = await sql`SELECT id FROM ops_ml_dataset_build_jobs WHERE status = 'running' AND archived_at IS NULL ORDER BY started_at ASC`;
  return rows.map((row: any) => String(row.id));
}

async function processJob(jobId: string): Promise<boolean> {
  const job = await getAutoDatasetJob(jobId);
  if (!job || job.status !== 'running') return false;
  const existingDatasets = await listDurationTrainingDatasets(job.symbol);
  const existingIds = new Set(existingDatasets
    .filter((dataset: any) => dataset?.status === 'completed' && dataset?.leakage_check_passed === true && Number(dataset?.sample_count ?? 0) > 0)
    .map((dataset: any) => `${String(dataset.duration_unit)}:${Number(dataset.duration_value)}`));

  const item = await claimNextAutoDatasetJobItem(jobId, staleAfterMinutes);
  if (!item) {
    await refreshAutoDatasetJobStatus(jobId);
    return false;
  }

  startHeartbeat(jobId, item.id);
  try {
    const identity = `${item.unit}:${item.value}`;
    if (existingIds.has(identity)) {
      await skipAutoDatasetJobItem(jobId, item.id, `ALREADY_EXISTS: a completed leakage-safe dataset already exists for ${job.symbol} at ${item.value}${item.unit}.`);
      return true;
    }

    const result = await buildDurationTrainingDataset({
      symbol: job.symbol,
      durationValue: item.value,
      durationUnit: item.unit,
      durationRangeId: item.rangeId ?? undefined,
    });
    const status = await getAutoDatasetJobItemStatus(jobId, item.id);
    if (status === 'cancelled') {
      await discardAutoDatasetBuild(result.datasetId);
      await refreshAutoDatasetJobStatus(jobId);
      return true;
    }
    await completeAutoDatasetJobItem(jobId, item.id);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (feasibility(message)) await skipAutoDatasetJobItem(jobId, item.id, message);
    else await failAutoDatasetJobItem(jobId, item.id, message);
    return true;
  } finally {
    stopHeartbeat();
  }
}

async function main() {
  console.log(`[Dataset Worker] started id=${workerId} poll=${pollMs}ms stale=${staleAfterMinutes}m heartbeat=${heartbeatMs}ms`);
  try {
    const migrated = await migrateHistoricalFeasibilityFailures();
    if (migrated > 0) console.log(`[Dataset Worker] migrated ${migrated} historical feasibility job(s).`);
  } catch (error) {
    console.error('[Dataset Worker] historical migration failed:', error);
    await sleep(Math.min(30000, pollMs * 2));
  }
  while (!stopping) {
    try {
      const jobs = await runningJobIds();
      let progressed = false;
      for (const jobId of jobs) {
        if (stopping) break;
        if (await processJob(jobId)) progressed = true;
      }
      if (!progressed) await sleep(pollMs);
    } catch (error) {
      console.error('[Dataset Worker] loop error:', error);
      await sleep(Math.min(30000, pollMs * 2));
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.warn(`[Dataset Worker] received ${signal}; activeItem=${activeItem ? `${activeItem.jobId}/${activeItem.itemId}` : 'none'}.`);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('uncaughtException', (error) => console.error('[Dataset Worker] uncaught exception:', error));
process.on('unhandledRejection', (reason) => console.error('[Dataset Worker] unhandled rejection:', reason));
void main().catch((error) => { console.error('[Dataset Worker] fatal:', error); process.exitCode = 1; });
