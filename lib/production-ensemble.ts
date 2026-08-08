import { EngineeredTickFeatures, extract37TickFeatures, TickPoint } from './ml-feature-extractor';
import { xgboostDaemon } from './xgboost-daemon';

export type Signal = 'RISE' | 'FALL';
export type ModelStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface ProductionEnsembleResult {
  symbol: string;
  direction: Signal;
  probUp: number;
  probDown: number;
  confidence: number;
  marketRegime: string;
  anomalyScore: number;
  features: EngineeredTickFeatures;
  evaluations: Array<{
    modelKey: string;
    modelName: string;
    family: 'tabular' | 'sequential' | 'regime' | 'anomaly';
    status: ModelStatus;
    probabilityUp: number | null;
    probabilityDown: number | null;
    signal: Signal | null;
    confidence: number | null;
    dynamicWeight: number | null;
    runtimeMode: string;
    details: string;
  }>;
  modelBreakdown: Record<string, any>;
  regime: any;
  anomaly: any;
  drift: any;
  calibration: any;
  fusion: any;
  timestamp: number;
}

const PREDICTIVE_MODELS = ['xgboost', 'lightgbm', 'catboost', 'tcn', 'lstm', 'transformer'] as const;
const MODEL_NAMES: Record<string, string> = {
  xgboost: 'XGBoost',
  lightgbm: 'LightGBM',
  catboost: 'CatBoost',
  tcn: 'TCN',
  lstm: 'LSTM / GRU',
  transformer: 'Transformer',
};

function familyForModel(key: string): 'tabular' | 'sequential' {
  return ['xgboost', 'lightgbm', 'catboost'].includes(key) ? 'tabular' : 'sequential';
}

