import crypto from 'node:crypto';
import {
  claimNextTrainingJob,
  finishTrainingJob,
  heartbeatTrainingJob,
  recoverStaleTrainingJobs,
  recordWorkerHeartbeat,
  type TrainingQueueJob,
} from '@/lib/ml-training-queue';
import { trainDatasetModels } from '@/lib/ml-training-orchestrator';

type ModelType = Parameters<typeof trainDatasetModels>[0]['modelTypes'];

const workerId = `${process.env.RENDER_INSTANCE_ID?.trim() || 'ml-worker'}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const pollRaw = Number(process.env.ML_WORKER_POLL_INTERVAL_MS || 2000);
const pollMs = Math.max(1000, Math.min(60_000, Number.isFinite(pollRaw) ? Math.trunc(pollRaw) : 2000));
const heartbeatMs = Math.max(5_000, Math.min(60_000, Math.trunc(pollMs * 2)));
let stopping = false;

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function startJobHeartbeat(job: TrainingQueueJob) {
  let active = true;
  const loop = async () => {
    while (active && !stopping) {
      await sleep(heartbeatMs);
      if (!active || stopping) return;
      try {
        await heartbeatTrainingJob(job.jobId, workerId);
        await recordWorkerHeartbeat(workerId, 'online');
      } catch (error) {
        console.error('[ML Worker] heartbeat failed:', error);
      }
    }
  };
  void loop();
  return () => { active = false; };
}

async function processJob(job: TrainingQueueJob) {
  console.log(`[ML Worker] claimed ${job.jobId} dataset=${job.datasetId} attempt=${job.attempts}`);
  const stopHeartbeat = startJobHeartbeat(job);
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
    await finishTrainingJob(job.jobId, workerId, 'failed', message);
    console.error(`[ML Worker] failed ${job.jobId}: ${message}`);
  } finally {
    stopHeartbeat();
  }
}

async function main() {
  console.log(`[ML Worker] started id=${workerId} poll=${pollMs}ms`);
  await recordWorkerHeartbeat(workerId, 'online');
  while (!stopping) {
    try {
      await recordWorkerHeartbeat(workerId, 'online');
      await recoverStaleTrainingJobs();
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
  try { await recordWorkerHeartbeat(workerId, 'stopping'); } catch { /* best effort */ }
  console.log(`[ML Worker] received ${signal}; stopping after current job.`);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

void main().catch(async (error) => {
  console.error('[ML Worker] fatal:', error);
  try { await recordWorkerHeartbeat(workerId, 'stopping'); } catch { /* best effort */ }
  process.exitCode = 1;
});
