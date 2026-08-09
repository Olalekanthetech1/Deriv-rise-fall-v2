export type MlModelFamily = 'tabular' | 'sequential' | 'regime' | 'anomaly';

export type MlModelDefinition = {
  key: string;
  displayName: string;
  family: MlModelFamily;
  predictive: boolean;
};

export const ML_MODEL_DEFINITIONS = [
  { key: 'xgboost', displayName: 'XGBoost', family: 'tabular', predictive: true },
  { key: 'lightgbm', displayName: 'LightGBM', family: 'tabular', predictive: true },
  { key: 'catboost', displayName: 'CatBoost', family: 'tabular', predictive: true },
  { key: 'tcn', displayName: 'TCN', family: 'sequential', predictive: true },
  { key: 'lstm', displayName: 'LSTM / GRU', family: 'sequential', predictive: true },
  { key: 'transformer', displayName: 'Transformer', family: 'sequential', predictive: true },
  { key: 'hmm', displayName: 'HMM Regime Model', family: 'regime', predictive: false },
  { key: 'isolation_forest', displayName: 'Isolation Forest', family: 'anomaly', predictive: false },
] as const satisfies readonly MlModelDefinition[];

export type MlModelKey = typeof ML_MODEL_DEFINITIONS[number]['key'];

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
