import { neon } from '@neondatabase/serverless';
import { initDbSchema, getDbConnectionString } from './db';
import { ensureTrainingDurationSchema } from './training-duration-schema';

export type DurationModelRegistration = {
  modelId: string;
  modelFamily: string;
  version: string;
  symbol: string;
  assetClass: string;
  durationValue: number;
  durationUnit: 't' | 's' | 'm' | 'h' | 'd';
  durationSeconds: number | null;
  effectiveHorizonTicks: number;
  datasetId: string;
  format: string;
  status: 'candidate' | 'staging' | 'production';
  featureSchemaVersion: string;
  framework: string;
  trainingRunId: string;
  metrics: unknown;
  hyperparameters: unknown;
};

export async function registerDurationModel(data: DurationModelRegistration): Promise<void> {
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) throw new Error('DATABASE_UNAVAILABLE');
  const sql = neon(url);
  await ensureTrainingDurationSchema(sql);
  await sql`
    INSERT INTO ml_model_registry_v2 (
      model_id, model_family, version, asset_symbol, asset_class, horizon_ticks,
      duration_value, duration_unit, duration_seconds, horizon_type,
      dataset_id, format, status, feature_schema_version, framework, training_run_id,
      metrics, hyperparameters, updated_at
    ) VALUES (
      ${data.modelId}, ${data.modelFamily}, ${data.version}, ${data.symbol}, ${data.assetClass}, ${data.effectiveHorizonTicks},
      ${data.durationValue}, ${data.durationUnit}, ${data.durationSeconds}, ${data.durationUnit === 't' ? 'tick' : 'time'},
      ${data.datasetId}, ${data.format}, ${data.status}, ${data.featureSchemaVersion}, ${data.framework}, ${data.trainingRunId},
      ${JSON.stringify(data.metrics ?? {})}::jsonb, ${JSON.stringify(data.hyperparameters ?? {})}::jsonb, NOW()
    )
    ON CONFLICT (model_id) DO UPDATE SET
      model_family = EXCLUDED.model_family,
      version = EXCLUDED.version,
      asset_symbol = EXCLUDED.asset_symbol,
      asset_class = EXCLUDED.asset_class,
      horizon_ticks = EXCLUDED.horizon_ticks,
      duration_value = EXCLUDED.duration_value,
      duration_unit = EXCLUDED.duration_unit,
      duration_seconds = EXCLUDED.duration_seconds,
      horizon_type = EXCLUDED.horizon_type,
      dataset_id = EXCLUDED.dataset_id,
      format = EXCLUDED.format,
      status = EXCLUDED.status,
      feature_schema_version = EXCLUDED.feature_schema_version,
      framework = EXCLUDED.framework,
      training_run_id = EXCLUDED.training_run_id,
      metrics = EXCLUDED.metrics,
      hyperparameters = EXCLUDED.hyperparameters,
      updated_at = NOW()
  `;
}
