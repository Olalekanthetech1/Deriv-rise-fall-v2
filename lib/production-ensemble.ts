import { EngineeredTickFeatures, extract37TickFeatures, TickPoint } from './ml-feature-extractor';
import { xgboostEngine } from './xgboost-engine';
import { lightgbmEngine } from './lightgbm-engine';
import { catboostEngine } from './catboost-engine';
import { tcnEngine } from './tcn-engine';
import { lstmEngine } from './lstm-engine';
import { transformerEngine } from './transformer-engine';
import { hmmEngine } from './hmm-engine';
import { isolationForestEngine } from './isolation-forest-engine';
import { xgboostDaemon } from './xgboost-daemon';

export type Signal = 'RISE' | 'FALL';
export interface ProductionEnsembleResult {
  symbol: string; direction: Signal; probUp: number; probDown: number; confidence: number;
  marketRegime: string; anomalyScore: number; features: EngineeredTickFeatures;
  evaluations: Array<{ modelKey: string; modelName: string; probabilityUp: number; probabilityDown: number; signal: Signal; confidence: number; dynamicWeight: number; runtimeMode: string; details: string }>;
  modelBreakdown: Record<string, any>; regime: any; anomaly: any; drift: any; calibration: any; fusion: any; timestamp: number;
}

const MODEL_KEYS = ['xgboost','lightgbm','catboost','tcn','lstm','transformer'];
const FALLBACK_WEIGHT = 1 / MODEL_KEYS.length;

function fallbackPredictions(ticks: TickPoint[], opts: any) {
  const x = xgboostEngine.predict(ticks, opts);
  const l = lightgbmEngine.predict(ticks, opts);
  const c = catboostEngine.predict(ticks, opts);
  const t = tcnEngine.predict(ticks, opts);
  const r = lstmEngine.predict(ticks, opts);
  const tr = transformerEngine.predict(ticks, opts);
  return {
    xgboost: x.signal === 'CALL' ? x.confidence : 100 - x.confidence,
    lightgbm: l.probabilityUp,
    catboost: c.probabilityUp,
    tcn: t.probabilityUp,
    lstm: r.probabilityUp,
    transformer: tr.probabilityUp,
  };
}

export async function evaluateProductionEnsemble(ticks: TickPoint[], options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {}): Promise<ProductionEnsembleResult> {
  const symbol = options.symbol || 'R_100';
  const durationSecs = options.durationSecs || 5;
  const assetCategory = options.assetCategory || 0;
  const opts = { symbol, durationSecs, assetCategory };
  const features = extract37TickFeatures(ticks, { symbol, contractDurationSecs: durationSecs, assetCategoryNum: assetCategory });

  const fallback = fallbackPredictions(ticks, opts);
  let remote: any = null;
  try {
    remote = await xgboostDaemon.sendCommand('predict_ensemble', {
      symbol, durationSecs, assetCategory, ticks: ticks.map(t => ({ price: t.price, timestamp: t.timestamp })),
    });
  } catch { remote = null; }

  const evaluations = MODEL_KEYS.map((key) => {
    const r = remote?.models?.[key];
    const up = r?.success ? Number(r.probabilityUp) : Number(fallback[key as keyof typeof fallback]);
    const safeUp = Math.max(0, Math.min(100, Number.isFinite(up) ? up : 50));
    const down = 100 - safeUp;
    return {
      modelKey: key,
      modelName: key.toUpperCase(),
      probabilityUp: Number(safeUp.toFixed(2)),
      probabilityDown: Number(down.toFixed(2)),
      signal: safeUp >= 50 ? 'RISE' as const : 'FALL' as const,
      confidence: Number(Math.max(safeUp, down).toFixed(2)),
      dynamicWeight: FALLBACK_WEIGHT,
      runtimeMode: r?.success ? 'Native Python trained model' : 'Deterministic TypeScript fallback',
      details: r?.engine || 'Fallback engine used because a production model is not loaded',
    };
  });

  const weights = evaluations.map(e => e.dynamicWeight);
  const total = weights.reduce((a,b) => a+b, 0) || 1;
  const probUp = evaluations.reduce((sum,e,i) => sum + e.probabilityUp * weights[i], 0) / total;
  const probDown = 100 - probUp;
  const direction: Signal = probUp >= 50 ? 'RISE' : 'FALL';
  const confidence = Number(Math.max(probUp, probDown).toFixed(2));
  const hmm = remote?.models?.hmm?.success ? remote.models.hmm : hmmEngine.evaluateRegime(ticks, opts);
  const iso = remote?.models?.isolation_forest?.success ? remote.models.isolation_forest : isolationForestEngine.detectAnomaly(ticks, opts);
  const anomalyScore = Number(iso?.anomalyScore || 0);
  const marketRegime = hmm?.primaryRegime || hmm?.regimeName || 'UNKNOWN';

  return {
    symbol, direction, probUp: Number(probUp.toFixed(2)), probDown: Number(probDown.toFixed(2)), confidence,
    marketRegime, anomalyScore, features, evaluations,
    modelBreakdown: Object.fromEntries(evaluations.map(e => [e.modelKey, e])),
    regime: hmm, anomaly: iso,
    drift: { modelWeights: Object.fromEntries(evaluations.map(e => [e.modelKey, e.dynamicWeight])), recentAccuracies: {}, driftStatus: remote ? 'Native ensemble runtime active' : 'Fallback runtime active', topPerformingModel: evaluations.slice().sort((a,b) => b.confidence-a.confidence)[0]?.modelKey || 'xgboost' },
    calibration: { rawProbability: direction === 'RISE' ? probUp : probDown, calibratedProbability: direction === 'RISE' ? probUp : probDown, method: 'identity-until-calibration-dataset-is-available' },
    fusion: { directionScore: confidence, direction, regimeState: marketRegime, anomalyRisk: anomalyScore >= .7 ? 'HIGH' : anomalyScore >= .4 ? 'MODERATE' : 'LOW', finalCompositeScore: confidence, confidenceGateThreshold: 0, gatePassed: true, action: direction === 'RISE' ? 'EXECUTE_CALL' : 'EXECUTE_PUT' },
    timestamp: Date.now(),
  };
}
