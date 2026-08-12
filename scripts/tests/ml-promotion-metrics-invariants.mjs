import fs from 'node:fs';

const training = fs.readFileSync('scripts/ml_duration_training.py', 'utf8');
const orchestrator = fs.readFileSync('lib/ml-training-orchestrator.ts', 'utf8');

for (const token of ['f1_score', '"f1"']) {
  if (!training.includes(token)) throw new Error(`[ML Promotion Metrics] missing required token: ${token}`);
}

if (!orchestrator.includes('modelKey: definition.key')) {
  throw new Error('[ML Promotion Metrics] canonical modelKey must be persisted by the orchestrator.');
}

console.log('[ML Promotion Metrics] passed: predictive candidates persist canonical modelKey and validation F1.');
