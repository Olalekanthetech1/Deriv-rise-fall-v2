/**
 * Browser-safe contract for the Multi-Model Layer UI.
 *
 * IMPORTANT: keep this file free of runtime imports from the ML engines/daemon.
 * Client Components must not import server-side evaluator modules merely to use
 * their TypeScript interfaces.
 */

export type MultiModelSignal = 'RISE' | 'FALL';

export interface MultiModelEvaluationView {
  modelKey: string;
  modelName: string;
  /** Every production evaluator must identify its model family. */
  family: 'tabular' | 'sequential' | string;
  runtimeMode?: string;
  probabilityUp: number;
  probabilityDown: number;
  signal: MultiModelSignal;
  vote?: MultiModelSignal;
  confidence: number;
  dynamicWeight?: number;
  weight?: number;
  details?: string;
}

export interface MultiModelRegimeView {
  primaryRegime?: string;
  regimeName?: string;
  regimeState?: number;
  probabilities?: Record<string, number>;
  tradingGuidance?: string;
}

export interface MultiModelAnomalyView {
  anomalyScore?: number;
  spikeSeverity?: string;
  isAbnormal?: boolean;
  confidenceAdjustmentFactor?: number;
  actionNote?: string;
}

export interface MultiModelFusionView {
  directionScore?: number;
  direction?: MultiModelSignal;
  regimeState?: string;
  anomalyRisk?: 'LOW' | 'MODERATE' | 'HIGH' | string;
  finalCompositeScore?: number;
  confidenceGateThreshold?: number;
  gatePassed?: boolean;
  action?: 'EXECUTE_CALL' | 'EXECUTE_PUT' | 'HOLD_NO_SIGNAL' | string;
}

export interface MultiModelCalibrationView {
  rawProbability?: number;
  calibratedProbability?: number;
  plattScaledProbability?: number;
  isotonicProbability?: number;
  expectedCalibrationError?: number;
  calibrationMethod?: string;
  method?: string;
  confidenceReductionPct?: number;
  calibrationBins?: Array<{
    binRange: string;
    rawAvg: number;
    calibratedAvg: number;
    accuracy: number;
    sampleCount: number;
  }>;
}

export interface MultiModelEvaluationResult {
  symbol: string;
  direction: MultiModelSignal;
  probUp: number;
  probDown: number;
  confidence: number;
  marketRegime?: string;
  anomalyScore?: number;
  modelBreakdown?: Record<string, any>;
  evaluations: MultiModelEvaluationView[];
  regime?: MultiModelRegimeView;
  anomaly?: MultiModelAnomalyView;
  drift?: {
    modelWeights?: Record<string, number>;
    recentAccuracies?: Record<string, number>;
    driftStatus?: string;
    topPerformingModel?: string;
  };
  fusion?: MultiModelFusionView;
  calibration?: MultiModelCalibrationView;
  features?: unknown;
  timestamp?: number;
}