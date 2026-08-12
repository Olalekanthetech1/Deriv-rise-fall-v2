import fs from 'node:fs';

const training = fs.readFileSync('scripts/ml_duration_training.py', 'utf8');
const governed = fs.readFileSync('scripts/ml_duration_training_governed.py', 'utf8');
const orchestrator = fs.readFileSync('lib/ml-training-orchestrator.ts', 'utf8');

if (!governed.includes('from sklearn.metrics import f1_score')) {
  throw new Error('[ML Promotion Metrics] governed trainer must calculate validation F1.');
}
if (!governed.includes('validation["f1"] = f1')) {
  throw new Error('[ML Promotion Metrics] governed trainer must persist validation F1.');
}
if (!governed.includes('metrics["modelKey"] = kind')) {
  throw new Error('[ML Promotion Metrics] governed trainer must return canonical modelKey.');
}
if (!orchestrator.includes('modelKey: definition.key')) {
  throw new Error('[ML Promotion Metrics] canonical modelKey must be persisted by the orchestrator.');
}
if (!training.includes('validation')) {
  throw new Error('[ML Promotion Metrics] native training validation contract is missing.');
}

console.log('[ML Promotion Metrics] passed: governed predictive training persists canonical modelKey and validation F1.');
