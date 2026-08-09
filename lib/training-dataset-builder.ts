import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { extract37TickFeatures, type TickPoint } from './ml-feature-extractor';
import { getDbConnectionString, initDbSchema } from './db';

const DEFAULT_WINDOW_TICKS = 300;
const DEFAULT_HORIZON_TICKS = 5;
const INSERT_BATCH_SIZE = 250;

const FEATURE_SCHEMA_BASE = 'tick-features-v37';
const LABEL_SCHEMA_BASE = 'direction-v1';

type Sql = any;

type RawTick = {
  id: number;
  price: number;
  tick_epoch: number;
  tick_time: string;
  source_tick_id: string | null;
};

type SanitizedTick = RawTick;

type DatasetSample = {
  sampleIndex: number;
  split: 'train' | 'validation' | 'test';
  anchorEpoch: number;
  anchorTime: string;
  outcomeEpoch: number;
  outcomeTime: string;
  entryPrice: number;
  outcomePrice: number;
  label: 'RISE' | 'FALL';
  featureVector: number[];
  sourceWindowFromEpoch: number;
  sourceWindowToEpoch: number;
};

export type DatasetBuildRequest = {
  symbol: string;
  horizonTicks?: number;
  windowTicks?: number;
  datasetName?: string;
};

export type DatasetBuildResult = {
  datasetId: string;
  name: string;
  version: string;
  symbol: string;
  horizonTicks: number;
  windowTicks: number;
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

function getSql(): Sql | null {
  const dbUrl = getDbConnectionString();
  return dbUrl ? neon(dbUrl) : null;
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`Value must be a positive integer no greater than ${max}.`);
  }
  return parsed;
}

function resolveAssetCategory(assetClass: string | null | undefined, marketType: string | null | undefined): number {
  const value = `${assetClass ?? ''} ${marketType ?? ''}`.toLowerCase();
  if (value.includes('forex') || value.includes('currency')) return 1;
  if (value.includes('metal') || value.includes('commodity')) return 2;
  return 0;
}

function compactIsoStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/-/g, '')
    .replace(/:/g, '')
    .replace(/\./g, '')
    .replace(/T/g, '')
    .replace(/Z/g, '')
    .slice(0, 14);
}

function roundNumber(value: number, precision = 8): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function inferDeadZone(ticks: SanitizedTick[]): number {
  const moves: number[] = [];
  for (let i = 1; i < ticks.length; i += 1) {
    const move = Math.abs(ticks[i].price - ticks[i - 1].price);
    if (Number.isFinite(move) && move > 0) moves.push(move);
  }
  if (!moves.length) return 0;
  return Math.max(median(moves) * 0.25, 1e-12);
}

function deriveFeatureSchemaVersion(featureKeys: string[]): string {
  const digest = crypto.createHash('sha256').update(featureKeys.join('|')).digest('hex').slice(0, 12);
  return `${FEATURE_SCHEMA_BASE}-${featureKeys.length}-${digest}`;
}

function deriveLabelSchemaVersion(labelDeadZone: number): string {
  return `${LABEL_SCHEMA_BASE}-${roundNumber(labelDeadZone, 12)}`;
}

function buildFeatureVector(windowTicks: SanitizedTick[], symbol: string, assetCategory: number) {
  const tickPoints: TickPoint[] = windowTicks.map((tick) => ({ price: tick.price, timestamp: tick.tick_epoch * 1000 }));
  const featureObject = extract37TickFeatures(tickPoints, {
    symbol,
    assetCategoryNum: assetCategory,
    contractDurationSecs: DEFAULT_HORIZON_TICKS,
  }) as unknown as Record<string, number>;

  const featureKeys = Object.keys(featureObject);
  const featureVector = featureKeys.map((key) => Number(featureObject[key] ?? 0));
  return { featureKeys, featureVector };
}

