import crypto from 'crypto';
import {
  getFeatureDefinitions,
  getFeatureOrder,
  getFeatureCount,
  type FeatureKey,
} from './ml-feature-registry';
import { initializeMlPipelineConfig, type FeaturePipelineConfig } from './ml-pipeline-config';

export type MlRuntimeSchemaContract = {
  contractVersion: string;
  pipelineVersion: string;
  featureSchemaVersion: string;
  schemaFingerprint: string;
  featureCount: number;
  featureOrder: FeatureKey[];
  featureDefinitions: Array<{ key: FeatureKey; pillar: string }>;
  featureWindows: FeaturePipelineConfig['featureWindows'];
  canonicalFeatureWindowTicks: number;
  sequenceLength: number;
  defaultHorizonTicks: number;
  normalizationMethod: FeaturePipelineConfig['normalizationMethod'];
  normalizationEpsilon: number;
};

export function buildMlRuntimeSchemaContract(config: FeaturePipelineConfig): MlRuntimeSchemaContract {
  const featureOrder = getFeatureOrder();
  const featureDefinitions = getFeatureDefinitions().map(({ key, pillar }) => ({ key, pillar }));
  const featureCount = getFeatureCount();
  const sequenceLength = config.featureWindows.short;

  if (featureOrder.length !== featureCount) {
    throw new Error('[ML Schema] Registry feature count/order mismatch.');
  }
  if (sequenceLength <= 0) {
    throw new Error('[ML Schema] Sequence length must be positive.');
  }

  const fingerprintPayload = {
    pipelineVersion: config.pipelineVersion,
    featureOrder,
    featureDefinitions,
    featureWindows: config.featureWindows,
    canonicalFeatureWindowTicks: config.canonicalFeatureWindowTicks,
    sequenceLength,
    normalizationMethod: config.normalizationMethod,
    normalizationEpsilon: config.normalizationEpsilon,
  };
  const schemaFingerprint = crypto
    .createHash('sha256')
    .update(JSON.stringify(fingerprintPayload))
    .digest('hex');

  return {
    contractVersion: 'runtime-schema-contract-v1',
    pipelineVersion: config.pipelineVersion,
    featureSchemaVersion: `feature-schema-${featureCount}-${schemaFingerprint.slice(0, 12)}`,
    schemaFingerprint,
    featureCount,
    featureOrder: [...featureOrder],
    featureDefinitions,
    featureWindows: { ...config.featureWindows },
    canonicalFeatureWindowTicks: config.canonicalFeatureWindowTicks,
    sequenceLength,
    defaultHorizonTicks: config.defaultHorizonTicks,
    normalizationMethod: config.normalizationMethod,
    normalizationEpsilon: config.normalizationEpsilon,
  };
}

export async function getMlRuntimeSchemaContract(): Promise<MlRuntimeSchemaContract> {
  const runtime = await initializeMlPipelineConfig();
  return buildMlRuntimeSchemaContract(runtime.config);
}
