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
  if (Number(pipelineConfig.sequenceLength ?? pipelineConfig.featureWindows?.short) !== Number(schema.sequenceLength)) return false;

  const featureWindows = asRecord(pipelineConfig.featureWindows);
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
  const currentSchemaVersion = String(schema.featureSchemaVersion);
  const schemaCompatible = datasetSchemaVersion === currentSchemaVersion || isStructurallyCompatibleDataset(dataset, schema);
  if (!schemaCompatible) {
    throw new Error(`DATASET_FEATURE_SCHEMA_VERSION_MISMATCH: dataset=${datasetSchemaVersion || 'unknown'} current=${currentSchemaVersion}`);
  }

  const running = await sql`SELECT run_id FROM ml_training_runs WHERE dataset_id=${datasetId} AND status='running' ORDER BY created_at DESC LIMIT 1`;
  if (running.length) throw new Error('TRAINING_ALREADY_RUNNING_FOR_DATASET');
  const samples = await sql`SELECT sample_index,split,label,feature_vector FROM training_dataset_samples WHERE dataset_id=${datasetId} ORDER BY sample_index ASC`;
  if (!samples.length) throw new Error('DATASET_CONTAINS_NO_SAMPLES');

  const partitions: Record<string, any> = {};
  for (const split of ['train', 'validation', 'test']) {
    const splitRows = samples.filter((row: any) => row.split === split);
    const vectors = splitRows.map((row: any) => Array.isArray(row.feature_vector) ? row.feature_vector.map(Number) : null);
    if (vectors.some((v: number[] | null) => !v || v.length !== schema.featureCount || v.some((x) => !Number.isFinite(x)))) throw new Error(`INVALID_FEATURE_VECTOR:${split}`);
    partitions[split] = { featureVectors: vectors, labels: splitRows.map((row: any) => String(row.label).toUpperCase() === 'RISE' ? 1 : 0), sampleCount: splitRows.length, featureCount: schema.featureCount, schemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint };
  }
  if (partitions.train.sampleCount < 2 || new Set(partitions.train.labels).size < 2 || partitions.validation.sampleCount < 2 || new Set(partitions.validation.labels).size < 2) throw new Error('INSUFFICIENT_TWO_CLASS_TRAIN_VALIDATION_DATA');

  const assetRows = await sql`SELECT asset_class,market_type,metadata FROM market_assets WHERE symbol=${String(dataset.asset_symbol)} LIMIT 1`;
  const assetClass = String(assetRows[0]?.asset_class || 'unknown');
  const marketType = String(assetRows[0]?.market_type || 'unknown');
  const assetMetadata = assetRows[0]?.metadata && typeof assetRows[0].metadata === 'object' ? assetRows[0].metadata : {};
  const definitions = getMlModelDefinitions().filter((d) => !request.modelTypes?.length || request.modelTypes.includes(d.key));
  if (!definitions.length) throw new Error('NO_REGISTERED_MODELS_SELECTED');
  const strategy = resolveAssetAwareModelStrategy({ assetClass, marketType, durationValue, durationUnit, durationSeconds, effectiveHorizonTicks, sampleCount: Number(dataset.sample_count) || samples.length }, definitions);
  const sequence = sequencePartitions(samples, strategy.sequenceLength, schema);
  if (sequence.train.featureSequences.length < 2 || new Set(sequence.train.labels).size < 2 || sequence.validation.featureSequences.length < 2 || new Set(sequence.validation.labels).size < 2) throw new Error('INSUFFICIENT_TWO_CLASS_SEQUENCE_DATA');

  const runId = crypto.randomUUID();
  const strategyMetadata = { ...strategy, assetMetadata };
  await sql`INSERT INTO ml_training_runs (run_id,dataset_id,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_ticks,status,requested_models,started_at,metadata,strategy_key,strategy_version,strategy_metadata) VALUES (${runId},${datasetId},${String(dataset.asset_symbol)},${durationValue},${durationUnit},${durationSeconds},${effectiveHorizonTicks},'running',${JSON.stringify(definitions.map((d) => d.key))}::jsonb,NOW(),${JSON.stringify({featureSchemaVersion:schema.featureSchemaVersion,schemaFingerprint:schema.schemaFingerprint,datasetFeatureSchemaVersion: datasetSchemaVersion, datasetSchemaCompatibility: schemaCompatible ? 'compatible' : 'exact'})}::jsonb,${strategy.key},${strategy.version},${JSON.stringify(strategyMetadata)}::jsonb)`;
  for (const d of definitions) await sql`INSERT INTO ml_training_run_models(run_id,model_type,status) VALUES(${runId},${d.key},'queued')`;

  const results: any[] = [];
  let completed = 0;
  let failed = 0;
  for (const definition of definitions) {
    await sql`UPDATE ml_training_run_models SET status='running',started_at=NOW() WHERE run_id=${runId} AND model_type=${definition.key}`;
    try {
      const sequenceModel = definition.family === 'sequential';
      const configuredHyperparameters = { ...strategy.hyperparameters[definition.key] };
      const result = await xgboostDaemon.sendCommand('train_partitioned', {
        symbol: String(dataset.asset_symbol), modelType: definition.key, durationValue, durationUnit, durationSeconds,
        effectiveHorizonTicks, datasetId, trainingRunId: runId,
        trainTabularDataset: sequenceModel ? undefined : partitions.train,
        validationTabularDataset: sequenceModel ? undefined : partitions.validation,
        trainSequenceDataset: sequenceModel ? sequence.train : undefined,
        validationSequenceDataset: sequenceModel ? sequence.validation : undefined,
        hyperparams: configuredHyperparameters,
        assetAwareStrategy: { key: strategy.key, version: strategy.version, assetClass: strategy.assetClass, marketType: strategy.marketType, sequenceLength: strategy.sequenceLength, minimumSamples: strategy.minimumSamples[definition.key] },
      });
      if (!result?.success) throw new Error(result?.error || 'Native training failed.');
      const modelId = String(result.modelId);
      const metrics = { ...(result.metrics || {}), engine: result.engine, samplesCount: result.samplesCount, validationSamples: result.validationSamples, artifactPath: result.artifactPath || null, assetAwareStrategy: strategy.key, assetAwareStrategyVersion: strategy.version };
      await registerDurationModel({
        modelId, modelFamily: definition.family, version: `${schema.featureSchemaVersion}-${runId.slice(0, 8)}`,
        symbol: String(dataset.asset_symbol), assetClass, durationValue, durationUnit, durationSeconds, effectiveHorizonTicks,
        datasetId, format: sequenceModel ? 'PT_STATE' : 'PKL', status: 'candidate', featureSchemaVersion: String(schema.featureSchemaVersion),
        framework: sequenceModel ? 'pytorch' : definition.key, trainingRunId: runId, strategyKey: strategy.key, strategyVersion: strategy.version,
        strategyMetadata: { sequenceLength: strategy.sequenceLength, minimumSamples: strategy.minimumSamples[definition.key], assetClass: strategy.assetClass, marketType: strategy.marketType },
        metrics, hyperparameters: configuredHyperparameters,
      });
      await sql`UPDATE ml_training_run_models SET status='completed',model_id=${modelId},metrics=${JSON.stringify(metrics)}::jsonb,completed_at=NOW() WHERE run_id=${runId} AND model_type=${definition.key}`;
      completed += 1;
      results.push({ modelType: definition.key, success: true, modelId, metrics, engine: result.engine });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Native training failed.';
      await sql`UPDATE ml_training_run_models SET status='failed',error=${message},completed_at=NOW() WHERE run_id=${runId} AND model_type=${definition.key}`;
      failed += 1;
      results.push({ modelType: definition.key, success: false, error: message });
    }
    const done = completed + failed;
    await updateRun(sql, runId, done === definitions.length ? (failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed') : 'running', completed, failed, done === definitions.length ? new Date().toISOString() : null, {
      progress: { completed, failed, total: definitions.length }, featureSchemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint,
      strategy: { key: strategy.key, version: strategy.version, assetClass: strategy.assetClass, marketType: strategy.marketType, sequenceLength: strategy.sequenceLength },
    });
  }
  return { runId, status: failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed', completedModels: completed, failedModels: failed, totalModels: definitions.length, strategy: { key: strategy.key, version: strategy.version, sequenceLength: strategy.sequenceLength }, dataset: { id: datasetId, symbol: dataset.asset_symbol, durationValue, durationUnit, durationSeconds, effectiveHorizonTicks }, results };
}

export async function listTrainingRuns(symbol?: string) {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  const rows = symbol
    ? await sql`SELECT r.*,COALESCE(json_agg(m ORDER BY m.created_at) FILTER(WHERE m.id IS NOT NULL),'[]'::json) AS models FROM ml_training_runs r LEFT JOIN ml_training_run_models m ON m.run_id=r.run_id WHERE r.asset_symbol=${symbol} GROUP BY r.run_id ORDER BY r.created_at DESC LIMIT 50`
    : await sql`SELECT r.*,COALESCE(json_agg(m ORDER BY m.created_at) FILTER(WHERE m.id IS NOT NULL),'[]'::json) AS models FROM ml_training_runs r LEFT JOIN ml_training_run_models m ON m.run_id=r.run_id GROUP BY r.run_id ORDER BY r.created_at DESC LIMIT 50`;
  return rows;
}