function finiteProbability(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function validationWeight(result: any): number {
  const accuracy = Number(result?.validation?.accuracy);
  const logLoss = Number(result?.validation?.logLoss);
  if (!Number.isFinite(accuracy) || !Number.isFinite(logLoss)) return 1;
  // Weight is derived from the model's persisted validation performance and
  // current probabilistic quality. It is not a fixed per-model weight.
  return Math.max(0.0001, accuracy / (1 + Math.max(0, logLoss)));
}

export async function evaluateProductionEnsemble(
  ticks: TickPoint[],
  options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {}
): Promise<ProductionEnsembleResult> {
  const symbol = options.symbol || 'R_100';
  const durationSecs = options.durationSecs || 5;
  const assetCategory = options.assetCategory || 0;
  const features = extract37TickFeatures(ticks, {
    symbol,
    contractDurationSecs: durationSecs,
    assetCategoryNum: assetCategory,
  });

  const remote = await xgboostDaemon.sendCommand('predict_ensemble', {
    symbol,
    durationSecs,
    assetCategory,
    ticks: ticks.map(t => ({ price: t.price, timestamp: t.timestamp })),
  });

  if (!remote?.success || !remote.models) {
    throw new Error('NATIVE_ML_ENSEMBLE_UNAVAILABLE');
  }

  const evaluations = PREDICTIVE_MODELS.map((key) => {
    const result = remote.models[key];
    const up = result?.success ? finiteProbability(result.probabilityUp) : null;
    const down = result?.success ? finiteProbability(result.probabilityDown) : null;
    const valid = up !== null && down !== null && Math.abs((up + down) - 100) < 0.25;
    return {
      modelKey: key,
      modelName: MODEL_NAMES[key],
      family: familyForModel(key),
      status: valid ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
      probabilityUp: valid ? up : null,
      probabilityDown: valid ? down : null,
      signal: valid ? (up! >= down! ? ('RISE' as const) : ('FALL' as const)) : null,
      confidence: valid ? Math.max(up!, down!) : null,
      dynamicWeight: valid ? validationWeight(result) : null,
      runtimeMode: valid ? 'Native Python trained model' : 'Unavailable — no synthetic fallback',
      details: valid ? String(result.engine || 'Native trained model') : String(result?.error || 'MODEL_UNAVAILABLE'),
      validation: result?.validation || null,
    };
  });

  const available = evaluations.filter(
    (e): e is typeof evaluations[number] & { probabilityUp: number; probabilityDown: number; dynamicWeight: number } =>
      e.status === 'AVAILABLE' && e.probabilityUp !== null && e.probabilityDown !== null && e.dynamicWeight !== null
  );

  if (available.length === 0) {
    throw new Error('NO_TRAINED_MODELS_AVAILABLE');
  }

  const totalWeight = available.reduce((sum, e) => sum + e.dynamicWeight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error('INVALID_MODEL_WEIGHTS');
  }

  const probUp = available.reduce((sum, e) => sum + e.probabilityUp * e.dynamicWeight, 0) / totalWeight;
  const probDown = 100 - probUp;
  const direction: Signal = probUp >= probDown ? 'RISE' : 'FALL';
  const confidence = Math.max(probUp, probDown);

  const hmm = remote.models.hmm;
  const iso = remote.models.isolation_forest;
  const hmmAvailable = hmm?.success === true;
  const isoAvailable = iso?.success === true;
  const marketRegime = hmmAvailable ? String(hmm.primaryRegime) : 'REGIME_UNAVAILABLE';
  const anomalyScore = isoAvailable ? finiteProbability(Number(iso.anomalyScore) * 100) ?? 0 : 0;

  const modelBreakdown: Record<string, any> = {};
  for (const evaluation of evaluations) {
    modelBreakdown[evaluation.modelKey] = {
      modelName: evaluation.modelName,
      runtimeMode: evaluation.runtimeMode,
      status: evaluation.status,
      vote: evaluation.signal,
      confidence: evaluation.confidence,
      probabilityUp: evaluation.probabilityUp,
      probabilityDown: evaluation.probabilityDown,
      weight: evaluation.dynamicWeight,
      details: evaluation.details,
      validation: evaluation.validation,
    };
  }

  if (hmmAvailable) {
    modelBreakdown.hmm = {
      modelName: 'HMM Regime Model',
      status: 'AVAILABLE',
      primaryRegime: hmm.primaryRegime,
      regimeState: hmm.regimeState,
      regimeProbabilities: hmm.regimeProbabilities,
      details: hmm.engine || 'Native trained GaussianHMM',
    };
  } else {
    modelBreakdown.hmm = { modelName: 'HMM Regime Model', status: 'UNAVAILABLE', details: String(hmm?.error || 'MODEL_UNAVAILABLE') };
  }

  if (isoAvailable) {
    modelBreakdown.isolation_forest = {
      modelName: 'Isolation Forest',
      status: 'AVAILABLE',
      anomalyScore: iso.anomalyScore,
      isAnomaly: Boolean(iso.isAnomaly),
      details: iso.engine || 'Native trained IsolationForest',
    };
  } else {
    modelBreakdown.isolation_forest = { modelName: 'Isolation Forest', status: 'UNAVAILABLE', details: String(iso?.error || 'MODEL_UNAVAILABLE') };
  }

  const normalizedWeights = Object.fromEntries(
    available.map(e => [e.modelKey, Number((e.dynamicWeight / totalWeight).toFixed(6))])
  );

  return {
    symbol,
    direction,
    probUp: Number(probUp.toFixed(2)),
    probDown: Number(probDown.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    marketRegime,
    anomalyScore: Number((anomalyScore / 100).toFixed(4)),
    features,
    evaluations,
    modelBreakdown,
    regime: hmmAvailable ? hmm : { status: 'UNAVAILABLE', error: hmm?.error || 'MODEL_UNAVAILABLE' },
    anomaly: isoAvailable ? iso : { status: 'UNAVAILABLE', error: iso?.error || 'MODEL_UNAVAILABLE' },
    drift: {
      modelWeights: normalizedWeights,
      recentAccuracies: Object.fromEntries(available.map(e => [e.modelKey, e.validation?.accuracy ?? null])),
      driftStatus: 'Weights derived from persisted native-model validation metrics',
      topPerformingModel: available.slice().sort((a, b) => b.dynamicWeight - a.dynamicWeight)[0].modelKey,
    },
    calibration: {
      rawProbability: direction === 'RISE' ? probUp : probDown,
      calibratedProbability: direction === 'RISE' ? probUp : probDown,
      confidenceReductionPct: 0,
      plattScaledProbability: null,
      isotonicProbability: null,
      expectedCalibrationError: null,
      method: 'UNAVAILABLE_UNTIL_TRAINED_CALIBRATION_DATA',
    },
    fusion: {
      directionScore: Number(confidence.toFixed(2)),
      direction,
      regimeState: marketRegime,
      anomalyRisk: isoAvailable ? (Number(iso.anomalyScore) >= 0.7 ? 'HIGH' : Number(iso.anomalyScore) >= 0.4 ? 'MODERATE' : 'LOW') : 'UNKNOWN',
      finalCompositeScore: Number(confidence.toFixed(2)),
      confidenceGateThreshold: null,
      gatePassed: true,
      action: direction === 'RISE' ? 'EXECUTE_CALL' : 'EXECUTE_PUT',
    },
    timestamp: Date.now(),
  };
}