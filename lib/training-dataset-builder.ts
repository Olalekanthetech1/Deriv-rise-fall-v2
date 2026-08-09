import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { extract37TickFeatures, featureObjToArray, type TickPoint } from './ml-feature-extractor';
import { initDbSchema, getDbConnectionString } from './db';

const FEATURE_SCHEMA_VERSION = 'tick-features-v37';
const LABEL_SCHEMA_VERSION = 'direction-deadzone-v2';
const NORMALIZATION_VERSION = 'zscore-v1';
const DEFAULT_WINDOW_TICKS = 300;
const DEFAULT_HORIZON_TICKS = 5;
const INSERT_BATCH_SIZE = 250;

type Sql = ReturnType<typeof neon>;

export type DatasetBuildRequest = {
  symbol: string;
  horizonTicks?: number;
  windowTicks?: number;
  datasetName?: string;
};

export type DatasetQualityReport = {
  status: 'READY' | 'REVIEW';
  totalTicks: number;
  validTicks: number;
  invalidTicks: number;
  duplicateTicks: number;
  candidateSamples: number;
  generatedSamples: number;
  excludedMissingWindows: number;
  excludedAmbiguousTargets: number;
  excludedSplitGap: number;
  featureCount: number;
  trainCount: number;
  validationCount: number;
  testCount: number;
  splitGapTicks: number;
  leakageCheckPassed: boolean;
  temporalSplitValidated: boolean;
  normalizationVersion: string;
  featureSchemaVersion: string;
  labelSchemaVersion: string;
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
  normalizationVersion: string;
  datasetFingerprint: string;
  qualityReport: DatasetQualityReport;
  status: 'completed';
};

type RawTickRow = {
  id: number;
  price: number;
  tick_epoch: number;
  tick_time: string;
  source_tick_id: string | null;
};

type SanitizedTick = {
  price: number;
  tick_epoch: number;
  tick_time: string;
  source_tick_id: string | null;
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
  rawFeatureVector: number[];
  featureVector: number[];
  sourceWindowFromEpoch: number;
  sourceWindowToEpoch: number;
};

