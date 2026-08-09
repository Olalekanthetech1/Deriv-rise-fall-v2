import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { extract37TickFeatures, featureObjToArray, type TickPoint } from './ml-feature-extractor';
import { initDbSchema, getDbConnectionString } from './db';

const FEATURE_SCHEMA_VERSION = 'tick-features-v37';
const LABEL_SCHEMA_VERSION = 'direction-v1';
const DEFAULT_WINDOW_TICKS = 300;
const DEFAULT_HORIZON_TICKS = 5;
const INSERT_BATCH_SIZE = 250;

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

type RawTick = {
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
  label: 'RISE' | 'FALL';
  featureVector: number[];
  sourceWindowFromEpoch: number;
  sourceWindowToEpoch: number;
};

function getSql() {
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

function computeMedianTickMove(windowTicks: SanitizedTick[]): number {
  const moves: number[] = [];
  for (let i = 1; i < windowTicks.length; i += 1) {
    const move = Math.abs(windowTicks[i].price - windowTicks[i - 1].price);