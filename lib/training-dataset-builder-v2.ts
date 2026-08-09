import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { extract37TickFeatures, type TickPoint } from './ml-feature-extractor';
import { initDbSchema, getDbConnectionString } from './db';
import {
  ensureDatasetSchemaRegistry,
  featureVectorFromRecord,
  getActiveFeatureSchema,
  getActiveHorizons,
  getFeatureSchemaVersion,
  getRequiredWindowTicks,
  getWindowProfile,
} from './dataset-schema-registry';

const INSERT_BATCH_SIZE = 250;
const MAX_HORIZON_TICKS = 5000;
const MAX_WINDOW_TICKS = 5000;

type SqlClient = ReturnType<typeof neon>;

type RawTick = {
  price: number;
  tick_epoch: number;
  tick_time: string;
  source_tick_id: string | null;
};

type LabelOutcome = {
  label: 'RISE' | 'FALL' | null;
  delta: number;
  returnBps: number;
  confidence: number;
};

export type DatasetBuildRequest = {
  symbol: string;
  horizonTicks: number;
  datasetName?: string;
};

export type DatasetBuildResult = {
  datasetId: string;
  name: string;
  version: string;
  symbol: string;
  horizonTicks: number;
  windowTicks: number;
  featureCount: number;
  featureSchemaVersion: string;
  labelSchemaVersion: string;
  labelDeadZone: number;
  ambiguousSamplesExcluded: number;
  sampleCount: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  sourceFrom: string;
  sourceTo: string;
  checksum: string;
  leakageCheckPassed: boolean;
  status: 'completed';
};

type DatasetSample = {
  sampleIndex: number;
  split: 'train' | 'validation' | 'test';
  anchorEpoch: number;
  anchorTime: string;
  outcomeEpoch: number;
  outcomeTime: string;
  entryPrice: number;
  outcomePrice: number;
  outcomeDelta: number;
  outcomeReturnBps: number;
  label: 'RISE' | 'FALL';
  labelConfidence: number;
  labelDeadZone: number;
  featureVector: number[];
  sourceWindowFromEpoch: number;
  sourceWindowToEpoch: number;
};

function getSql(): SqlClient | null {
  const dbUrl = getDbConnectionString();
  return dbUrl ? (neon(dbUrl) as SqlClient) : null;
}

