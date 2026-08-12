import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const api = fs.readFileSync(path.join(root, 'app/api/admin/model-operations/summary/route.ts'), 'utf8');
const queue = fs.readFileSync(path.join(root, 'lib/ml-training-queue.ts'), 'utf8');
const status = fs.readFileSync(path.join(root, 'lib/ml-training-orchestrator.ts'), 'utf8');

const violations = [];

if (!api.includes("verifySessionToken")) violations.push('summary API is missing server-side admin authorization');
if (!api.includes("Cache-Control") || !api.includes('no-store')) violations.push('summary API is missing no-store response policy');
if (!api.includes("getWorkerStatus()")) violations.push('summary API is not connected to the authoritative worker heartbeat');
if (!api.includes("ml_training_job_queue")) violations.push('summary API is not connected to the durable training queue');
if (!api.includes("ml_training_batches")) violations.push('summary API is not connected to persisted training batches');
if (!api.includes("ml_model_registry_v2")) violations.push('summary API is not connected to the persisted model registry');
if (!api.includes("dataSource: 'live-database-plus-dedicated-ml-worker'")) violations.push('summary API does not declare its authoritative data source');
if (!queue.includes('recoverAbandonedTrainingJobs')) violations.push('training queue lost abandoned-job recovery');
if (!queue.includes('heartbeatTrainingJob')) violations.push('training queue lost worker heartbeat support');
if (!status.includes("reconcileStaleTrainingRuns")) violations.push('training orchestration lost stale-run reconciliation');

if (violations.length) {
  throw new Error(`[Model Operations Invariants] violations detected:\n${violations.join('\n')}`);
}

console.log('[Model Operations Invariants] passed: summary boundary is authenticated, source-backed, worker-aware, queue-aware, batch-aware, registry-aware, and stale-run recovery remains intact.');
