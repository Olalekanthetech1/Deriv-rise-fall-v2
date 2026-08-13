import fs from 'node:fs';

const sources = [
  ['app/api/ml/predict/route.ts', 'ML prediction route'],
  ['app/api/signals/predict/route.ts', 'Signal prediction route'],
  ['components/custom/ai-trader-controls.tsx', 'AI Trader UI'],
  ['lib/production-ensemble.ts', 'Production ensemble'],
  ['lib/production-model-resolver.ts', 'Production model resolver'],
  ['lib/ml-model-artifact-store.ts', 'Durable model artifact store'],
  ['scripts/ml_ensemble_runtime.py', 'Native production ensemble runtime'],
  ['app/admin/final-verification/page.tsx', 'Admin final verification'],
  ['hooks/use-realtime-signals.ts', 'Realtime signal consumer'],
];

const contents = new Map(sources.map(([path]) => [path, fs.readFileSync(path, 'utf8')]));
const mlPredictionRoute = contents.get('app/api/ml/predict/route.ts');
const predictionRoute = contents.get('app/api/signals/predict/route.ts');
const aiTrader = contents.get('components/custom/ai-trader-controls.tsx');
const ensemble = contents.get('lib/production-ensemble.ts');
const resolver = contents.get('lib/production-model-resolver.ts');
const artifactStore = contents.get('lib/ml-model-artifact-store.ts');
const nativeEnsemble = contents.get('scripts/ml_ensemble_runtime.py');
const adminVerification = contents.get('app/admin/final-verification/page.tsx');
const realtimeSignals = contents.get('hooks/use-realtime-signals.ts');
const violations = [];

const require = (text, pattern, message) => {
  if (!pattern.test(text)) violations.push(message);
};

for (const [path, text] of [['app/api/ml/predict/route.ts', mlPredictionRoute], ['app/api/signals/predict/route.ts', predictionRoute]]) {
  require(text, /evaluateProductionEnsemble\(/, `${path} must use the canonical production ensemble`);
  require(text, /Cache-Control.*no-store/, `${path} must disable stale prediction caching`);
}

require(predictionRoute, /strategyGate\.accepted/, 'Signal output must remain gated by the strategy decision boundary');
require(predictionRoute, /correlationId/, 'Signal prediction must expose request correlation for traceability');
require(predictionRoute, /modelVersion/, 'Prediction response must expose model version traceability');
require(predictionRoute, /probabilityUp|probabilityDown/, 'Prediction response must expose model probabilities');
require(predictionRoute, /assetContext/, 'Prediction response must expose asset context');
require(predictionRoute, /isAdminDiagnosticAuthorized/, 'Admin diagnostics must require server-side authorization');
require(predictionRoute, /Native model probability/, 'Prediction data must identify native model probability rather than synthetic win-rate claims');

if (/placeOrder|executeOrder|autoTrade|autotrade/i.test(predictionRoute)) violations.push('Signal prediction route must not own trading execution');

require(aiTrader, /\/api\/signals\/predict/, 'AI Trader must consume the canonical signal prediction API');
require(aiTrader, /strategyGate\.accepted/, 'AI Trader must honor the server-side strategy gate');
if (/models_cache|model_path\(|load_duration|predict_ensemble.*fallback/i.test(aiTrader)) violations.push('AI Trader must not resolve or load ML artifacts directly');

require(ensemble, /resolveProductionModels\(/, 'Production ensemble must delegate production model selection to the canonical resolver');
require(ensemble, /resolveAndMaterializeProductionModel\(/, 'Production ensemble must delegate durable artifact materialization to the canonical resolver');
require(ensemble, /NO_VALIDATED_TRAINED_MODELS_AVAILABLE/, 'Production ensemble must fail closed when no validated production model is executable');

require(resolver, /status = [^\n]*production/, 'Production resolver must select only persisted production models');
require(resolver, /resolveAndMaterializeProductionModel/, 'Production resolver must expose governed artifact materialization');
require(resolver, /hasModelArtifact/, 'Production resolver must verify durable model artifacts');
require(artifactStore, /sha256/, 'Durable artifact store must checksum model artifacts');
require(artifactStore, /BYTEA/, 'Durable artifact store must persist artifact bytes durably');
require(nativeEnsemble, /productionModels/, 'Native ensemble must receive registry-selected production models');
require(nativeEnsemble, /artifactPath/, 'Native ensemble must load the materialized governed artifact');
require(nativeEnsemble, /PROMOTED_MODEL_ARTIFACT_CHECKSUM_MISMATCH/, 'Native ensemble must reject corrupted promoted artifacts');
if (/load_duration|runtime\.predict_one\(\{\*\*request/i.test(nativeEnsemble)) violations.push('Native production ensemble must not fall back to legacy runtime model resolution');

require(adminVerification, /signals\/predict/, 'Final verification must exercise the canonical production signal path');
require(realtimeSignals, /signals\/predict/, 'Realtime signal consumer must use the canonical prediction path');

const retiredTokens = [['xgboost', 'daemon'].join('-'), ['onnx', 'engine'].join('-'), ['multi-model', 'evaluator'].join('')];
for (const [path, text] of contents.entries()) {
  if (retiredTokens.some((token) => text.toLowerCase().includes(token))) violations.push(`${path} -> retired/server ML runtime dependency leaked into prediction/trading integration boundary`);
}

console.log(violations.length
  ? `[Prediction/Trading Integration Invariants] violations detected:\n${violations.join('\n')}`
  : '[Prediction/Trading Integration Invariants] passed: unified production registry, durable artifacts, governed native inference, strategy gating, traceability, and AI Trader/Signal API convergence are enforced.');
if (violations.length) process.exit(1);
