import crypto from 'crypto';
import { assertFeatureOrder, getFeatureOrder, type FeatureKey } from './ml-feature-registry';

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
  featureOrder: FeatureKey[];
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
  featureOrder: FeatureKey[];
  featureCount: number;
  schemaVersion: string;
};

type UnknownRecord = Record<string, unknown>;

const CONFIG_ENV_NAME = 'ML_PIPELINE_CONFIG_JSON';
const REQUIRED_CONFIG_KEYS = [
  'pipelineVersion',
  'canonicalFeatureWindowTicks',
  'defaultHorizonTicks',
  'maxHorizonTicks',
  'featureWindows',
  'regimeThreshold',
  'digitPrecision',
  'syntheticSymbolPrefixes',
  'splitRatios',
  'splitGapMultiplier',
  'normalizationMethod',
  'normalizationEpsilon',
] as const;

let cachedConfig: FeaturePipelineConfig | null = null;

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[ML Config] ${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[ML Config] ${path} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredPositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`[ML Config] ${path} must be a positive safe integer.`);
  }
  return Number(value);
}

function requiredNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`[ML Config] ${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function requiredFiniteNumber(value: unknown, path: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[ML Config] ${path} must be a finite number.`);
  }
  return parsed;
}

function requiredPositiveNumber(value: unknown, path: string): number {
  const parsed = requiredFiniteNumber(value, path);
  if (parsed <= 0) throw new Error(`[ML Config] ${path} must be greater than zero.`);
  return parsed;
}

function requiredRatio(value: unknown, path: string): number {
  const parsed = requiredFiniteNumber(value, path);
  if (parsed <= 0 || parsed >= 1) throw new Error(`[ML Config] ${path} must be greater than zero and less than one.`);
  return parsed;
}

function requiredStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`[ML Config] ${path} must be a non-empty array.`);
  }
  const result = value.map((item, index) => requiredString(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`[ML Config] ${path} must not contain duplicate values.`);
  }
  return result;
}

function parseExternalConfig(): FeaturePipelineConfig {
  const raw = process.env[CONFIG_ENV_NAME];
  if (!raw?.trim()) {
    throw new Error(`[ML Config] ${CONFIG_ENV_NAME} is required. Configure the complete ML pipeline contract in the deployment environment.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`[ML Config] ${CONFIG_ENV_NAME} contains invalid JSON.`);
  }

  const source = asRecord(parsed, CONFIG_ENV_NAME);
  const missing = REQUIRED_CONFIG_KEYS.filter((key) => !(key in source));
  if (missing.length) {
    throw new Error(`[ML Config] ${CONFIG_ENV_NAME} is missing required keys: ${missing.join(', ')}.`);
  }

  const featureWindowsSource = asRecord(source.featureWindows, 'featureWindows');
  const splitSource = asRecord(source.splitRatios, 'splitRatios');
  const featureWindows: FeatureWindowConfig = {
    micro: requiredPositiveInteger(featureWindowsSource.micro, 'featureWindows.micro'),
    short: requiredPositiveInteger(featureWindowsSource.short, 'featureWindows.short'),
    medium: requiredPositiveInteger(featureWindowsSource.medium, 'featureWindows.medium'),
    macro: requiredPositiveInteger(featureWindowsSource.macro, 'featureWindows.macro'),
  };

  const canonicalFeatureWindowTicks = requiredPositiveInteger(source.canonicalFeatureWindowTicks, 'canonicalFeatureWindowTicks');
  const defaultHorizonTicks = requiredPositiveInteger(source.defaultHorizonTicks, 'defaultHorizonTicks');
  const maxHorizonTicks = requiredPositiveInteger(source.maxHorizonTicks, 'maxHorizonTicks');
  const maxConfiguredWindow = Math.max(...Object.values(featureWindows));
  if (canonicalFeatureWindowTicks < maxConfiguredWindow) {
    throw new Error('[ML Config] canonicalFeatureWindowTicks must be at least the largest configured feature window.');
  }
  if (defaultHorizonTicks > maxHorizonTicks) {
    throw new Error('[ML Config] defaultHorizonTicks cannot exceed maxHorizonTicks.');
  }

  const splitRatios = {
    train: requiredRatio(splitSource.train, 'splitRatios.train'),
    validation: requiredRatio(splitSource.validation, 'splitRatios.validation'),
    test: requiredRatio(splitSource.test, 'splitRatios.test'),
  };
  const splitSum = splitRatios.train + splitRatios.validation + splitRatios.test;
  if (Math.abs(splitSum - 1) > Number.EPSILON * 100) {
    throw new Error('[ML Config] splitRatios must sum to 1.');
  }

  const normalizationMethod = requiredString(source.normalizationMethod, 'normalizationMethod');
  if (normalizationMethod !== 'zscore') {
    throw new Error(`[ML Config] Unsupported normalizationMethod: ${normalizationMethod}.`);
  }

  // featureOrder is now registry-owned. An older deployment may still send it
  // in ML_PIPELINE_CONFIG_JSON; accept it only when it exactly matches the
  // canonical registry so two competing schemas can never silently diverge.
  if ('featureOrder' in source) {
    const suppliedFeatureOrder = requiredStringArray(source.featureOrder, 'featureOrder');
    assertFeatureOrder(suppliedFeatureOrder);
  }

  return {
    pipelineVersion: requiredString(source.pipelineVersion, 'pipelineVersion'),
    canonicalFeatureWindowTicks,
    defaultHorizonTicks,
    maxHorizonTicks,
    featureWindows,
    regimeThreshold: requiredFiniteNumber(source.regimeThreshold, 'regimeThreshold'),
    digitPrecision: requiredNonNegativeInteger(source.digitPrecision, 'digitPrecision'),
    syntheticSymbolPrefixes: requiredStringArray(source.syntheticSymbolPrefixes, 'syntheticSymbolPrefixes'),
    featureOrder: getFeatureOrder(),
    splitRatios,
    splitGapMultiplier: requiredPositiveInteger(source.splitGapMultiplier, 'splitGapMultiplier'),
    normalizationMethod: 'zscore',
    normalizationEpsilon: requiredPositiveNumber(source.normalizationEpsilon, 'normalizationEpsilon'),
  };
}

function hashConfig(config: FeaturePipelineConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16);
}

export function getMlPipelineConfig(): FeaturePipelineConfig {
  if (!cachedConfig) cachedConfig = parseExternalConfig();
  return cachedConfig;
}

export function getFeatureVectorSnapshot(config: FeaturePipelineConfig = getMlPipelineConfig()): FeatureVectorSnapshot {
  return {
    featureOrder: [...config.featureOrder],
    featureCount: config.featureOrder.length,
    schemaVersion: deriveFeatureSchemaVersion(config.featureOrder, config.pipelineVersion),
  };
}

export function deriveFeatureSchemaVersion(featureOrder: readonly string[], pipelineVersion = getMlPipelineConfig().pipelineVersion): string {
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