function normalizePositiveInteger(value: unknown, field: string, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${field} must be a positive integer no greater than ${max}.`);
  }
  return parsed;
}

function resolveAssetCategory(assetClass: string | null | undefined, marketType: string | null | undefined): number {
  const value = `${assetClass ?? ''} ${marketType ?? ''}`.toLowerCase();
  if (value.includes('forex') || value.includes('currency')) return 1;
  if (value.includes('metal') || value.includes('commodity')) return 2;
  return 0;
}

function hashShort(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
}

function estimateLabelDeadZone(ticks: RawTick[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < ticks.length; i += 1) {
    const prev = ticks[i - 1];
    const current = ticks[i];
    const delta = Math.abs(current.price - prev.price);
    if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
  }

  if (!deltas.length) {
    throw new Error('Unable to infer label dead zone from real ticks.');
  }

  deltas.sort((a, b) => a - b);
  const smallest = deltas[0];
  return Math.max(Number.EPSILON, smallest / 2);
}

function classifyOutcome(entryPrice: number, outcomePrice: number, deadZone: number): LabelOutcome {
  const delta = outcomePrice - entryPrice;
  const returnBps = entryPrice > 0 ? (delta / entryPrice) * 10_000 : 0;
  const confidenceBase = Math.max(deadZone * 4, deadZone);
  const confidence = confidenceBase > 0 ? Math.min(1, Math.abs(delta) / confidenceBase) : 1;

  if (delta > deadZone) {
    return { label: 'RISE', delta, returnBps, confidence };
  }
  if (delta < -deadZone) {
    return { label: 'FALL', delta, returnBps, confidence };
  }
  return { label: null, delta, returnBps, confidence };
}

function labelSchemaVersionFromPolicy(policy: { featureSchemaVersion: string; horizonTicks: number; labelDeadZone: number }): string {
  return `label-dz-${hashShort(policy)}`;
}

async function ensureDatasetSampleSchema(sql: SqlClient) {
  await sql`
    CREATE TABLE IF NOT EXISTS training_dataset_samples (
      id BIGSERIAL PRIMARY KEY,
      dataset_id UUID NOT NULL REFERENCES training_datasets(id) ON DELETE CASCADE,
      sample_index INTEGER NOT NULL,
      split VARCHAR(16) NOT NULL,
      anchor_tick_epoch BIGINT NOT NULL,
      anchor_tick_time TIMESTAMPTZ NOT NULL,
      outcome_tick_epoch BIGINT NOT NULL,
      outcome_tick_time TIMESTAMPTZ NOT NULL,
      entry_price NUMERIC(30, 12) NOT NULL,
      outcome_price NUMERIC(30, 12) NOT NULL,
      outcome_delta NUMERIC(30, 12) NOT NULL DEFAULT 0,
      outcome_return_bps NUMERIC(30, 12) NOT NULL DEFAULT 0,
      label VARCHAR(16) NOT NULL,
      label_confidence NUMERIC(12, 8) NOT NULL DEFAULT 0,
      label_dead_zone NUMERIC(30, 12) NOT NULL DEFAULT 0,
      feature_vector JSONB NOT NULL,
      source_window_from_epoch BIGINT NOT NULL,
      source_window_to_epoch BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT training_dataset_samples_unique UNIQUE (dataset_id, sample_index),
      CONSTRAINT training_dataset_samples_label_check CHECK (label IN ('RISE', 'FALL'))
    )
  `;

  await sql`ALTER TABLE training_dataset_samples ADD COLUMN IF NOT EXISTS outcome_delta NUMERIC(30, 12) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE training_dataset_samples ADD COLUMN IF NOT EXISTS outcome_return_bps NUMERIC(30, 12) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE training_dataset_samples ADD COLUMN IF NOT EXISTS label_confidence NUMERIC(12, 8) NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE training_dataset_samples ADD COLUMN IF NOT EXISTS label_dead_zone NUMERIC(30, 12) NOT NULL DEFAULT 0`;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_training_dataset_samples_dataset_split
    ON training_dataset_samples (dataset_id, split, sample_index)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_training_dataset_samples_anchor
    ON training_dataset_samples (dataset_id, anchor_tick_epoch)
  `;
}

async function loadTicks(sql: SqlClient, symbol: string): Promise<RawTick[]> {
  const rows = await sql`
    SELECT price, tick_epoch, tick_time, source_tick_id
    FROM market_ticks
    WHERE symbol = ${symbol} AND source = 'deriv'
    ORDER BY tick_epoch ASC, id ASC
  `;

  return (rows as any[])
    .map((row: any) => ({
      price: Number(row.price),
      tick_epoch: Number(row.tick_epoch),
      tick_time: new Date(row.tick_time).toISOString(),
      source_tick_id: row.source_tick_id == null ? null : String(row.source_tick_id),
    }))
    .filter((tick) => Number.isFinite(tick.price) && tick.price > 0 && Number.isSafeInteger(tick.tick_epoch));
}

async function resolveAssetContext(sql: SqlClient, symbol: string) {
  const rows = await sql`
    SELECT asset_class, market_type
    FROM market_assets
    WHERE symbol = ${symbol}
    LIMIT 1
  `;
  const row = (rows as any[])[0] as any;
  return { assetCategory: resolveAssetCategory(row?.asset_class, row?.market_type) };
}

function updateChecksum(hash: crypto.Hash, sample: DatasetSample) {
  hash.update(JSON.stringify({
    i: sample.sampleIndex,
    s: sample.split,
    a: sample.anchorEpoch,
    o: sample.outcomeEpoch,
    p: sample.entryPrice,
    q: sample.outcomePrice,
    d: sample.outcomeDelta,
    bps: sample.outcomeReturnBps,
    l: sample.label,
    c: sample.labelConfidence,
    dz: sample.labelDeadZone,
    f: sample.featureVector,
  }));
}

