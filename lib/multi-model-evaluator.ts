import type { EngineeredTickFeatures, TickPoint } from './ml-feature-extractor';
import {
  evaluateProductionEnsemble,
  type ProductionEnsembleResult,
} from './production-ensemble';

/**
 * Compatibility types for legacy imports.
 *
 * The old evaluator contained TypeScript-only heuristic implementations for
 * XGBoost, LightGBM, CatBoost, TCN, LSTM/GRU, Transformer, HMM and Isolation
 * Forest. Those implementations were not trained models and could produce
 * predictions when the native ML runtime was unavailable.
 *
 * The production path is now the single source of truth: native trained
 * artifacts served by the Python ML daemon. Missing artifacts remain
 * unavailable instead of being replaced with simulated predictions.
 */
export type ModelEvaluation = ProductionEnsembleResult['evaluations'][number];
export type HMMRegimeResult = ProductionEnsembleResult['regime'];
export type IsolationForestResult = ProductionEnsembleResult['anomaly'];
export type OnlineLearningDriftResult = ProductionEnsembleResult['drift'];
export type ModelBreakdown = ProductionEnsembleResult['modelBreakdown'];
export type DecisionFusionDetails = ProductionEnsembleResult['fusion'];
export type EnsembleEvaluationResult = ProductionEnsembleResult;

export interface ModelVote {
  modelName: string;
  runtimeMode?: string;
  vote: 'RISE' | 'FALL';
  confidence: number;
  probabilityUp: number;
  probabilityDown: number;
  weight: number;
  details: string;
}

/**
 * Production multi-model evaluator.
 *
 * This compatibility export intentionally delegates to the native production
 * ensemble so existing server imports cannot accidentally re-enable the old
 * TypeScript heuristic engines.
 */
export async function evaluateMultiModelEnsembleAsync(
  ticks: TickPoint[],
  options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {},
): Promise<EnsembleEvaluationResult> {
  return evaluateProductionEnsemble(ticks, options);
}

/**
 * The previous synchronous evaluator could only work because it executed
 * local heuristic code. Native inference is asynchronous, so a synchronous
 * compatibility call is deliberately rejected rather than returning a fake
 * prediction.
 */
export function evaluateMultiModelEnsemble(
  _ticks: TickPoint[],
  _options: { symbol?: string; durationSecs?: number; assetCategory?: number } = {},
): never {
  throw new Error('NATIVE_ML_ENSEMBLE_REQUIRES_ASYNC');
}

/**
 * Online-learning state is now sourced from persisted native-model validation
 * metrics by evaluateProductionEnsemble(). There is intentionally no mutable
 * in-memory accuracy store or synthetic baseline here.
 */
export function evaluateOnlineLearningDrift(): OnlineLearningDriftResult {
  return {
    modelWeights: {},
    recentAccuracies: {},
    driftStatus: 'UNAVAILABLE — native production ensemble has not been evaluated',
    topPerformingModel: 'UNAVAILABLE',
  } as OnlineLearningDriftResult;
}

export function getOnlineLearningState(): OnlineLearningDriftResult {
  return evaluateOnlineLearningDrift();
}

/**
 * Legacy outcome mutation is intentionally disabled. Model performance must
 * come from persisted out-of-sample validation data, not an in-memory counter.
 */
export function recordModelOutcome(_modelKey: string, _wasCorrect: boolean): never {
  throw new Error('LEGACY_ONLINE_LEARNING_DISABLED_USE_PERSISTED_NATIVE_VALIDATION');
}

/**
 * Legacy reset is intentionally disabled for the same reason: production
 * model metrics are not maintained in a mutable in-memory baseline.
 */
export function resetOnlineLearningStats(): never {
  throw new Error('LEGACY_ONLINE_LEARNING_DISABLED');
}

export type { EngineeredTickFeatures, TickPoint };
