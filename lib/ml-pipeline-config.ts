import crypto from 'crypto';

export type FeatureWindowConfig = {
  micro: number;
  short: number;
  medium: number;
  macro: number;
};

export type FeaturePipelineConfig = {
  pipelineVersion: string;
  canonicalFeatureWindowTicks: number;
  defaultHorizonTicks: number;
  maxHorizonTicks: number;
  featureWindows: FeatureWindowConfig;
  regimeThreshold: number;
  digitPrecision: number;
  syntheticSymbolPrefixes: string[];
  featureOrder: string[];
  splitRatios: {
    train: number;
    validation: number;
    test: number;
  };
  splitGapMultiplier: number;
  normalizationMethod: 'zscore';
  normalizationEpsilon: number;
};

export type FeatureVectorSnapshot = {
  featureOrder: string[];
  featureCount: number;
  schemaVersion: string;
};

const DEFAULT_FEATURE_ORDER = [
  'deltaP1',
  'deltaP2',
  'deltaP3',
  'micro_momentum',
  'short_momentum',
  'medium_momentum',
  'macro_momentum',
  'short_range',
  'medium_displacement',
  'macro_displacement',
  'up_tick_ratio',
  'down_tick_ratio',
  'directional_imbalance',
  'consecutive_up',
  'consecutive_down',
  'micro_persistence',
  'short_persistence',
  'short_reversal_rate',
  'medium_reversal_rate',
  'micro_velocity',
  'short_velocity',
  'medium_velocity',
  'acceleration',
  'ticks_per_second',
  'velocity_per_second',
  'short_volatility',
  'medium_volatility',
  'macro_volatility',
  'short_rangeCompression',
  'medium_distHigh',
  'medium_distLow',
  'macro_regime',
  'is1SecondSynthetic',
  'contractDurationSecs',
  'durationFactor',
  'digitFrequency',
  'assetCategory',
];

const DEFAULT_PIPELINE_CONFIG: FeaturePipelineConfig = {
  pipelineVersion: 'ml-pipeline-v1',
  canonicalFeatureWindowTicks: 300,
  defaultHorizonTicks: 5,
  maxHorizonTicks: 5000,
  featureWindows: {
    micro: 5,
    short: 25,
    medium: 100,
    macro: 300,
  },
  regimeThreshold: 0.05,
  digitPrecision: 5,
  syntheticSymbolPrefixes: ['1HZ', 'R_'],
  featureOrder: DEFAULT_FEATURE_ORDER,
  splitRatios: {
    train: 0.7,
    validation: 0.15,
    test: 0.15,
  },
  splitGapMultiplier: 1,
  normalizationMethod: 'zscore',
  normalizationEpsilon: 1e-12,
};

let cachedConfig: FeaturePipelineConfig | null = null;

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

function clampRatio(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) return fallback;
  return parsed;
}

function hashConfig(config: FeaturePipelineConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16);
}

function normalizeConfig(raw: Partial<FeaturePipelineConfig>): FeaturePipelineConfig {
  const base = DEFAULT_PIPELINE_CONFIG;
  const featureWindows = raw.featureWindows ?? {};

  const order = Array.isArray(raw.featureOrder) && raw.featureOrder.length > 0
    ? raw.featureOrder.map((item) => String(item).trim()).filter(Boolean)
    : [...base.featureOrder];

  const normalized: FeaturePipelineConfig = {
    pipelineVersion: typeof raw.pipelineVersion === 'string' && raw.pipelineVersion.trim() ? raw.pipelineVersion.trim() : base.pipelineVersion,
    canonicalFeatureWindowTicks: clampPositiveInteger(raw.canonicalFeatureWindowTicks, base.canonicalFeatureWindowTicks, base.canonicalFeatureWindowTicks),
    defaultHorizonTicks: clampPositiveInteger(raw.defaultHorizonTicks, base.defaultHorizonTicks, base.maxHorizonTicks),
    maxHorizonTicks: clampPositiveInteger(raw.maxHorizonTicks, base.maxHorizonTicks, 100000),
    featureWindows: {
      micro: clampPositiveInteger(featureWindows.micro, base.featureWindows.micro, base.featureWindows.micro),
      short: clampPositiveInteger(featureWindows.short, base.featureWindows.short, base.featureWindows.short),
      medium: clampPositiveInteger(featureWindows.medium, base.featureWindows.medium, base.featureWindows.medium),
      macro: clampPositiveInteger(featureWindows.macro, base.featureWindows.macro, base.featureWindows.macro),
    },
    regimeThreshold: Number.isFinite(Number(raw.regimeThreshold)) ? Number(raw.regimeThreshold) : base.regimeThreshold,
    digitPrecision: clampPositiveInteger(raw.digitPrecision, base.digitPrecision, 12),
    syntheticSymbolPrefixes: Array.isArray(raw.syntheticSymbolPrefixes) && raw.syntheticSymbolPrefixes.length > 0
      ? raw.syntheticSymbolPrefixes.map((value) => String(value).trim()).filter(Boolean)
      : [...base.syntheticSymbolPrefixes],
    featureOrder: order,
    splitRatios: {
      train: clampRatio(raw.splitRatios?.train, base.splitRatios.train),
      validation: clampRatio(raw.splitRatios?.validation, base.splitRatios.validation),
      test: clampRatio(raw.splitRatios?.test, base.splitRatios.test),
    },
    splitGapMultiplier: clampPositiveInteger(raw.splitGapMultiplier, base.splitGapMultiplier, 100),
    normalizationMethod: raw.normalizationMethod === 'zscore' ? 'zscore' : base.normalizationMethod,
    normalizationEpsilon: Number.isFinite(Number(raw.normalizationEpsilon)) && Number(raw.normalizationEpsilon) > 0 ? Number(raw.normalizationEpsilon) : base.normalizationEpsilon,
  };

  const splitSum = normalized.splitRatios.train + normalized.splitRatios.validation + normalized.splitRatios.test;
  if (Math.abs(splitSum - 1) > 1e-6) {
    normalized.splitRatios = {
      train: base.splitRatios.train,
      validation: base.splitRatios.validation,
      test: base.splitRatios.test,
    };
  }

  normalized.pipelineVersion = `${normalized.pipelineVersion}-${hashConfig(normalized)}`;
  return normalized;
}