async function insertSamples(sql: SqlClient, datasetId: string, samples: DatasetSample[]) {
  for (let offset = 0; offset < samples.length; offset += INSERT_BATCH_SIZE) {
    const batch = samples.slice(offset, offset + INSERT_BATCH_SIZE);
    const datasetIds = batch.map(() => datasetId);
    const indexes = batch.map((sample) => sample.sampleIndex);
    const splits = batch.map((sample) => sample.split);
    const anchorEpochs = batch.map((sample) => sample.anchorEpoch);
    const anchorTimes = batch.map((sample) => sample.anchorTime);
    const outcomeEpochs = batch.map((sample) => sample.outcomeEpoch);
    const outcomeTimes = batch.map((sample) => sample.outcomeTime);
    const entryPrices = batch.map((sample) => sample.entryPrice);
    const outcomePrices = batch.map((sample) => sample.outcomePrice);
    const outcomeDeltas = batch.map((sample) => sample.outcomeDelta);
    const outcomeReturnBps = batch.map((sample) => sample.outcomeReturnBps);
    const labels = batch.map((sample) => sample.label);
    const labelConfidence = batch.map((sample) => sample.labelConfidence);
    const labelDeadZone = batch.map((sample) => sample.labelDeadZone);
    const featureVectors = batch.map((sample) => JSON.stringify(sample.featureVector));
    const windowFrom = batch.map((sample) => sample.sourceWindowFromEpoch);
    const windowTo = batch.map((sample) => sample.sourceWindowToEpoch);

    await sql`
      INSERT INTO training_dataset_samples (
        dataset_id, sample_index, split, anchor_tick_epoch, anchor_tick_time,
        outcome_tick_epoch, outcome_tick_time, entry_price, outcome_price,
        outcome_delta, outcome_return_bps, label, label_confidence, label_dead_zone,
        feature_vector, source_window_from_epoch, source_window_to_epoch
      )
      SELECT * FROM UNNEST(
        ${datasetIds}::uuid[],
        ${indexes}::integer[],
        ${splits}::text[],
        ${anchorEpochs}::bigint[],
        ${anchorTimes}::timestamptz[],
        ${outcomeEpochs}::bigint[],
        ${outcomeTimes}::timestamptz[],
        ${entryPrices}::numeric[],
        ${outcomePrices}::numeric[],
        ${outcomeDeltas}::numeric[],
        ${outcomeReturnBps}::numeric[],
        ${labels}::text[],
        ${labelConfidence}::numeric[],
        ${labelDeadZone}::numeric[],
        ${featureVectors}::jsonb[],
        ${windowFrom}::bigint[],
        ${windowTo}::bigint[]
      )
      ON CONFLICT (dataset_id, sample_index) DO NOTHING
    `;
  }
}

export async function getDatasetBuilderSchema() {
  const sql = getSql();
  if (!sql || !(await initDbSchema())) throw new Error('Database is unavailable.');
  await ensureDatasetSchemaRegistry(sql);
  const [features, horizons] = await Promise.all([
    getActiveFeatureSchema(sql),
    getActiveHorizons(sql),
  ]);
  if (!features.length) throw new Error('No active dataset features are configured.');
  if (!horizons.length) throw new Error('No active prediction horizons are configured.');
  const featureSchemaVersion = getFeatureSchemaVersion(features);
  return {
    featureCount: features.length,
    featureSchemaVersion,
    requiredWindowTicks: getRequiredWindowTicks(features),
    features,
    horizons,
    labelPolicy: {
      schemaVersion: `label-dz-${hashShort({ featureSchemaVersion, horizons: horizons.map((h) => h.tickCount) })}`,
      strategy: 'directional-dead-zone',
      labelValues: ['RISE', 'FALL'],
      description: 'Labels are generated from future price direction after applying a dynamic dead-zone derived from observed real tick increments.',
    },
  };
}