async function ensureDatasetSampleSchema(sql: Sql) {
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
      label VARCHAR(16) NOT NULL,
      feature_vector JSONB NOT NULL,
      source_window_from_epoch BIGINT NOT NULL,
      source_window_to_epoch BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT training_dataset_samples_unique UNIQUE (dataset_id, sample_index),
      CONSTRAINT training_dataset_samples_label_check CHECK (label IN ('RISE', 'FALL'))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_training_dataset_samples_dataset_split
    ON training_dataset_samples (dataset_id, split, sample_index)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_training_dataset_samples_anchor
    ON training_dataset_samples (dataset_id, anchor_tick_epoch)
  `;
}

async function loadTicks(sql: Sql, symbol: string): Promise<SanitizedTick[]> {
  const rows = await sql`
    SELECT id, price, tick_epoch, tick_time, source_tick_id
    FROM market_ticks
    WHERE symbol = ${symbol}
      AND source = 'deriv'
    ORDER BY tick_epoch ASC, id ASC
  `;

  return (rows as RawTick[])
    .map((row) => ({
      id: Number(row.id),
      price: Number(row.price),
      tick_epoch: Number(row.tick_epoch),
      tick_time: new Date(row.tick_time).toISOString(),
      source_tick_id: row.source_tick_id == null ? null : String(row.source_tick_id),
    }))
    .filter((tick) => Number.isSafeInteger(tick.id) && tick.id > 0 && Number.isFinite(tick.price) && tick.price > 0 && Number.isSafeInteger(tick.tick_epoch));
}

async function resolveAssetContext(sql: Sql, symbol: string) {
  const rows = await sql`
    SELECT display_name, asset_class, market_type
    FROM market_assets
    WHERE symbol = ${symbol}
    LIMIT 1
  `;

  const row = (rows as any[])[0] ?? null;
  return {
    displayName: row?.display_name ? String(row.display_name) : symbol,
    assetCategory: resolveAssetCategory(row?.asset_class, row?.market_type),
  };
}

function updateChecksum(hash: crypto.Hash, sample: DatasetSample) {
  hash.update(JSON.stringify({
    i: sample.sampleIndex,
    s: sample.split,
    a: sample.anchorEpoch,
    o: sample.outcomeEpoch,
    p: sample.entryPrice,
    q: sample.outcomePrice,
    l: sample.label,
    f: sample.featureVector,
  }));
}

async function insertSamples(sql: Sql, datasetId: string, samples: DatasetSample[]) {
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
    const labels = batch.map((sample) => sample.label);
    const featureVectors = batch.map((sample) => JSON.stringify(sample.featureVector));
    const windowFrom = batch.map((sample) => sample.sourceWindowFromEpoch);
    const windowTo = batch.map((sample) => sample.sourceWindowToEpoch);

    await sql`
      INSERT INTO training_dataset_samples (
        dataset_id, sample_index, split, anchor_tick_epoch, anchor_tick_time,
        outcome_tick_epoch, outcome_tick_time, entry_price, outcome_price, label,
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
        ${labels}::text[],
        ${featureVectors}::jsonb[],
        ${windowFrom}::bigint[],
        ${windowTo}::bigint[]
      )
      ON CONFLICT (dataset_id, sample_index) DO NOTHING
    `;
  }
}

export async function buildTrainingDataset(request: DatasetBuildRequest): Promise<DatasetBuildResult> {
  const symbol = String(request.symbol ?? '').trim();
  if (!symbol) throw new Error('A Deriv symbol is required.');

  const horizonTicks = normalizePositiveInteger(request.horizonTicks, DEFAULT_HORIZON_TICKS, 5000);
  const windowTicks = normalizePositiveInteger(request.windowTicks, DEFAULT_WINDOW_TICKS, DEFAULT_WINDOW_TICKS);
  if (windowTicks !== DEFAULT_WINDOW_TICKS) throw new Error('The canonical 37-feature schema requires a 300-tick feature window.');

  const sql = getSql();
  if (!sql || !(await initDbSchema())) throw new Error('Database is unavailable or the Operations schema could not be initialized.');
  await ensureDatasetSampleSchema(sql);

  const ticks = await loadTicks(sql, symbol);
  if (ticks.length < windowTicks + horizonTicks + 1) {
    throw new Error(`Insufficient real Deriv ticks for ${symbol}. Need at least ${windowTicks + horizonTicks + 1}; found ${ticks.length}.`);
  }

  const { displayName, assetCategory } = await resolveAssetContext(sql, symbol);
  const now = new Date();
  const version = `v${compactIsoStamp(now)}`;
  const name = String(request.datasetName ?? `Deriv ${displayName} ${horizonTicks}-tick direction dataset`).trim().slice(0, 160);
  const datasetId = crypto.randomUUID();
  const hash = crypto.createHash('sha256');

  const firstUsableAnchor = windowTicks - 1;
  const lastUsableAnchor = ticks.length - horizonTicks - 1;
  const totalCandidates = lastUsableAnchor - firstUsableAnchor + 1;
  const trainBoundary = firstUsableAnchor + Math.floor(totalCandidates * 0.70);
  const validationBoundary = firstUsableAnchor + Math.floor(totalCandidates * 0.85);
  const labelDeadZone = inferDeadZone(ticks.slice(0, Math.min(ticks.length, windowTicks + horizonTicks + 100)));

  const samples: DatasetSample[] = [];
  for (let anchorIndex = firstUsableAnchor; anchorIndex <= lastUsableAnchor; anchorIndex += 1) {
    const outcomeIndex = anchorIndex + horizonTicks;
    const entry = ticks[anchorIndex];
    const outcome = ticks[outcomeIndex];
    if (!entry || !outcome) continue;

    const delta = outcome.price - entry.price;
    if (Math.abs(delta) <= labelDeadZone) continue;

    const split = anchorIndex < trainBoundary ? 'train' : anchorIndex < validationBoundary ? 'validation' : 'test';
    const featureWindow = ticks.slice(anchorIndex - windowTicks + 1, anchorIndex + 1);
    const tickPoints: TickPoint[] = featureWindow.map((tick) => ({ price: tick.price, timestamp: tick.tick_epoch * 1000 }));
    const features = extract37TickFeatures(tickPoints, {
      symbol,
      assetCategoryNum: assetCategory,
      contractDurationSecs: horizonTicks,
    }) as unknown as Record<string, number>;
    const featureKeys = Object.keys(features);
    const featureVector = featureKeys.map((key) => Number(features[key] ?? 0));
    const sample: DatasetSample = {
      sampleIndex: samples.length,
      split,
      anchorEpoch: entry.tick_epoch,
      anchorTime: entry.tick_time,
      outcomeEpoch: outcome.tick_epoch,
      outcomeTime: outcome.tick_time,
      entryPrice: entry.price,
      outcomePrice: outcome.price,
      label: delta > 0 ? 'RISE' : 'FALL',
      featureVector,
      sourceWindowFromEpoch: featureWindow[0].tick_epoch,
      sourceWindowToEpoch: featureWindow[featureWindow.length - 1].tick_epoch,
    };
    samples.push(sample);
    updateChecksum(hash, sample);
  }

  if (!samples.length) throw new Error('No non-flat directional samples could be constructed from the persisted real ticks.');

  const trainCount = samples.filter((sample) => sample.split === 'train').length;
  const validationCount = samples.filter((sample) => sample.split === 'validation').length;
  const testCount = samples.filter((sample) => sample.split === 'test').length;
  const leakageCheckPassed = samples.every((sample) => sample.outcomeEpoch > sample.anchorEpoch && sample.sourceWindowToEpoch === sample.anchorEpoch);
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
      ${datasetId}, ${name}, ${version}, ${symbol}, ${horizonTicks}, ${deriveFeatureSchemaVersion(samples[0].featureVector.map((_, index) => `f${index}`))},
      ${deriveLabelSchemaVersion(labelDeadZone)}, ${sourceFrom}, ${sourceTo}, ${samples.length}, ${trainCount},
      ${validationCount}, ${testCount}, 'completed', ${checksum}, ${leakageCheckPassed},
      ${JSON.stringify({
        source: 'deriv',
        windowTicks,
        featureCount: samples[0].featureVector.length,
        labelValues: ['RISE', 'FALL'],
        splitStrategy: 'chronological-70-15-15',
        labelDeadZone,
        excludedFlatSamples: totalCandidates - samples.length,
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
    horizonTicks,
    windowTicks,
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
