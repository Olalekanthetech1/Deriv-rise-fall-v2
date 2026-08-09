import { getMlRuntimeSchemaContract } from './ml-runtime-schema';
import { extractTickFeatures, featureObjToArray, type TickPoint } from './ml-feature-extractor';

export type DurationUnit = 't' | 's' | 'm' | 'h' | 'd';
export type DurationSpec = { value: number; unit: DurationUnit; seconds: number | null };
export type DurationFeatureContext = { symbol: string; duration: DurationSpec; assetCategory: number };
export interface DurationTabularFeatureDataset { featureVectors: number[][]; labels: number[]; sampleCount: number; featureCount: number; schemaVersion: string; schemaFingerprint: string; }
export interface DurationSequenceFeatureDataset { featureSequences: number[][][]; labels: number[]; sampleCount: number; featureCount: number; sequenceLength: number; schemaVersion: string; schemaFingerprint: string; }

function priceOf(tick: TickPoint): number { const price = Number(tick.price); if (!Number.isFinite(price)) throw new Error('INVALID_TICK_PRICE'); return price; }
function futureIndex(ticks: TickPoint[], anchorIndex: number, duration: DurationSpec): number {
  if (duration.unit === 't') return anchorIndex + duration.value;
  const targetEpoch = Number(ticks[anchorIndex].timestamp ?? 0) / 1000 + Number(duration.seconds);
  let lo = anchorIndex + 1; let hi = ticks.length - 1; let answer = -1;
  while (lo <= hi) { const mid = Math.floor((lo + hi) / 2); const epoch = Number(ticks[mid].timestamp ?? 0) / 1000; if (epoch >= targetEpoch) { answer = mid; hi = mid - 1; } else lo = mid + 1; }
  return answer;
}
function vectorForTicks(ticks: TickPoint[], context: DurationFeatureContext): number[] {
  return featureObjToArray(extractTickFeatures(ticks, { symbol: context.symbol, contractDurationSecs: context.duration.seconds ?? 0, assetCategoryNum: context.assetCategory }));
}
function validateContext(context: DurationFeatureContext): void {
  if (!Number.isSafeInteger(context.duration.value) || context.duration.value <= 0) throw new Error('INVALID_DURATION_VALUE');
  if (!['t','s','m','h','d'].includes(context.duration.unit)) throw new Error('INVALID_DURATION_UNIT');
  if (context.duration.unit !== 't' && (!Number.isFinite(context.duration.seconds) || Number(context.duration.seconds) <= 0)) throw new Error('INVALID_DURATION_SECONDS');
}
export async function buildDurationTabularFeatureDataset(ticks: TickPoint[], context: DurationFeatureContext): Promise<DurationTabularFeatureDataset> {
  validateContext(context); const schema = await getMlRuntimeSchemaContract(); const canonicalWindow = schema.canonicalFeatureWindowTicks;
  if (ticks.length <= canonicalWindow + 1) throw new Error('INSUFFICIENT_TICKS'); const prices = ticks.map(priceOf); const featureVectors: number[][] = []; const labels: number[] = [];
  for (let i = canonicalWindow; i < prices.length - 1; i += 1) { const outcomeIndex = futureIndex(ticks, i, context.duration); if (outcomeIndex < 0 || outcomeIndex >= ticks.length) continue; featureVectors.push(vectorForTicks(ticks.slice(0, i + 1), context)); labels.push(prices[outcomeIndex] > prices[i] ? 1 : 0); }
  if (!featureVectors.length || new Set(labels).size < 2) throw new Error('TRAINING_LABELS_SINGLE_CLASS_OR_INSUFFICIENT_SAMPLES');
  return { featureVectors, labels, sampleCount: featureVectors.length, featureCount: schema.featureCount, schemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint };
}
export async function buildDurationSequenceFeatureDataset(ticks: TickPoint[], context: DurationFeatureContext): Promise<DurationSequenceFeatureDataset> {
  validateContext(context); const schema = await getMlRuntimeSchemaContract(); const sequenceLength = schema.sequenceLength;
  if (ticks.length <= sequenceLength + 1) throw new Error('INSUFFICIENT_SEQUENCE_TICKS'); const prices = ticks.map(priceOf); const featureSequences: number[][][] = []; const labels: number[] = [];
  for (let i = sequenceLength; i < prices.length - 1; i += 1) { const outcomeIndex = futureIndex(ticks, i, context.duration); if (outcomeIndex < 0 || outcomeIndex >= ticks.length) continue; const sequence: number[][] = []; for (let j = i - sequenceLength + 1; j <= i; j += 1) sequence.push(vectorForTicks(ticks.slice(0, j + 1), context)); featureSequences.push(sequence); labels.push(prices[outcomeIndex] > prices[i] ? 1 : 0); }
  if (!featureSequences.length || new Set(labels).size < 2) throw new Error('TRAINING_LABELS_SINGLE_CLASS_OR_INSUFFICIENT_SAMPLES');
  return { featureSequences, labels, sampleCount: featureSequences.length, featureCount: schema.featureCount, sequenceLength, schemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint };
}