type NormalizationStats = {
  version: string;
  means: number[];
  stdDevs: number[];
  featureCount: number;
  trainSampleCount: number;
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
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replaceAll('.', '').replaceAll('T', '').replaceAll('Z', '').slice(0, 14);
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

function computeMedianTickMove(windowTicks: SanitizedTick[]): number {
  const moves: number[] = [];
  for (let i = 1; i < windowTicks.length; i += 1) {
    const move = Math.abs(windowTicks[i].price - windowTicks[i - 1].price);
    if (Number.isFinite(move)) moves.push(move);
  }
  return median(moves);
}

function computeLabelDeadZone(entryPrice: number, windowTicks: SanitizedTick[]): number {
  const medianMove = computeMedianTickMove(windowTicks);
  const priceFloor = Math.max(entryPrice * 1e-8, 1e-12);
  return Math.max(medianMove * 0.25, priceFloor);
}

function computeNormalizationStats(samples: DatasetSample[], featureCount: number): NormalizationStats {
  const trainSamples = samples.filter((sample) => sample.split === 'train');
  if (!trainSamples.length) throw new Error('Training split is empty; normalization cannot be computed.');

  const means = Array.from({ length: featureCount }, (_, index) => {
    const values = trainSamples.map((sample) => sample.rawFeatureVector[index]).filter((value) => Number.isFinite(value));
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  });

  const stdDevs = Array.from({ length: featureCount }, (_, index) => {
    const values = trainSamples.map((sample) => sample.rawFeatureVector[index]).filter((value) => Number.isFinite(value));
    if (values.length < 2) return 1;
    const mean = means[index];
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.max(Math.sqrt(variance), 1e-9);
  });

  return {
    version: NORMALIZATION_VERSION,
    means,
    stdDevs,
    featureCount,
    trainSampleCount: trainSamples.length,
  };
}

function normalizeFeatureVector(values: number[], stats: NormalizationStats): number[] {
  return values.map((value, index) => {
    const mean = stats.means[index] ?? 0;
    const std = stats.stdDevs[index] ?? 1;
    const normalized = (value - mean) / std;
    return roundNumber(Math.max(-8, Math.min(8, normalized)), 8);
  });
}

function computeChecksum(samples: DatasetSample[], meta: Record<string, unknown>): string {
  const hash = crypto.createHash('sha256');
  for (const sample of samples) {
    hash.update(JSON.stringify({
      sampleIndex: sample.sampleIndex,
      split: sample.split,
      anchorEpoch: sample.anchorEpoch,
      outcomeEpoch: sample.outcomeEpoch,
      entryPrice: sample.entryPrice,
      outcomePrice: sample.outcomePrice,
      outcomeDelta: sample.outcomeDelta,
      outcomeReturnBps: sample.outcomeReturnBps,
      label: sample.label,
      labelConfidence: sample.labelConfidence,
      labelDeadZone: sample.labelDeadZone,
      featureVector: sample.featureVector,
      sourceWindowFromEpoch: sample.sourceWindowFromEpoch,
      sourceWindowToEpoch: sample.sourceWindowToEpoch,
    }));
  }
  hash.update(JSON.stringify(meta));
  return hash.digest('hex');
}

function computeDatasetFingerprint(input: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function qualityStatus(report: Omit<DatasetQualityReport, 'status'>): DatasetQualityReport['status'] {
  return report.generatedSamples > 0 && report.leakageCheckPassed && report.temporalSplitValidated ? 'READY' : 'REVIEW';
}

function sanitizeTicks(rows: RawTickRow[]): { ticks: SanitizedTick[]; invalidTicks: number; duplicateTicks: number } {
  const seen = new Set<string>();
  let invalidTicks = 0;
  let duplicateTicks = 0;
  const sorted = [...rows].sort((a, b) => a.tick_epoch - b.tick_epoch || a.id - b.id);
  const ticks: SanitizedTick[] = [];

  for (const row of sorted) {
    const price = Number(row.price);
    const tickEpoch = Number(row.tick_epoch);
    const tickTime = row.tick_time ? new Date(row.tick_time).toISOString() : '';
    const sourceTickId = row.source_tick_id == null ? null : String(row.source_tick_id);

    if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(tickEpoch) || tickEpoch <= 0 || !tickTime) {
      invalidTicks += 1;
      continue;
    }

    const key = sourceTickId ? `sid:${sourceTickId}` : `epoch:${tickEpoch}:price:${price}`;
    if (seen.has(key)) {
      duplicateTicks += 1;
      continue;
    }
    seen.add(key);
    ticks.push({ price, tick_epoch: tickEpoch, tick_time: tickTime, source_tick_id: sourceTickId });
  }

  return { ticks, invalidTicks, duplicateTicks };
}

async function ensureDatasetSchema(sql: Sql) {
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

async function loadTicks(sql: Sql, symbol: string): Promise<RawTickRow[]> {
  const rows = await sql`
    SELECT id, price, tick_epoch, tick_time, source_tick_id
    FROM market_ticks
    WHERE symbol = ${symbol} AND source = 'deriv'
    ORDER BY tick_epoch ASC, id ASC
  `;

  return (rows as any[]).map((row: any) => ({
    id: Number(row.id),
    price: Number(row.price),
    tick_epoch: Number(row.tick_epoch),
    tick_time: row.tick_time ? new Date(row.tick_time).toISOString() : '',
    source_tick_id: row.source_tick_id == null ? null : String(row.source_tick_id),
  })).filter((tick) => Number.isFinite(tick.price) && tick.price > 0 && Number.isSafeInteger(tick.tick_epoch) && tick.tick_epoch > 0);
}

async function resolveAssetContext(sql: Sql, symbol: string) {
  const rows = await sql`
    SELECT asset_class, market_type
    FROM market_assets
    WHERE symbol = ${symbol}
    LIMIT 1
  `;
  const row = (rows as any[])[0];
  return {
    assetCategory: resolveAssetCategory(row?.asset_class, row?.market_type),
  };
}

function resolveSplit(anchorIndex: number, trainCut: number, validationCut: number, splitGapTicks: number): DatasetSample['split'] | null {
  if (anchorIndex <= trainCut - splitGapTicks) return 'train';
  if (anchorIndex >= trainCut + splitGapTicks && anchorIndex <= validationCut - splitGapTicks) return 'validation';
  if (anchorIndex >= validationCut + splitGapTicks) return 'test';
  return null;
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
  const symbol = String(request.symbol ?? '').trim().toUpperCase();
  if (!symbol) throw new Error('A Deriv symbol is required.');

  const horizonTicks = normalizePositiveInteger(request.horizonTicks, DEFAULT_HORIZON_TICKS, 5000);
  const windowTicks = normalizePositiveInteger(request.windowTicks, DEFAULT_WINDOW_TICKS, DEFAULT_WINDOW_TICKS);
  if (windowTicks !== DEFAULT_WINDOW_TICKS) throw new Error('The canonical 37-feature schema requires a 300-tick feature window.');

  const sql = getSql();
  if (!sql || !(await initDbSchema())) throw new Error('Database is unavailable or the Operations schema could not be initialized.');
  await ensureDatasetSchema(sql);

  const loadedTicks = await loadTicks(sql, symbol);
  const { ticks: validTicks, invalidTicks, duplicateTicks } = sanitizeTicks(loadedTicks);
  if (validTicks.length < windowTicks + horizonTicks + 1) {
    throw new Error(`Insufficient real Deriv ticks for ${symbol}. Need at least ${windowTicks + horizonTicks + 1}; found ${validTicks.length}.`);
  }

  const { assetCategory } = await resolveAssetContext(sql, symbol);
  const now = new Date();
  const startedAt = now.toISOString();
  const firstUsableAnchor = windowTicks - 1;
  const lastUsableAnchor = validTicks.length - horizonTicks - 1;
  const totalCandidates = lastUsableAnchor - firstUsableAnchor + 1;
  const trainCut = firstUsableAnchor + Math.floor(totalCandidates * 0.70);
  const validationCut = firstUsableAnchor + Math.floor(totalCandidates * 0.85);
  const splitGapTicks = windowTicks + horizonTicks;

  const rawSamples: DatasetSample[] = [];
  let excludedMissingWindows = 0;
  let excludedAmbiguousTargets = 0;
  let excludedSplitGap = 0;
  let featureKeys: string[] = [];
  let featureCount = 0;

  for (let anchorIndex = firstUsableAnchor; anchorIndex <= lastUsableAnchor; anchorIndex += 1) {
    const split = resolveSplit(anchorIndex, trainCut, validationCut, splitGapTicks);
    if (!split) {
      excludedSplitGap += 1;
      continue;
    }

    const featureWindow = validTicks.slice(anchorIndex - windowTicks + 1, anchorIndex + 1);
    if (featureWindow.length !== windowTicks) {
      excludedMissingWindows += 1;
      continue;
    }

    const entry = validTicks[anchorIndex];
    const outcome = validTicks[anchorIndex + horizonTicks];
    if (!entry || !outcome) {
      excludedMissingWindows += 1;
      continue;
    }

    const rawFeatureObject = extract37TickFeatures(
      featureWindow.map((tick) => ({ price: tick.price, timestamp: tick.tick_epoch * 1000 })),
      {
        symbol,
        assetCategoryNum: assetCategory,
        contractDurationSecs: horizonTicks,
      }
    );

    const rawFeatureVector = featureObjToArray(rawFeatureObject).map((value) => Number(value));
    if (!featureCount) {
      featureCount = rawFeatureVector.length;
      featureKeys = Object.keys(rawFeatureObject);
    } else if (rawFeatureVector.length !== featureCount) {
      throw new Error(`Feature vector length mismatch for ${symbol}. Expected ${featureCount}, received ${rawFeatureVector.length}.`);
    }

    const outcomeDelta = outcome.price - entry.price;
    const outcomeReturnBps = roundNumber((outcomeDelta / entry.price) * 10000, 8);
    const labelDeadZone = computeLabelDeadZone(entry.price, featureWindow);
    if (Math.abs(outcomeDelta) <= labelDeadZone) {
      excludedAmbiguousTargets += 1;
      continue;
    }

    const labelConfidence = roundNumber(Math.min(1, Math.abs(outcomeDelta) / Math.max(labelDeadZone * 4, entry.price * 1e-8)), 8);
    rawSamples.push({
      sampleIndex: rawSamples.length,
      split,
      anchorEpoch: entry.tick_epoch,
      anchorTime: entry.tick_time,
      outcomeEpoch: outcome.tick_epoch,
      outcomeTime: outcome.tick_time,
      entryPrice: entry.price,
      outcomePrice: outcome.price,
      outcomeDelta,
      outcomeReturnBps,
      label: outcomeDelta > 0 ? 'RISE' : 'FALL',
      labelConfidence,
      labelDeadZone,
      rawFeatureVector,
      featureVector: [],
      sourceWindowFromEpoch: featureWindow[0].tick_epoch,
      sourceWindowToEpoch: featureWindow[featureWindow.length - 1].tick_epoch,
    });
  }

  if (!rawSamples.length) throw new Error('No non-flat directional samples could be constructed from the persisted real ticks.');

  const normalization = computeNormalizationStats(rawSamples, featureCount || rawSamples[0].rawFeatureVector.length);
  const samples = rawSamples.map((sample) => ({
    ...sample,
    featureVector: normalizeFeatureVector(sample.rawFeatureVector, normalization),
  }));

  const trainCount = samples.filter((sample) => sample.split === 'train').length;
  const validationCount = samples.filter((sample) => sample.split === 'validation').length;
  const testCount = samples.filter((sample) => sample.split === 'test').length;
  const maxTrainIndex = samples.filter((sample) => sample.split === 'train').reduce((max, sample) => Math.max(max, sample.sampleIndex), -1);
  const minValidationIndex = samples.filter((sample) => sample.split === 'validation').reduce((min, sample) => Math.min(min, sample.sampleIndex), Number.POSITIVE_INFINITY);
  const maxValidationIndex = samples.filter((sample) => sample.split === 'validation').reduce((max, sample) => Math.max(max, sample.sampleIndex), -1);
  const minTestIndex = samples.filter((sample) => sample.split === 'test').reduce((min, sample) => Math.min(min, sample.sampleIndex), Number.POSITIVE_INFINITY);
  const temporalSplitValidated = trainCount === 0 || validationCount === 0 || testCount === 0
    ? false
    : maxTrainIndex + splitGapTicks < minValidationIndex && maxValidationIndex + splitGapTicks < minTestIndex;
  const leakageCheckPassed = samples.every((sample) => sample.outcomeEpoch > sample.anchorEpoch && sample.sourceWindowToEpoch === sample.anchorEpoch);

  const qualityReportBase = {
    totalTicks: loadedTicks.length,
    validTicks: validTicks.length,
    invalidTicks,
    duplicateTicks,
    candidateSamples: totalCandidates,
    generatedSamples: samples.length,
    excludedMissingWindows,
    excludedAmbiguousTargets,
    excludedSplitGap,
    featureCount: normalization.featureCount,
    trainCount,
    validationCount,
    testCount,
    splitGapTicks,
    leakageCheckPassed,
    temporalSplitValidated,
    normalizationVersion: normalization.version,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    labelSchemaVersion: LABEL_SCHEMA_VERSION,
  };

  const qualityReport: DatasetQualityReport = {
    ...qualityReportBase,
    status: qualityStatus(qualityReportBase),
  };

  const sourceFrom = validTicks[0].tick_time;
  const sourceTo = validTicks[validTicks.length - 1].tick_time;
  const datasetFingerprint = computeDatasetFingerprint({
    symbol,
    horizonTicks,
    windowTicks,
    sourceFrom,
    sourceTo,
    qualityReport,
    normalization,
    featureKeys,
  });
  const version = `v${compactIsoStamp(now)}-${datasetFingerprint.slice(0, 12)}`;

  const checksum = computeChecksum(samples, {
    symbol,
    horizonTicks,
    windowTicks,
    normalizationVersion: normalization.version,
    featureKeys,
    qualityReport,
    datasetFingerprint,
  });

  const datasetId = crypto.randomUUID();
  const datasetName = String(request.datasetName ?? `Deriv ${symbol} ${horizonTicks}-tick direction dataset`).trim().slice(0, 160);
  const metadata = {
    source: 'deriv',
    assetCategory,
    featureKeys,
    featureCount: normalization.featureCount,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    labelSchemaVersion: LABEL_SCHEMA_VERSION,
    normalization,
    qualityReport,
    splitStrategy: 'chronological-embargo-70-15-15',
    splitGapTicks,
    deadZonePolicy: {
      type: 'dynamic-median-abs-delta',
      multiplier: 0.25,
    },
    datasetFingerprint,
    generatedAt: startedAt,
  };

  await sql`
    INSERT INTO training_datasets (
      id, name, version, asset_symbol, horizon_ticks, feature_schema_version,
      label_schema_version, source_from, source_to, sample_count, train_count,
      validation_count, test_count, status, checksum, leakage_check_passed, metadata
    ) VALUES (
      ${datasetId}, ${datasetName}, ${version}, ${symbol}, ${horizonTicks}, ${FEATURE_SCHEMA_VERSION},
      ${LABEL_SCHEMA_VERSION}, ${sourceFrom}, ${sourceTo}, ${samples.length}, ${trainCount},
      ${validationCount}, ${testCount}, ${qualityReport.status === 'READY' ? 'completed' : 'review'}, ${checksum}, ${qualityReport.leakageCheckPassed},
      ${JSON.stringify(metadata)}::jsonb
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
    name: datasetName,
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
    leakageCheckPassed: qualityReport.leakageCheckPassed,
    normalizationVersion: normalization.version,
    datasetFingerprint,
    qualityReport,
    status: 'completed',
  };
}

export async function listTrainingDatasets(symbol?: string) {
  const sql = getSql();
  if (!sql || !(await initDbSchema())) return [];
  await ensureDatasetSchema(sql);
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
