type Sql = any;

/**
 * Idempotent compatibility migration for duration-aware datasets/models.
 * Existing tick datasets remain valid and are backfilled as tick-duration
 * records. No existing rows are deleted or rewritten destructively.
 */
export async function ensureTrainingDurationSchema(sql: Sql): Promise<void> {
  await sql`ALTER TABLE training_datasets ADD COLUMN IF NOT EXISTS duration_value INTEGER`;
  await sql`ALTER TABLE training_datasets ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(8)`;
  await sql`ALTER TABLE training_datasets ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(20, 6)`;
  await sql`ALTER TABLE training_datasets ADD COLUMN IF NOT EXISTS horizon_type VARCHAR(16)`;
  await sql`ALTER TABLE training_datasets ADD COLUMN IF NOT EXISTS contract_type VARCHAR(64)`;

  await sql`
    UPDATE training_datasets
    SET duration_value = COALESCE(duration_value, horizon_ticks),
        duration_unit = COALESCE(duration_unit, 't'),
        horizon_type = COALESCE(horizon_type, 'tick')
    WHERE duration_value IS NULL OR duration_unit IS NULL OR horizon_type IS NULL
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_training_datasets_asset_duration ON training_datasets (asset_symbol, duration_unit, duration_value, created_at DESC)`;

  await sql`ALTER TABLE ml_model_registry_v2 ADD COLUMN IF NOT EXISTS duration_value INTEGER`;
  await sql`ALTER TABLE ml_model_registry_v2 ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(8)`;
  await sql`ALTER TABLE ml_model_registry_v2 ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(20, 6)`;
  await sql`ALTER TABLE ml_model_registry_v2 ADD COLUMN IF NOT EXISTS horizon_type VARCHAR(16)`;
  await sql`ALTER TABLE ml_model_registry_v2 ADD COLUMN IF NOT EXISTS contract_type VARCHAR(64)`;
  await sql`
    UPDATE ml_model_registry_v2
    SET duration_value = COALESCE(duration_value, horizon_ticks),
        duration_unit = COALESCE(duration_unit, 't'),
        horizon_type = COALESCE(horizon_type, 'tick')
    WHERE duration_value IS NULL OR duration_unit IS NULL OR horizon_type IS NULL
  `;

  await sql`ALTER TABLE ml_backtest_runs ADD COLUMN IF NOT EXISTS duration_value INTEGER`;
  await sql`ALTER TABLE ml_backtest_runs ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(8)`;
  await sql`ALTER TABLE ml_backtest_runs ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(20, 6)`;
  await sql`ALTER TABLE ml_backtest_runs ADD COLUMN IF NOT EXISTS horizon_type VARCHAR(16)`;
  await sql`ALTER TABLE ml_backtest_runs ADD COLUMN IF NOT EXISTS contract_type VARCHAR(64)`;
  await sql`
    UPDATE ml_backtest_runs
    SET duration_value = COALESCE(duration_value, horizon_ticks),
        duration_unit = COALESCE(duration_unit, 't'),
        horizon_type = COALESCE(horizon_type, 'tick')
    WHERE duration_value IS NULL OR duration_unit IS NULL OR horizon_type IS NULL
  `;

  await sql`ALTER TABLE ml_performance_events ADD COLUMN IF NOT EXISTS duration_value INTEGER`;
  await sql`ALTER TABLE ml_performance_events ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(8)`;
  await sql`ALTER TABLE ml_performance_events ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(20, 6)`;
  await sql`ALTER TABLE ml_performance_events ADD COLUMN IF NOT EXISTS horizon_type VARCHAR(16)`;
  await sql`ALTER TABLE ml_performance_events ADD COLUMN IF NOT EXISTS contract_type VARCHAR(64)`;
  await sql`
    UPDATE ml_performance_events
    SET duration_value = COALESCE(duration_value, horizon_ticks),
        duration_unit = COALESCE(duration_unit, 't'),
        horizon_type = COALESCE(horizon_type, 'tick')
    WHERE duration_value IS NULL OR duration_unit IS NULL OR horizon_type IS NULL
  `;

  await sql`ALTER TABLE ops_model_selection_events ADD COLUMN IF NOT EXISTS duration_value INTEGER`;
  await sql`ALTER TABLE ops_model_selection_events ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(8)`;
  await sql`ALTER TABLE ops_model_selection_events ADD COLUMN IF NOT EXISTS duration_seconds NUMERIC(20, 6)`;
  await sql`ALTER TABLE ops_model_selection_events ADD COLUMN IF NOT EXISTS horizon_type VARCHAR(16)`;
  await sql`ALTER TABLE ops_model_selection_events ADD COLUMN IF NOT EXISTS contract_type VARCHAR(64)`;
  await sql`
    UPDATE ops_model_selection_events
    SET duration_value = COALESCE(duration_value, horizon_ticks),
        duration_unit = COALESCE(duration_unit, 't'),
        horizon_type = COALESCE(horizon_type, 'tick')
    WHERE duration_value IS NULL OR duration_unit IS NULL OR horizon_type IS NULL
  `;
}
