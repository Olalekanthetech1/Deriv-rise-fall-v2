export type MlModelKey =
  | 'xgboost'
  | 'lightgbm'
  | 'catboost'
  | 'tcn'
  | 'lstm'
  | 'transformer'
  | 'hmm'
  | 'isolation_forest';

export type MlModelFamily = 'tabular' | 'sequential' | 'regime' | 'anomaly';

export type MlModelDefinition = {
  key: MlModelKey;
  displayName: string;
  family: MlModelFamily;
  predictive: boolean;
  defaultHyperparameters: Readonly<Record<string, number>>;
};

export const ML_MODEL_DEFINITIONS = [
  { key: 'xgboost', displayName: 'XGBoost', family: 'tabular', predictive: true, defaultHyperparameters: { maxDepth: 6, learningRate: 0.05, numEstimators: 100, subsample: 0.8, nJobs: 2 } },
  { key: 'lightgbm', displayName: 'LightGBM', family: 'tabular', predictive: true, defaultHyperparameters: { numEstimators: 100, learningRate: 0.05, numLeaves: 31, randomState: 42, nJobs: 2 } },
  { key: 'catboost', displayName: 'CatBoost', family: 'tabular', predictive: true, defaultHyperparameters: { numEstimators: 100, maxDepth: 6, learningRate: 0.05, randomState: 42 } },
  { key: 'tcn', displayName: 'TCN', family: 'sequential', predictive: true, defaultHyperparameters: { epochs: 8, batchSize: 64, learningRate: 0.001 } },
  { key: 'lstm', displayName: 'LSTM / GRU', family: 'sequential', predictive: true, defaultHyperparameters: { epochs: 8, batchSize: 64, learningRate: 0.001 } },
  { key: 'transformer', displayName: 'Transformer', family: 'sequential', predictive: true, defaultHyperparameters: { epochs: 8, batchSize: 64, learningRate: 0.001 } },
  { key: 'hmm', displayName: 'HMM Regime Model', family: 'regime', predictive: false, defaultHyperparameters: { components: 4, iterations: 100, randomState: 42 } },
  { key: 'isolation_forest', displayName: 'Isolation Forest', family: 'anomaly', predictive: false, defaultHyperparameters: { numEstimators: 200, randomState: 42, nJobs: 2 } },
] as const satisfies readonly MlModelDefinition[];

export function getMlModelDefinitions(): readonly MlModelDefinition[] {
  return ML_MODEL_DEFINITIONS;
}

export function getMlModelKeys(): MlModelKey[] {
  return ML_MODEL_DEFINITIONS.map(({ key }) => key);
}

export function getPredictiveModelDefinitions(): readonly MlModelDefinition[] {
  return ML_MODEL_DEFINITIONS.filter(({ predictive }) => predictive);
}

export function getPredictiveModelKeys(): MlModelKey[] {
  return getPredictiveModelDefinitions().map(({ key }) => key);
}

export function getSequenceModelKeys(): MlModelKey[] {
  return ML_MODEL_DEFINITIONS.filter(({ family }) => family === 'sequential').map(({ key }) => key);
}

export function getMlModelDefinition(key: string): MlModelDefinition | undefined {
  return ML_MODEL_DEFINITIONS.find((model) => model.key === key);
}
