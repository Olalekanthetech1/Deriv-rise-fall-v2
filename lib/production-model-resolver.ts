import { getDb, initDbSchema } from './db';
import { getMlModelDefinition } from './ml-model-registry';
import { getModelArtifactStatus, hasModelArtifact, materializeModelArtifact } from './ml-model-artifact-store';

export type ProductionModelResolution = {
  modelId: string;
  modelKey: string;
  modelFamily: string;
  symbol: string;
  durationValue: number;
  durationUnit: string;
  durationSeconds: number | null;
  horizonTicks: number | null;
  trainingRunId: string;
  datasetId: string | null;
  featureSchemaVersion: string;
  framework: string;
  format: string;
  validation: Record<string, unknown>;
  artifactPresent: boolean;
  lifecycleStatus: 'production';
};

export async function resolveProductionModels(symbol: string, durationValue: number, durationUnit: string): Promise<Record<string, ProductionModelResolution>> {
  if (!(await initDbSchema())) throw new Error('PRODUCTION_MODEL_REGISTRY_UNAVAILABLE');
  const sql = getDb();
  if (!sql) throw new Error('PRODUCTION_MODEL_REGISTRY_UNAVAILABLE');
  const rows = await sql`
    SELECT model_id, model_family, asset_symbol, duration_value, duration_unit,
           duration_seconds, horizon_ticks, feature_schema_version, framework,
           training_run_id, dataset_id, metrics, format
    FROM ml_model_registry_v2
    WHERE asset_symbol = ${symbol}::varchar
      AND duration_value = ${durationValue}::integer
      AND duration_unit = ${durationUnit}::varchar
      AND status = 'production'
    ORDER BY updated_at DESC
  `;
  const resolved: Record<string, ProductionModelResolution> = {};
  for (const row of rows as any[]) {
    const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
    const persistedKey = String(metrics.modelKey || '').trim().toLowerCase();
    const familyKey = String(row.model_family || '').trim().toLowerCase();
    const modelKey = persistedKey || familyKey;
    const definition = getMlModelDefinition(modelKey);
    if (!definition || definition.family === 'regime' || definition.family === 'anomaly' || resolved[modelKey]) continue;
    const modelId = String(row.model_id);
    resolved[modelKey] = {
      modelId,
      modelKey,
      modelFamily: String(row.model_family || ''),
      symbol: String(row.asset_symbol),
      durationValue: Number(row.duration_value),
      durationUnit: String(row.duration_unit),
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      horizonTicks: row.horizon_ticks == null ? null : Number(row.horizon_ticks),
      trainingRunId: String(row.training_run_id || ''),
      datasetId: row.dataset_id ? String(row.dataset_id) : null,
      featureSchemaVersion: String(row.feature_schema_version || ''),
      framework: String(row.framework || ''),
      format: String(row.format || ''),
      validation: metrics,
      artifactPresent: await hasModelArtifact(modelId),
      lifecycleStatus: 'production',
    };
  }
  return resolved;
}

export async function resolveAndMaterializeProductionModel(model: ProductionModelResolution) {
  if (!model.artifactPresent) throw new Error(`PRODUCTION_MODEL_ARTIFACT_MISSING:${model.modelId}`);
  return materializeModelArtifact(model.modelId);
}

export async function getProductionModelHealth(symbol?: string) {
  if (!(await initDbSchema())) throw new Error('PRODUCTION_MODEL_REGISTRY_UNAVAILABLE');
  const sql = getDb();
  if (!sql) throw new Error('PRODUCTION_MODEL_REGISTRY_UNAVAILABLE');
  const rows = symbol
    ? await sql`
        SELECT model_id, model_family, asset_symbol, duration_value, duration_unit,
               duration_seconds, training_run_id, dataset_id, feature_schema_version,
               framework, format, status, metrics, updated_at
        FROM ml_model_registry_v2
        WHERE status = 'production' AND asset_symbol = ${symbol}::varchar
        ORDER BY asset_symbol, duration_value, duration_unit, updated_at DESC
      `
    : await sql`
        SELECT model_id, model_family, asset_symbol, duration_value, duration_unit,
               duration_seconds, training_run_id, dataset_id, feature_schema_version,
               framework, format, status, metrics, updated_at
        FROM ml_model_registry_v2
        WHERE status = 'production'
        ORDER BY asset_symbol, duration_value, duration_unit, updated_at DESC
      `;
  return Promise.all((rows as any[]).map(async (row) => {
    const modelId = String(row.model_id);
    const artifactStatus = await getModelArtifactStatus(modelId);
    const metrics = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
    const modelKey = String(metrics.modelKey || row.model_family || '').trim().toLowerCase();
    const definition = getMlModelDefinition(modelKey);
    return {
      modelId,
      modelKey,
      modelName: definition?.displayName || String(row.model_family || 'Unknown model'),
      symbol: String(row.asset_symbol),
      duration: { value: Number(row.duration_value), unit: String(row.duration_unit), seconds: row.duration_seconds == null ? null : Number(row.duration_seconds) },
      trainingRunId: row.training_run_id ? String(row.training_run_id) : null,
      datasetId: row.dataset_id ? String(row.dataset_id) : null,
      featureSchemaVersion: String(row.feature_schema_version || ''),
      framework: String(row.framework || ''),
      format: String(row.format || ''),
      status: String(row.status),
      artifact: { status: artifactStatus, present: artifactStatus === 'active' || artifactStatus === 'superseded' },
      validation: { accuracy: metrics.accuracy ?? null, f1: metrics.f1 ?? metrics.f1Score ?? null, logLoss: metrics.logLoss ?? null },
      updatedAt: row.updated_at,
      healthy: (artifactStatus === 'active' || artifactStatus === 'superseded') && Boolean(row.training_run_id) && Boolean(row.dataset_id) && Boolean(row.feature_schema_version),
    };
  }));
}
