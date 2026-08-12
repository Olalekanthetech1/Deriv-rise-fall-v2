import fs from 'node:fs';

const routePath = 'app/api/admin/retraining/route.ts';
const pagePath = 'app/admin/retraining/page.tsx';
const legacyRoutePath = 'app/api/ml/cron-retrain/route.ts';
const route = fs.readFileSync(routePath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');
const violations = [];

const requireRoute = (pattern, description) => {
  if (!pattern.test(route)) violations.push(`${routePath} -> ${description}`);
};

requireRoute(/verifySessionToken/, 'admin authentication boundary missing');
requireRoute(/Cache-Control.*no-store/, 'no-store response policy missing');
requireRoute(/initDbSchema\(\)/, 'database readiness gate missing');
requireRoute(/enqueueTrainingJob/, 'durable ML queue dispatch missing');
requireRoute(/listDurationTrainingDatasets/, 'duration-aware dataset selection missing');
requireRoute(/leakage_check_passed/, 'dataset leakage eligibility gate missing');
requireRoute(/ALL_ASSETS/, 'fleet retraining scope missing');
requireRoute(/force === true/, 'explicit forced-run control missing');
requireRoute(/TRAINING_ALREADY_RUNNING|already running/i, 'active-training conflict handling missing');
requireRoute(/Cache-Control.*no-store/, 'scheduler status must not be cached');

if (!page.includes("'/api/admin/retraining'")) {
  violations.push(`${pagePath} -> canonical Admin retraining API not used`);
}
if (page.includes("'/api/ml/cron-retrain'")) {
  violations.push(`${pagePath} -> legacy cron-retrain API reference remains`);
}
if (fs.existsSync(legacyRoutePath)) {
  violations.push(`${legacyRoutePath} -> retired legacy retraining route still exists`);
}
if (page.includes('/admin/legacy')) {
  violations.push(`${pagePath} -> legacy Admin route reference remains`);
}

if (violations.length) {
  throw new Error(`[Retraining Automation Invariants] violations detected:\n${violations.join('\n')}`);
}

console.log('[Retraining Automation Invariants] passed: canonical Admin API, authenticated scheduler visibility, durable queue dispatch, dataset eligibility and legacy-route removal are intact.');
