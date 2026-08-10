import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { getDbConnectionString, initDbSchema } from './db';
import { ensureTrainingDurationSchema } from './training-duration-schema';
import { getMlModelDefinitions, type MlModelKey } from './ml-model-registry';
import { registerDurationModel } from './duration-model-registry';
import { getMlRuntimeSchemaContract } from './ml-runtime-schema';
import { resolveAssetAwareModelStrategy } from './asset-aware-model-strategy';
import { xgboostDaemon } from './xgboost-daemon';

type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';
type TrainingRequest = { datasetId: string; modelTypes?: MlModelKey[] };

function normalizeId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sameFeatureWindows(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return ['micro', 'short', 'medium', 'macro'].every((key) => Number(a[key]) === Number(b[key]));
}

function sameSplitRatios(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return ['train', 'validation', 'test'].every((key) => Number(a[key]) === Number(b[key]));
}

function isStructurallyCompatibleDataset(dataset: any, schema: any): boolean {
  const metadata = asRecord(dataset?.metadata);
  const pipelineConfig = asRecord(metadata?.pipelineConfig);
  if (!pipelineConfig) return false;

  const featureOrder = Array.isArray(pipelineConfig.featureOrder)
    ? pipelineConfig.featureOrder.map((value) => String(value))
    : [];
  if (featureOrder.length !== schema.featureCount) return false;
  if (featureOrder.join('|') !== schema.featureOrder.join('|')) return false;

  if (Number(pipelineConfig.canonicalFeatureWindowTicks) !== Number(schema.canonicalFeatureWindowTicks)) return false;

  const configuredFeatureWindows = asRecord(pipelineConfig.featureWindows);
  const configuredSequenceLength = Number(
    pipelineConfig.sequenceLength ?? configuredFeatureWindows?.short ?? NaN,
  );
  if (configuredSequenceLength !== Number(schema.sequenceLength)) return false;

  const featureWindows = configuredFeatureWindows;
  if (!featureWindows || !sameFeatureWindows(featureWindows, schema.featureWindows)) return false;

  const splitRatios = asRecord(pipelineConfig.splitRatios);
  if (!splitRatios || !sameSplitRatios(splitRatios, schema.splitRatios)) return false;

  if (String(pipelineConfig.normalizationMethod ?? '') !== String(schema.normalizationMethod)) return false;
  if (Number(pipelineConfig.normalizationEpsilon ?? NaN) !== Number(schema.normalizationEpsilon)) return false;

  return true;
}

function sequencePartitions(rows: any[], sequenceLength: number, schema: any) {
  const result: Record<string, any> = {};
  for (const split of ['train', 'validation', 'test']) {
    const ordered = rows.filter((row) => row.split === split).sort((a, b) => Number(a.sample_index) - Number(b.sample_index));
    const featureSequences: number[][][] = [];
    const labels: number[] = [];
    for (let i = sequenceLength - 1; i < ordered.length; i += 1) {
      const window = ordered.slice(i - sequenceLength + 1, i + 1);
      const vectors = window.map((row) => Array.isArray(row.feature_vector) ? row.feature_vector.map(Number) : null);
      if (vectors.some((v: number[] | null) => !v || v.length !== schema.featureCount || v.some((x) => !Number.isFinite(x)))) continue;
      featureSequences.push(vectors as number[][]);
      labels.push(String(ordered[i].label).toUpperCase() === 'RISE' ? 1 : 0);
    }
    result[split] = { featureSequences, labels, featureCount: schema.featureCount, sequenceLength, schemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint };
  }
  return result;
}

async function updateRun(sql: any, runId: string, status: string, completedModels: number, failedModels: number, completedAt: string | null = null, metadata: Record<string, unknown> = {}) {
  await sql`UPDATE ml_training_runs SET status=${status},completed_models=${completedModels},failed_models=${failedModels},completed_at=${completedAt},metadata=${JSON.stringify(metadata)}::jsonb,updated_at=NOW() WHERE run_id=${runId}`;
}

export async function trainDatasetModels(request: TrainingRequest) {
  const datasetId = normalizeId(request.datasetId);
  if (!datasetId) throw new Error('datasetId is required.');
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  const schema = await getMlRuntimeSchemaContract();
  const rows = await sql`SELECT id,name,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_type,horizon_ticks,status,leakage_check_passed,feature_schema_version,sample_count,train_count,validation_count,test_count,metadata FROM training_datasets WHERE id=${datasetId} LIMIT 1`;
  const dataset = rows[0] as any;
  if (!dataset) throw new Error('TRAINING_DATASET_NOT_FOUND');
  if (dataset.status !== 'completed' || dataset.leakage_check_passed !== true) throw new Error('DATASET_NOT_READY_FOR_TRAINING');

  const durationValue = Number(dataset.duration_value);
  const durationUnit = dataset.duration_unit as DurationUnit;
  const durationSeconds = dataset.duration_seconds == null ? null : Number(dataset.duration_seconds);
  const effectiveHorizonTicks = Number(dataset.horizon_ticks);
  if (!Number.isSafeInteger(durationValue) || durationValue <= 0 || !['t', 's', 'm', 'h', 'd'].includes(durationUnit) || !Number.isSafeInteger(effectiveHorizonTicks) || effectiveHorizonTicks <= 0) {
    throw new Error('INVALID_DATASET_DURATION_METADATA');
  }

  const datasetSchemaVersion = String(dataset.feature_schema_version ?? '');
