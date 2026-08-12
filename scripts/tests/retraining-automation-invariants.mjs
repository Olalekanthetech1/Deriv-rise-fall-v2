import fs from 'node:fs';

const routePath = 'app/api/admin/retraining/route.ts';
const pagePath = 'app/admin/retraining/page.tsx';
const route = fs.readFileSync(routePath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');
const violations = [];

const requireRoute = (pattern, description) => {
  if (!pattern.test(route)) violations.push(`${routePath} -> ${description}`);
};

requireRoute(/function isAdmin\(req: NextRequest\)/, 'canonical admin authentication boundary missing');
requireRoute(/Cache-Control.*no-store/, 'no-store cache policy missing');
requireRoute(/listDurationTrainingDatasets\(/, 'duration-aware dataset discovery missing');
requireRoute(/isEligibleDataset\(/, 'eligible dataset gate missing');
requireRoute(/leakage_check_passed === true/, 'leakage validation gate missing');
requireRoute(/enqueueTrainingJob\(/, 'durable queue dispatch missing');
requireRoute(/resolveLiveSymbols\(/, 'live Deriv symbol resolution missing');
requireRoute(/RETRAINING_INTERVAL_NOT_DUE/, 'schedule eligibility guard missing');
requireRoute(/source: 'admin-retraining-control-plane'/, 'authoritative control-plane source marker missing');

if (page.includes('/api/ml/cron-retrain')) violations.push(`${pagePath} -> legacy cron-retrain API is still referenced`);
if (!page.includes('/api/admin/retraining')) violations.push(`${pagePath} -> canonical Admin retraining API is not used`);
if (!page.includes('Model Operations · Automation')) violations.push(`${pagePath} -> migrated Admin module branding missing`);

if (violations.length) {
  throw new Error(`[Retraining Automation Invariants] violations detected:\n${violations.join('\n')}`);
}

console.log('[Retraining Automation Invariants] passed: canonical Admin authentication, authoritative queue dispatch, duration-aware eligibility and legacy API isolation are intact.');
