import fs from 'node:fs';

const predictionRoutePath = 'app/api/signals/predict/route.ts';
const ensemblePath = 'lib/production-ensemble.ts';
const adminVerificationPath = 'app/admin/final-verification/page.tsx';
const realtimeSignalsPath = 'hooks/use-realtime-signals.ts';

const predictionRoute = fs.readFileSync(predictionRoutePath, 'utf8');
const ensemble = fs.readFileSync(ensemblePath, 'utf8');
const adminVerification = fs.readFileSync(adminVerificationPath, 'utf8');
const realtimeSignals = fs.readFileSync(realtimeSignalsPath, 'utf8');
const violations = [];

const require = (text, pattern, message) => {
  if (!pattern.test(text)) violations.push(message);
};

require(predictionRoute, /evaluateProductionEnsemble\(/, 'Signal prediction must use the canonical production ensemble');
require(predictionRoute, /strategyGate\.accepted/, 'Signal output must remain gated by the strategy decision boundary');
require(predictionRoute, /correlationId/, 'Signal prediction must expose request correlation for traceability');
require(predictionRoute, /modelVersion/, 'Prediction response must expose model version traceability');
require(predictionRoute, /probabilityUp|probabilityDown/, 'Prediction response must expose model probabilities');
require(predictionRoute, /assetContext/, 'Prediction response must expose asset context');
require(predictionRoute, /diagnostic.*isAdminDiagnosticAuthorized|isAdminDiagnosticAuthorized.*diagnostic/, 'Admin diagnostics must require server-side authorization');
require(predictionRoute, /Cache-Control.*no-store/, 'Prediction responses must not be served from stale caches');
require(predictionRoute, /Native model probability/, 'Prediction UI data must identify native model probability rather than synthetic win-rate claims');

if (/placeOrder|executeOrder|autoTrade|autotrade/i.test(predictionRoute)) {
  violations.push(`${predictionRoutePath} -> prediction route must not own trading execution`);
}

require(ensemble, /assetContext/, 'Production ensemble must resolve asset-aware context');
require(ensemble, /strategyGate/, 'Production ensemble must apply a strategy gate');
require(ensemble, /modelBreakdown/, 'Production ensemble must preserve model-level traceability');
require(ensemble, /features/, 'Production ensemble must expose feature lineage for diagnostics');
require(adminVerification, /signals\/predict/, 'Final verification must exercise the canonical production signal path');
require(realtimeSignals, /signals\/predict/, 'Realtime signal consumer must use the canonical prediction path');

for (const [path, text] of Object.entries({ predictionRoutePath, ensemblePath, adminVerificationPath, realtimeSignalsPath }).map(([key]) => [key, eval(key)])) {
  if (/xgboost-daemon|onnx-engine|multi-model-evaluator/.test(text)) {
    violations.push(`${path} -> retired/server ML runtime dependency leaked into prediction/trading integration boundary`);
  }
}

console.log(violations.length
  ? `[Prediction/Trading Integration Invariants] violations detected:\n${violations.join('\n')}`
  : '[Prediction/Trading Integration Invariants] passed: canonical ensemble, strategy gating, traceability, diagnostic authorization, no-store responses, and execution-boundary separation are enforced.');
if (violations.length) process.exit(1);
