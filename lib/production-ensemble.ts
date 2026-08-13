import { EngineeredTickFeatures, extractTickFeatures, featureObjToArray, TickPoint } from './ml-feature-extractor';
import { buildFeatureSequence } from './ml-feature-dataset';
import { getMlModelDefinition, getMlModelKeys, getPredictiveModelDefinitions, type MlModelKey } from './ml-model-registry';
import { mlRuntimeClient } from './ml-runtime-client';
import { evaluateSignalStrategyGate, resolveAssetAwareSignalContext, type AssetAwareSignalContext, type SignalStrategyGate } from './asset-context';
import { getDb } from './db';

export type Signal = 'RISE' | 'FALL';
export type ModelStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface ProductionEnsembleResult {
  symbol: string;
  direction: Signal;
  probUp: number;
  probDown: number;
  confidence: number;
  marketRegime: string;
  anomalyScore: number | null;
  assetContext: AssetAwareSignalContext;
  strategyGate: SignalStrategyGate;
  features: EngineeredTickFeatures;
  evaluations: Array<{ modelKey: string; modelName: string; family: 'tabular' | 'sequential'; status: ModelStatus; probabilityUp: number | null; probabilityDown: number | null; signal: Signal | null; confidence: number | null; dynamicWeight: number | null; runtimeMode: string; details: string; validation: any }>;
  modelBreakdown: Record<string, any>;
  regime: any;
  anomaly: any;
  drift: any;
  calibration: any;
  fusion: any;
  timestamp: number;
}

type AvailableEvaluation = Omit<ProductionEnsembleResult['evaluations'][number], 'modelKey' | 'probabilityUp' | 'probabilityDown' | 'signal' | 'confidence' | 'dynamicWeight'> & {
  modelKey: MlModelKey;
  probabilityUp: number;
  probabilityDown: number;
  signal: Signal;
  confidence: number;
  dynamicWeight: number;
};