function readJsonEnv(name: string): Partial<FeaturePipelineConfig> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<FeaturePipelineConfig>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn(`[ML Config] Failed to parse ${name}. Falling back to defaults.`);
    return {};
  }
}

export function getMlPipelineConfig(): FeaturePipelineConfig {
  if (cachedConfig) return cachedConfig;
  const fromEnv = readJsonEnv('ML_PIPELINE_CONFIG_JSON');
  cachedConfig = normalizeConfig(fromEnv);
  return cachedConfig;
}

export function getFeatureVectorSnapshot(config: FeaturePipelineConfig = getMlPipelineConfig()): FeatureVectorSnapshot {
  return {
    featureOrder: [...config.featureOrder],
    featureCount: config.featureOrder.length,
    schemaVersion: deriveFeatureSchemaVersion(config.featureOrder, config.pipelineVersion),
  };
}

export function deriveFeatureSchemaVersion(featureOrder: string[], pipelineVersion = getMlPipelineConfig().pipelineVersion): string {
  const digest = crypto.createHash('sha256').update(`${pipelineVersion}|${featureOrder.join('|')}`).digest('hex').slice(0, 12);
  return `feature-schema-${featureOrder.length}-${digest}`;
}

export function deriveLabelSchemaVersion(labelDeadZone: number, horizonTicks: number, config: FeaturePipelineConfig = getMlPipelineConfig()): string {
  const deadZone = Number.isFinite(labelDeadZone) ? labelDeadZone : 0;
  const digest = crypto.createHash('sha256').update(`${config.pipelineVersion}|${horizonTicks}|${deadZone.toFixed(12)}`).digest('hex').slice(0, 12);
  return `label-schema-${horizonTicks}-${digest}`;
}

export function deriveNormalizationVersion(fingerprint: string, config: FeaturePipelineConfig = getMlPipelineConfig()): string {
  const digest = crypto.createHash('sha256').update(`${config.pipelineVersion}|${config.normalizationMethod}|${fingerprint}`).digest('hex').slice(0, 12);
  return `norm-${config.normalizationMethod}-${digest}`;
}

export function buildDatasetFingerprint(parts: Array<string | number>, config: FeaturePipelineConfig = getMlPipelineConfig()): string {
  return crypto.createHash('sha256').update(`${config.pipelineVersion}|${parts.join('|')}`).digest('hex');
}

export function getRequiredSplitGapTicks(horizonTicks: number, config: FeaturePipelineConfig = getMlPipelineConfig()): number {
  return Math.max(1, Math.ceil(horizonTicks * config.splitGapMultiplier));
}

export function isSyntheticSymbol(symbol: string, config: FeaturePipelineConfig = getMlPipelineConfig()): boolean {
  const normalized = symbol.trim().toUpperCase();
  return config.syntheticSymbolPrefixes.some((prefix) => normalized.startsWith(prefix.toUpperCase()));
}

export function getCanonicalWindowTicks(config: FeaturePipelineConfig = getMlPipelineConfig()): number {
  return config.canonicalFeatureWindowTicks;
}

export function getDefaultHorizonTicks(config: FeaturePipelineConfig = getMlPipelineConfig()): number {
  return config.defaultHorizonTicks;
}
