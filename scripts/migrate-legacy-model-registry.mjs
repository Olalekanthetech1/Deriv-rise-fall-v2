import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL?.trim();
const EXECUTE = process.argv.includes('--execute');
const ARCHIVE = process.argv.includes('--archive');

if (!DATABASE_URL) {
  console.error('[Legacy Model Registry Migration] DATABASE_URL is required.');
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const LEGACY_TABLE = 'ml_model_registry';
const TARGET_TABLE = 'ml_model_registry_v2';

function pick(row, ...names) {
  const entries = Object.entries(row);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && match[1] !== null && match[1] !== undefined && String(match[1]).trim() !== '') return match[1];
  }
  return null;
}

function jsonValue(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  return ['candidate', 'staging', 'production', 'retired'].includes(status) ? status : null;
}

function toInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function mapLegacyRow(row) {
  const modelId = pick(row, 'model_id', 'modelId', 'id');
  const modelFamily = pick(row, 'model_family', 'modelFamily', 'model_name', 'modelName', 'family');
  const version = pick(row, 'version', 'model_version', 'modelVersion');
  const assetSymbol = pick(row, 'asset_symbol', 'symbol', 'assetSymbol');
  const assetClass = pick(row, 'asset_class', 'assetClass');
  const horizonTicks = toInteger(pick(row, 'horizon_ticks', 'horizonTicks'));
  const horizonSeconds = toInteger(pick(row, 'horizon_secs', 'horizon_seconds', 'horizonSecs', 'duration_seconds'));
  const format = pick(row, 'format', 'model_format');
  const status = normalizeStatus(pick(row, 'status', 'state'));
  const featureSchemaVersion = pick(row, 'feature_schema_version', 'featureSchemaVersion', 'feature_schema', 'featureSchema');
  const framework = pick(row, 'framework');
  const datasetId = pick(row, 'dataset_id', 'datasetId');
  const trainingRunId = pick(row, 'training_run_id', 'trainingRunId', 'run_id');
  const metrics = jsonValue(pick(row, 'metrics'), {
    legacyAccuracy: pick(row, 'accuracy'),
    legacyBacktestWinRate: pick(row, 'backtest_win_rate', 'backtestWinRate'),
    legacyBacktestProfitFactor: pick(row, 'backtest_profit_factor', 'backtestProfitFactor'),
  });
  const hyperparameters = jsonValue(pick(row, 'hyperparameters', 'params'));

  const missing = [];
  if (!modelId) missing.push('model_id');
  if (!modelFamily) missing.push('model_family');
  if (!version) missing.push('version');
  if (!assetSymbol) missing.push('asset_symbol');
  if (!assetClass) missing.push('asset_class');
  if (!horizonTicks) missing.push('horizon_ticks');
  if (!format) missing.push('format');
  if (!status) missing.push('status');
  if (!featureSchemaVersion) missing.push('feature_schema_version');

  return {
    modelId: modelId ? String(modelId) : null,
    modelFamily: modelFamily ? String(modelFamily) : null,
    version: version ? String(version) : null,
    assetSymbol: assetSymbol ? String(assetSymbol) : null,
    assetClass: assetClass ? String(assetClass) : null,
    horizonTicks,
    horizonSeconds,
    format: format ? String(format) : null,
    status,
    featureSchemaVersion: featureSchemaVersion ? String(featureSchemaVersion) : null,
    framework: framework ? String(framework) : null,
    datasetId: datasetId ? String(datasetId) : null,
    trainingRunId: trainingRunId ? String(trainingRunId) : null,
    metrics,
    hyperparameters,
    missing,
    raw: row,
  };
}