function finiteProbability(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

function validationWeight(result: any): number | null {
  const accuracy = Number(result?.validation?.accuracy);
  const logLoss = Number(result?.validation?.logLoss);
  if (!Number.isFinite(accuracy) || !Number.isFinite(logLoss) || logLoss < 0) return null;
  const weight = accuracy / (1 + logLoss);
  return Number.isFinite(weight) && weight > 0 ? weight : null;
}

async function resolveProductionModels(symbol: string, durationValue: number, durationUnit: string) {
  const sql = getDb();
  if (!sql) throw new Error('PRODUCTION_MODEL_REGISTRY_UNAVAILABLE');

  const rows = await sql`
    SELECT model_id, model_family, asset_symbol, duration_value, duration_unit,
           duration_seconds, horizon_ticks, feature_schema_version, framework,
           training_run_id, metrics, format
    FROM ml_model_registry_v2
    WHERE asset_symbol = ${symbol}::varchar
      AND duration_value = ${durationValue}::integer
      AND duration_unit = ${durationUnit}::varchar
      AND status = 'production'
    ORDER BY updated_at DESC
  `;

  const productionModels: Record<string, any> = {};
  for (const row of rows as any[]) {
    const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
    const persistedKey = String(metrics.modelKey || '').trim().toLowerCase();
    const familyKey = String(row.model_family || '').trim().toLowerCase();
    const modelKey = persistedKey || familyKey;
    const definition = getMlModelDefinition(modelKey);
    if (!definition || definition.family === 'regime' || definition.family === 'anomaly') continue;
    if (productionModels[modelKey]) continue;

    productionModels[modelKey] = {
      modelId: String(row.model_id),
      modelKey,
      trainingRunId: row.training_run_id ? String(row.training_run_id) : null,
      durationValue: Number(row.duration_value),
      durationUnit: String(row.duration_unit),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      horizonTicks: row.horizon_ticks == null ? null : Number(row.horizon_ticks),
      featureSchemaVersion: String(row.feature_schema_version || ''),
      framework: String(row.framework || ''),
      format: String(row.format || ''),
      validation: metrics,
    };
  }

  if (!Object.keys(productionModels).length) {
    throw new Error('NO_PRODUCTION_MODEL_REGISTERED');
  }
  return productionModels;
}

export async function evaluateProductionEnsemble(
  ticks: TickPoint[],
  options: { symbol?: string; durationSecs?: number; assetCategory?: number; durationValue?: number; durationUnit?: 't' | 's' | 'm' | 'h' | 'd'; assetClass?: string; marketType?: string; requiredContextTicks?: number } = {},
): Promise<ProductionEnsembleResult> {
  const symbol = options.symbol?.trim();
  if (!symbol) throw new Error('SYMBOL_REQUIRED');
  const durationSecs = options.durationSecs;
  if (!Number.isFinite(durationSecs) || Number(durationSecs) <= 0) throw new Error('DURATION_REQUIRED');
  const durationValue = Number(options.durationValue);
  const durationUnit = options.durationUnit;
  if (!Number.isSafeInteger(durationValue) || durationValue <= 0 || !durationUnit) throw new Error('DURATION_METADATA_REQUIRED');

  const assetCategory = options.assetCategory ?? (symbol.startsWith('FRX') ? 1 : symbol.startsWith('CWM') ? 2 : 0);
  const featureContext = { symbol, durationSecs: Number(durationSecs), assetCategory };
  const features = extractTickFeatures(ticks, { symbol, contractDurationSecs: Number(durationSecs), assetCategoryNum: assetCategory });
  const featureVector = featureObjToArray(features);
  const featureSequence = await buildFeatureSequence(ticks, featureContext);

  const assetContext = resolveAssetAwareSignalContext({
    symbol,
    durationValue,
    durationUnit,
    durationSeconds: Number(durationSecs),
    assetCategory,
    assetClass: options.assetClass,
    marketType: options.marketType,
    tickCount: ticks.length,
    requiredContextTicks: options.requiredContextTicks ?? Math.max(25, featureSequence.length || 25),
  });

  const predictiveModels = getPredictiveModelDefinitions();
  const productionModels = await resolveProductionModels(symbol, durationValue, durationUnit);
  const productionModelKeys = Object.keys(productionModels).filter((key) => predictiveModels.some((definition) => definition.key === key));
  if (!productionModelKeys.length) throw new Error('NO_PRODUCTION_PREDICTIVE_MODEL_REGISTERED');

  const remote = await mlRuntimeClient.sendCommand('predict_ensemble', {
    symbol,
    durationSecs: Number(durationSecs),
    durationValue,
    durationUnit,
    assetCategory,
    featureVector,
    featureSequence,
    modelTypes: productionModelKeys,
    productionModels,
  });
  if (!remote?.success || !remote.models) throw new Error('NATIVE_ML_ENSEMBLE_UNAVAILABLE');

  const evaluations = predictiveModels.map((definition) => {
    const result = remote.models[definition.key];
    const selectedForProduction = Boolean(productionModels[definition.key]);
    const up = result?.success ? finiteProbability(result.probabilityUp) : null;
    const down = result?.success ? finiteProbability(result.probabilityDown) : null;
    const valid = selectedForProduction && up !== null && down !== null && Math.abs((up + down) - 100) < 0.25;
    const dynamicWeight = valid ? validationWeight(result) : null;
    return {
      modelKey: definition.key,
      modelName: definition.displayName,
      family: definition.family as 'tabular' | 'sequential',
      status: valid ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
      probabilityUp: valid ? up : null,
      probabilityDown: valid ? down : null,
      signal: valid ? (up! >= down! ? ('RISE' as const) : ('FALL' as const)) : null,
      confidence: valid ? Math.max(up!, down!) : null,
      dynamicWeight,
      runtimeMode: valid ? 'Native Python trained production artifact' : 'Unavailable — no promoted production artifact',
      details: valid
        ? `${String(result.engine || 'Native trained model')} · ${assetContext.assetLabel} · ${assetContext.duration.label} · production ${String(productionModels[definition.key]?.modelId || '')}`
        : String(result?.error || (!selectedForProduction ? 'MODEL_NOT_PROMOTED' : 'MODEL_UNAVAILABLE')),
      validation: result?.validation || productionModels[definition.key]?.validation || null,
    };
  });

  const available = evaluations
    .filter((evaluation): evaluation is AvailableEvaluation => evaluation.status === 'AVAILABLE' && evaluation.probabilityUp !== null && evaluation.probabilityDown !== null && evaluation.dynamicWeight !== null && evaluation.signal !== null)
    .map((evaluation) => ({ ...evaluation, probabilityUp: evaluation.probabilityUp as number, probabilityDown: evaluation.probabilityDown as number, dynamicWeight: evaluation.dynamicWeight as number, signal: evaluation.signal as Signal }));

  if (available.length === 0) throw new Error('NO_VALIDATED_TRAINED_MODELS_AVAILABLE');

  const totalWeight = available.reduce((sum, evaluation) => sum + evaluation.dynamicWeight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new Error('INVALID_MODEL_WEIGHTS');
  const probUp = available.reduce((sum, evaluation) => sum + evaluation.probabilityUp * evaluation.dynamicWeight, 0) / totalWeight;
  const probDown = 100 - probUp;
  const direction: Signal = probUp >= probDown ? 'RISE' : 'FALL';
  const confidence = Math.max(probUp, probDown);

  const hmm = remote.models.hmm;
  const iso = remote.models.isolation_forest;
  const hmmAvailable = hmm?.success === true;
  const isoAvailable = iso?.success === true;
  const marketRegime = hmmAvailable ? String(hmm.primaryRegime) : 'REGIME_UNAVAILABLE';
  const anomalyScore = isoAvailable ? finiteProbability(Number(iso.anomalyScore) * 100) : null;
  const anomalyRisk = isoAvailable ? (Number(iso.anomalyScore) >= 0.7 ? 'HIGH' : Number(iso.anomalyScore) >= 0.4 ? 'MODERATE' : 'LOW') : 'UNKNOWN';

  const strategyGate = evaluateSignalStrategyGate(assetContext, confidence, available.length, anomalyRisk, direction);
  const finalAction = strategyGate.accepted ? (direction === 'RISE' ? 'EXECUTE_CALL' : 'EXECUTE_PUT') : 'HOLD_NO_SIGNAL';

  const modelBreakdown: Record<string, any> = {};
  for (const evaluation of evaluations) {
    modelBreakdown[evaluation.modelKey] = { modelName: evaluation.modelName, runtimeMode: evaluation.runtimeMode, status: evaluation.status, vote: evaluation.signal, confidence: evaluation.confidence, probabilityUp: evaluation.probabilityUp, probabilityDown: evaluation.probabilityDown, weight: evaluation.dynamicWeight, details: evaluation.details, validation: evaluation.validation };
  }

  const hmmDefinition = getMlModelDefinition('hmm');
  const isoDefinition = getMlModelDefinition('isolation_forest');
  modelBreakdown.hmm = hmmAvailable ? { modelName: hmmDefinition?.displayName || 'HMM', status: 'AVAILABLE', primaryRegime: hmm.primaryRegime, regimeState: hmm.regimeState, regimeProbabilities: hmm.regimeProbabilities, details: `${hmm.engine || 'Native trained GaussianHMM'} · ${assetContext.assetLabel}` } : { modelName: hmmDefinition?.displayName || 'HMM', status: 'UNAVAILABLE', details: String(hmm?.error || 'MODEL_UNAVAILABLE') };
  modelBreakdown.isolation_forest = isoAvailable ? { modelName: isoDefinition?.displayName || 'Isolation Forest', status: 'AVAILABLE', anomalyScore: iso.anomalyScore, isAnomaly: Boolean(iso.isAnomaly), details: `${iso.engine || 'Native trained IsolationForest'} · ${assetContext.assetLabel}` } : { modelName: isoDefinition?.displayName || 'Isolation Forest', status: 'UNAVAILABLE', details: String(iso?.error || 'MODEL_UNAVAILABLE') };

  const normalizedWeights = Object.fromEntries(available.map((evaluation) => [evaluation.modelKey, Number((evaluation.dynamicWeight / totalWeight).toFixed(6))]));
  const topPerformingModel = available.slice().sort((a, b) => b.dynamicWeight - a.dynamicWeight)[0]?.modelKey ?? null;
  return {
    symbol,
    direction,
    probUp: Number(probUp.toFixed(2)),
    probDown: Number(probDown.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    marketRegime,
    anomalyScore,
    assetContext,
    strategyGate,
    features,
    evaluations,
    modelBreakdown,
    regime: hmmAvailable ? hmm : { status: 'UNAVAILABLE', error: hmm?.error || 'MODEL_UNAVAILABLE' },
    anomaly: isoAvailable ? iso : { status: 'UNAVAILABLE', error: iso?.error || 'MODEL_UNAVAILABLE' },
    drift: { modelWeights: normalizedWeights, recentAccuracies: Object.fromEntries(available.map((evaluation) => [evaluation.modelKey, evaluation.validation?.accuracy ?? null])), driftStatus: `Weights derived from persisted native-model validation metrics · ${strategyGate.accepted ? 'asset-aware gate passed' : 'asset-aware gate blocked'}`, topPerformingModel },
    calibration: { rawProbability: direction === 'RISE' ? probUp : probDown, calibratedProbability: null, confidenceReductionPct: null, plattScaledProbability: null, isotonicProbability: null, expectedCalibrationError: null, method: 'UNAVAILABLE_UNTIL_TRAINED_CALIBRATION_DATA' },
    fusion: { directionScore: Number(confidence.toFixed(2)), direction, regimeState: marketRegime, anomalyRisk: isoAvailable ? (Number(iso.anomalyScore) >= 0.7 ? 'HIGH' : Number(iso.anomalyScore) >= 0.4 ? 'MODERATE' : 'LOW') : 'UNKNOWN', finalCompositeScore: Number(confidence.toFixed(2)), confidenceGateThreshold: strategyGate.confidenceGateThreshold, gatePassed: strategyGate.accepted, action: finalAction },
    timestamp: Date.now(),
  };
}
