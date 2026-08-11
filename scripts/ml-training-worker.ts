import crypto from 'node:crypto';
import {
  claimNextTrainingJob,
  finishTrainingJob,
  heartbeatTrainingJob,
  recoverAbandonedTrainingJobs,
  recordWorkerHeartbeat,
  type TrainingQueueJob,
} from '@/lib/ml-training-queue';
import { trainDatasetModels } from '@/lib/ml-training-orchestrator';

type ModelType = Parameters<typeof trainDatasetModels>[0]['modelTypes'];

const workerId = `${process.env.RENDER_INSTANCE_ID?.trim() || 'ml-worker'}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const pollRaw = Number(process.env.ML_WORKER_POLL_INTERVAL_MS || 2000);
const pollMs = Math.max(1000, Math.min(60_000, Number.isFinite(pollRaw) ? Math.trunc(pollRaw) : 2000));
const heartbeatRaw = Number(process.env.ML_WORKER_HEARTBEAT_INTERVAL_MS || 5000);
const heartbeatMs = Math.max(2000, Math.min(30_000, Number.isFinite(heartbeatRaw) ? Math.trunc(heartbeatRaw) : 5000));
let stopping = false;
let activeJob: TrainingQueueJob | null = null;
let stopActiveHeartbeat: (() => void) | null = null;

// Keep native BLAS/OpenMP runtimes conservative on small Render instances.
// These are inherited by the Python daemon when it is spawned by Node.
process.env.OMP_NUM_THREADS = process.env.OMP_NUM_THREADS || '1';
process.env.OPENBLAS_NUM_THREADS = process.env.OPENBLAS_NUM_THREADS || '1';
process.env.MKL_NUM_THREADS = process.env.MKL_NUM_THREADS || '1';
process.env.NUMEXPR_NUM_THREADS = process.env.NUMEXPR_NUM_THREADS || '1';
process.env.TORCH_NUM_THREADS = process.env.TORCH_NUM_THREADS || '1';

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function startJobHeartbeat(job: TrainingQueueJob) {
  let active = true;
  const beat = async () => {
    if (!active || stopping) return;
    try {
      await heartbeatTrainingJob(job.jobId, workerId);
      await recordWorkerHeartbeat(workerId, 'online');
    } catch (error) {
      console.error('[ML Worker] heartbeat failed:', error);
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), heartbeatMs);
  return () => {
    active = false;
    clearInterval(timer);
  };
}

async function processJob(job: TrainingQueueJob) {
  activeJob = job;
  stopActiveHeartbeat = startJobHeartbeat(job);
  console.log(`[ML Worker] claimed ${job.jobId} dataset=${job.datasetId} attempt=${job.attempts} pid=${process.pid}`);
  try {
    const modelTypes = job.modelTypes.length ? job.modelTypes as ModelType : undefined;
    const result = await trainDatasetModels({ datasetId: job.datasetId, modelTypes });
    const queueStatus = result.status === 'failed' ? 'failed' : 'completed';
    await finishTrainingJob(job.jobId, workerId, queueStatus, result.status === 'failed' ? 'All requested models failed.' : undefined, result.runId, {
      trainingRunId: result.runId,
      status: result.status,
      completedModels: result.completedModels,
      failedModels: result.failedModels,
    });
    console.log(`[ML Worker] completed ${job.jobId} run=${result.runId} status=${result.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await finishTrainingJob(job.jobId, workerId, 'failed', message);
    } catch (finishError) {
      console.error('[ML Worker] could not persist failed job state:', finishError);
    }
    console.error(`[ML Worker] failed ${job.jobId}: ${message}`);
  } finally {
    stopActiveHeartbeat?.();
    stopActiveHeartbeat = null;
    activeJob = null;
  }
}

async function main() {
  console.log(`[ML Worker] started id=${workerId} pid=${process.pid} poll=${pollMs}ms heartbeat=${heartbeatMs}ms`);
  await recordWorkerHeartbeat(workerId, 'online');
  while (!stopping) {
    try {
      await recordWorkerHeartbeat(workerId, 'online');
      const recovered = await recoverAbandonedTrainingJobs();
      if (recovered > 0) console.warn(`[ML Worker] recovered ${recovered} abandoned job(s) after worker lease expiry.`);
      const job = await claimNextTrainingJob(workerId);
      if (job) await processJob(job);
      else await sleep(pollMs);
    } catch (error) {
      console.error('[ML Worker] loop error:', error);
      await sleep(Math.min(30_000, pollMs * 2));
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  stopActiveHeartbeat?.();
  try { await recordWorkerHeartbeat(workerId, 'stopping'); } catch { /* best effort */ }
  console.warn(`[ML Worker] received ${signal}; activeJob=${activeJob?.jobId || 'none'}; allowing lease recovery if Render terminates the process.`);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('uncaughtException', (error) => {
  console.error('[ML Worker] uncaught exception:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[ML Worker] unhandled rejection:', reason);
});

void main().catch(async (error) => {
  console.error('[ML Worker] fatal:', error);
  try { await recordWorkerHeartbeat(workerId, 'stopping'); } catch { /* best effort */ }
  process.exitCode = 1;
});