async function tableExists(tableName) {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function loadLegacyRows() {
  // The table name is a fixed internal identifier, not user input.
  const rows = await sql.query(`SELECT to_jsonb(t) AS row FROM public.${LEGACY_TABLE} AS t`);
  return rows.map((entry) => entry.row ?? {});
}

async function main() {
  const legacyExists = await tableExists(LEGACY_TABLE);
  const targetExists = await tableExists(TARGET_TABLE);

  if (!legacyExists) {
    console.log('[Legacy Model Registry Migration] No legacy table exists. Nothing to migrate.');
    return;
  }
  if (!targetExists) {
    throw new Error(`${TARGET_TABLE} does not exist. Deploy the new registry architecture before migrating legacy data.`);
  }

  const rows = await loadLegacyRows();
  const mapped = rows.map(mapLegacyRow);
  const migratable = mapped.filter((row) => row.missing.length === 0);
  const skipped = mapped.filter((row) => row.missing.length > 0);

  console.log(JSON.stringify({
    mode: EXECUTE ? 'execute' : 'dry-run',
    archiveAfterMigration: ARCHIVE,
    legacyTable: LEGACY_TABLE,
    targetTable: TARGET_TABLE,
    legacyRows: rows.length,
    migratableRows: migratable.length,
    skippedRows: skipped.length,
    skipped: skipped.map((row) => ({ modelId: row.modelId, missing: row.missing })),
  }, null, 2));

  if (!EXECUTE) {
    console.log('[Legacy Model Registry Migration] Dry-run only. No database mutation performed.');
    return;
  }

  if (skipped.length) {
    throw new Error(`Migration blocked: ${skipped.length} legacy row(s) cannot be mapped without inventing required model metadata.`);
  }

  await sql`BEGIN`;
  try {
    for (const row of migratable) {
      const metrics = {
        ...jsonValue(row.metrics),
        legacyRegistryMigration: true,
        legacyRegistrySource: LEGACY_TABLE,
        legacyRegistryRow: row.raw,
      };
      await sql`
        INSERT INTO ${sql(TARGET_TABLE)} (
          model_id, model_family, version, asset_symbol, asset_class, horizon_ticks,
          dataset_id, format, status, feature_schema_version, framework, training_run_id,
          metrics, hyperparameters, updated_at
        ) VALUES (
          ${row.modelId}, ${row.modelFamily}, ${row.version}, ${row.assetSymbol}, ${row.assetClass}, ${row.horizonTicks},
          ${row.datasetId || null}::uuid, ${row.format}, ${row.status}, ${row.featureSchemaVersion}, ${row.framework || null}, ${row.trainingRunId || null}::uuid,
          ${JSON.stringify(metrics)}::jsonb, ${JSON.stringify(row.hyperparameters)}::jsonb, NOW()
        )
        ON CONFLICT (model_id) DO NOTHING
      `;
    }

    const verification = await sql`
      SELECT COUNT(*)::int AS count
      FROM ml_model_registry_v2
      WHERE metrics->>'legacyRegistryMigration' = 'true'
    `;
    const migratedCount = Number(verification[0]?.count ?? 0);
    if (migratedCount < migratable.length) {
      throw new Error(`Migration verification failed: expected at least ${migratable.length} migrated rows, found ${migratedCount}.`);
    }

    await sql`
      INSERT INTO ops_audit_events (category, severity, actor, action, resource_type, resource_id, metadata)
      VALUES (
        'model-registry', 'info', 'migration-script', 'migrate-legacy-registry', 'table', ${LEGACY_TABLE},
        ${JSON.stringify({ source: LEGACY_TABLE, target: TARGET_TABLE, migratedCount: migratable.length })}::jsonb
      )
    `;

    if (ARCHIVE) {
      const archiveName = `ml_model_registry_legacy_archive_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
      await sql.query(`ALTER TABLE public.${LEGACY_TABLE} RENAME TO ${archiveName}`);
      console.log(`[Legacy Model Registry Migration] Legacy table archived as ${archiveName}.`);
    }

    await sql`COMMIT`;
    console.log(`[Legacy Model Registry Migration] Successfully migrated ${migratable.length} row(s) into ${TARGET_TABLE}.`);
  } catch (error) {
    await sql`ROLLBACK`;
    throw error;
  }
}

main().catch((error) => {
  console.error('[Legacy Model Registry Migration] FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