export async function buildTrainingDataset(request: DatasetBuildRequest): Promise<DatasetBuildResult> {
  const symbol = String(request.symbol ?? '').trim();
  if (!symbol) throw new Error('A Deriv symbol is required.');

  const horizonTicks = normalizePositiveInteger(request.horizonTicks, 'horizonTicks', MAX_HORIZON_TICKS);
  const sql = getSql();
  if (!sql || !(await initDbSchema())) throw new Error('Database is unavailable or the Operations schema could not be initialized.');
  await ensureDatasetSchemaRegistry(sql);
  await ensureDatasetSampleSchema(sql);

  const [featureSchema, horizons] = await Promise.all([
    getActiveFeatureSchema(sql),
    getActiveHorizons(sql),
  ]);
  if (!featureSchema.length) throw new Error('No active dataset features are configured.');
  const horizon = horizons.find((item) => item.tickCount === horizonTicks);
  if (!horizon) throw new Error(`Horizon ${horizonTicks} ticks is not an active configured dataset horizon.`);

  const windowTicks = getRequiredWindowTicks(featureSchema);
  if (!Number.isSafeInteger(windowTicks) || windowTicks <= 0 || windowTicks > MAX_WINDOW_TICKS) {
    throw new Error(`Configured feature window is invalid: ${windowTicks}.`);
  }
  const windowProfile = getWindowProfile(featureSchema);

  const ticks = await loadTicks(sql, symbol);
  const minimumRequired = windowTicks + horizon.tickCount + 1;
  if (ticks.length < minimumRequired) {
    throw new Error(`Insufficient real Deriv ticks for ${symbol}. Need at least ${minimumRequired}; found ${ticks.length}.`);
  }

  const { assetCategory } = await resolveAssetContext(sql, symbol);
  const now = new Date();
  const featureSchemaVersion = getFeatureSchemaVersion(featureSchema);
  const labelDeadZone = estimateLabelDeadZone(ticks);
  const labelSchemaVersion = labelSchemaVersionFromPolicy({ featureSchemaVersion, horizonTicks: horizon.tickCount, labelDeadZone });
  const version = `v${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const name = String(request.datasetName ?? `Deriv ${symbol} ${horizon.tickCount}-tick direction dataset`).trim().slice(0, 160);
  const datasetId = crypto.randomUUID();
  const hash = crypto.createHash('sha256');

  const firstUsableAnchor = windowTicks - 1;
  const lastUsableAnchor = ticks.length - horizon.tickCount - 1;
  const totalCandidates = lastUsableAnchor - firstUsableAnchor + 1;
  const trainBoundary = firstUsableAnchor + Math.floor(totalCandidates * 0.70);
  const validationBoundary = firstUsableAnchor + Math.floor(totalCandidates * 0.85);

  const samples: DatasetSample[] = [];
  let ambiguousSamplesExcluded = 0;

  for (let anchorIndex = firstUsableAnchor; anchorIndex <= lastUsableAnchor; anchorIndex += 1) {
    const outcomeIndex = anchorIndex + horizon.tickCount;
    const entry = ticks[anchorIndex];
    const outcome = ticks[outcomeIndex];
    if (!entry || !outcome || outcome.tick_epoch <= entry.tick_epoch) continue;

    const labelOutcome = classifyOutcome(entry.price, outcome.price, labelDeadZone);
    if (!labelOutcome.label) {
      ambiguousSamplesExcluded += 1;
      continue;
    }

    const split = anchorIndex < trainBoundary ? 'train' : anchorIndex < validationBoundary ? 'validation' : 'test';
    const featureWindow = ticks.slice(anchorIndex - windowTicks + 1, anchorIndex + 1);
    if (featureWindow.length !== windowTicks) continue;

    const tickPoints: TickPoint[] = featureWindow.map((tick) => ({
      price: tick.price,
      timestamp: tick.tick_epoch * 1000,
    }));
    const features = extract37TickFeatures(tickPoints, {
      symbol,
      assetCategoryNum: assetCategory,
      contractDurationSecs: horizon.durationSeconds ?? horizon.tickCount,
      windowProfile,
    });
    const featureVector = featureVectorFromRecord(features as unknown as Record<string, number>, featureSchema);

    const sample: DatasetSample = {
      sampleIndex: samples.length,
      split,
      anchorEpoch: entry.tick_epoch,
      anchorTime: entry.tick_time,
      outcomeEpoch: outcome.tick_epoch,
      outcomeTime: outcome.tick_time,
      entryPrice: entry.price,
      outcomePrice: outcome.price,
      outcomeDelta: labelOutcome.delta,
      outcomeReturnBps: labelOutcome.returnBps,
      label: labelOutcome.label,
      labelConfidence: labelOutcome.confidence,
      labelDeadZone,
      featureVector,
      sourceWindowFromEpoch: featureWindow[0].tick_epoch,
      sourceWindowToEpoch: featureWindow[featureWindow.length - 1].tick_epoch,
    };
    samples.push(sample);
    updateChecksum(hash, sample);
  }

  if (!samples.length) throw new Error('No directional samples could be constructed from the persisted real ticks.');

  const trainCount = samples.filter((sample) => sample.split === 'train').length;
  const validationCount = samples.filter((sample) => sample.split === 'validation').length;
  const testCount = samples.filter((sample) => sample.split === 'test').length;
  const leakageCheckPassed = samples.every((sample) => (
    sample.outcomeEpoch > sample.anchorEpoch &&
    sample.sourceWindowToEpoch === sample.anchorEpoch &&
    sample.outcomeEpoch > sample.sourceWindowToEpoch
  ));
  if (!leakageCheckPassed) throw new Error('Dataset leakage validation failed. No dataset was persisted.');

  const checksum = hash.digest('hex');
  const sourceFrom = ticks[0].tick_time;
  const sourceTo = ticks[ticks.length - 1].tick_time;

  await sql`
    INSERT INTO training_datasets (
      id, name, version, asset_symbol, horizon_ticks, feature_schema_version,
      label_schema_version, source_from, source_to, sample_count, train_count,
      validation_count, test_count, status, checksum, leakage_check_passed, metadata
    ) VALUES (
      ${datasetId}, ${name}, ${version}, ${symbol}, ${horizon.tickCount}, ${featureSchemaVersion},
      ${labelSchemaVersion}, ${sourceFrom}, ${sourceTo}, ${samples.length}, ${trainCount},
      ${validationCount}, ${testCount}, 'completed', ${checksum}, ${leakageCheckPassed},
      ${JSON.stringify({
        source: 'deriv',
        windowTicks,
        featureCount: featureSchema.length,
        featureSchemaVersion,
        featureKeys: featureSchema.map((feature) => feature.key),
        horizonId: horizon.id,
        horizonLabel: horizon.label,
        labelSchemaVersion,
        labelPolicy: {
          strategy: 'directional-dead-zone',
          deadZone: labelDeadZone,
          labelValues: ['RISE', 'FALL'],
        },
        splitStrategy: 'chronological-70-15-15',
        excludedAmbiguousSamples: ambiguousSamplesExcluded,
        generatedAt: now.toISOString(),
      })}::jsonb
    )
  `;

  try {
    await insertSamples(sql, datasetId, samples);
  } catch (error) {
    await sql`DELETE FROM training_datasets WHERE id = ${datasetId}`;
    throw error;
  }

  return {
    datasetId,
    name,
    version,
    symbol,
    horizonTicks: horizon.tickCount,
    windowTicks,
    featureCount: featureSchema.length,
    featureSchemaVersion,
    labelSchemaVersion,
    labelDeadZone,
    ambiguousSamplesExcluded,
    sampleCount: samples.length,
    trainCount,
    validationCount,
    testCount,
    sourceFrom,
    sourceTo,
    checksum,
    leakageCheckPassed,
    status: 'completed',
  };
}

export async function listTrainingDatasets(symbol?: string) {
  const sql = getSql();
  if (!sql || !(await initDbSchema())) return [];
  await ensureDatasetSchemaRegistry(sql);
  await ensureDatasetSampleSchema(sql);
  if (symbol) {
    return await sql`
      SELECT id, name, version, asset_symbol, horizon_ticks, feature_schema_version,
        label_schema_version, source_from, source_to, sample_count, train_count,
        validation_count, test_count, status, checksum, leakage_check_passed,
        metadata, created_at
      FROM training_datasets
      WHERE asset_symbol = ${symbol}
      ORDER BY created_at DESC
      LIMIT 50
    `;
  }
  return await sql`
    SELECT id, name, version, asset_symbol, horizon_ticks, feature_schema_version,
      label_schema_version, source_from, source_to, sample_count, train_count,
      validation_count, test_count, status, checksum, leakage_check_passed,
      metadata, created_at
    FROM training_datasets
    ORDER BY created_at DESC
    LIMIT 50
  `;
}
