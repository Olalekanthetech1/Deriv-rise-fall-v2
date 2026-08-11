import crypto from 'node:crypto';
import {
  claimNextTrainingJob,
  finishTrainingJob,
  heartbeatTrainingJob,
  recoverStaleTrainingJobs,
  type TrainingQueueJob,
} from '@/lib/ml-training-queue';
import { trainDatasetModels } from '@/lib/ml-training-orchestrator';

type ModelType = Parameters<typeof trainDatasetModels>[0]['modelTypes'];

const workerId = `${process.env.RENDER_INSTANCE_ID?.trim() || 'ml-worker'}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const pollRaw = Number(process.env.ML_WORKER_POLL_INTERVAL_MS || 2000);
const pollMs = Math.max(1000, Math.min(60_000, Number.isFinite(pollRaw) ? Math.trunc(pollRaw) : 2000));
const heartbeatMs = Math.max(5_000, Math.min(60_000, Math.trunc(pollMs * 2)));

let stopping = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heartbeatLoop(job: TrainingQueueJob) {
  while (!stopping) {
    await sleep(heartbeatMs);
    if (stopping) return;
    try {
      await heartbeatTrainingJob(job.jobId, workerId);
    } catch (error) {
      console.error('[ML Worker] heartbeat failed:', error);
    }
  }
}

async function processJob(job: TrainingQueueJob) {
  console.log(`[ML Worker] claimed ${job.jobId} dataset=${job.datasetId} attempt=${job.attempts}`);
  const heartbeat = heartbeatLoop(job);
  try {
    const modelTypes = job.modelTypes.length ? job.modelTypes as ModelType : undefined;
    const result = await trainDatasetModels({ datasetId: job.datasetId, modelTypes });
    await finishTrainingJob(job.jobId, workerId, result.status === 'failed' ? 'failed' : 'completed', result.status === 'failed' ? 'All requested models failed.' : undefined, result.runId);
    console.log(`[ML Worker] completed ${job.jobId} run=${result.runId} status=${result.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTrainingJob(job.jobId, workerId, 'failed', message);
    console.error(`[ML Worker] failed ${job.jobId}: ${message}`);
  }
  void heartbeat;
}

async function main() {
  console.log(`[ML Worker] started id=${workerId} poll=${pollMs}ms`);
  while (!stopping) {
    try {
      await recoverStaleTrainingJobs();
      const job = await claimNextTrainingJob(workerId);
      if (job) {
        await processJob(job);
      } else {
        await sleep(pollMs);
      }
    } catch (error) {
      console.error('[ML Worker] loop error:', error);
      await sleep(Math.min(30_000, pollMs * 2));
    }
  }
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[ML Worker] received ${signal}; stopping after current job.`);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void main().catch((error) => {
  console.error('[ML Worker] fatal:', error);
  process.exitCode = 1;
});
