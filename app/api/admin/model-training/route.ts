import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifySessionToken } from '../auth/route';
import { getDbConnectionString, initDbSchema } from '@/lib/db';
import { ensureTrainingDurationSchema } from '@/lib/training-duration-schema';
import { getMlModelDefinitions } from '@/lib/ml-model-registry';
import { registerDurationModel } from '@/lib/duration-model-registry';
import { xgboostDaemon } from '@/lib/xgboost-daemon';

function auth(req: NextRequest) {
  const cookie = req.cookies.get('admin_session_token')?.value;
  const header = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookie) || verifySessionToken(header);
}
function noStore() { return { 'Cache-Control': 'no-store, max-age=0' }; }
function token(value: unknown): string { return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) ? value : ''; }

function sequencePartitions(rows: any[], sequenceLength: number, schema: { featureCount: number; featureSchemaVersion: string; schemaFingerprint: string }) {
  const result: Record<string, { featureSequences: number[][][]; labels: number[]; featureCount: number; sequenceLength: number; schemaVersion: string; schemaFingerprint: string }> = {};
  for (const split of ['train', 'validation', 'test']) {
    const ordered = rows.filter((row) => row.split === split).sort((a, b) => Number(a.sample_index) - Number(b.sample_index));
    const featureSequences: number[][][] = []; const labels: number[] = [];
    for (let i = sequenceLength - 1; i < ordered.length; i += 1) {
      const window = ordered.slice(i - sequenceLength + 1, i + 1);
      const vectors = window.map((row) => Array.isArray(row.feature_vector) ? row.feature_vector.map(Number) : null);
      if (vectors.some((vector) => !vector || vector.length !== schema.featureCount || vector.some((value) => !Number.isFinite(value)))) continue;
      featureSequences.push(vectors as number[][]); labels.push(String(ordered[i].label).toUpperCase() === 'RISE' ? 1 : 0);
    }
    result[split] = { featureSequences, labels, featureCount: schema.featureCount, sequenceLength, schemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint };
  }
  return result;
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  const url = getDbConnectionString();
  if (!url || !(await initDbSchema())) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503, headers: noStore() });
  const sql = neon(url); await ensureTrainingDurationSchema(sql);
  const symbol = req.nextUrl.searchParams.get('symbol')?.trim().toUpperCase();
  const rows = symbol
    ? await sql`SELECT id,name,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_type,horizon_ticks,status,leakage_check_passed,sample_count,train_count,validation_count,test_count,feature_schema_version,metadata,created_at FROM training_datasets WHERE asset_symbol = ${symbol} ORDER BY created_at DESC LIMIT 100`
    : await sql`SELECT id,name,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_type,horizon_ticks,status,leakage_check_passed,sample_count,train_count,validation_count,test_count,feature_schema_version,metadata,created_at FROM training_datasets ORDER BY created_at DESC LIMIT 100`;
  return NextResponse.json({ success: true, datasets: rows }, { headers: noStore() });
}

export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401, headers: noStore() });
  try {
    const body = await req.json().catch(() => ({}));
    const datasetId = token(body?.datasetId);
    if (!datasetId) return NextResponse.json({ error: 'datasetId is required.' }, { status: 400, headers: noStore() });
    const url = getDbConnectionString();
    if (!url || !(await initDbSchema())) return NextResponse.json({ error: 'Database unavailable.' }, { status: 503, headers: noStore() });
    const sql = neon(url); await ensureTrainingDurationSchema(sql);
    const datasetRows = await sql`SELECT id,name,asset_symbol,duration_value,duration_unit,duration_seconds,horizon_type,horizon_ticks,feature_schema_version,sample_count,train_count,validation_count,test_count,status,leakage_check_passed,metadata FROM training_datasets WHERE id = ${datasetId} LIMIT 1`;
    const dataset = datasetRows[0] as any;
    if (!dataset) return NextResponse.json({ error: 'Training dataset not found.' }, { status: 404, headers: noStore() });
    if (dataset.status !== 'completed' || dataset.leakage_check_passed !== true) return NextResponse.json({ error: 'Only completed datasets with a passed leakage check can be trained.' }, { status: 422, headers: noStore() });

    const durationValue = Number(dataset.duration_value); const durationUnit = dataset.duration_unit as 't'|'s'|'m'|'h'|'d';
    const durationSeconds = dataset.duration_seconds == null ? null : Number(dataset.duration_seconds); const effectiveHorizonTicks = Number(dataset.horizon_ticks);
    if (!Number.isSafeInteger(durationValue) || durationValue <= 0 || !['t','s','m','h','d'].includes(durationUnit) || !Number.isSafeInteger(effectiveHorizonTicks) || effectiveHorizonTicks <= 0) return NextResponse.json({ error: 'Dataset duration metadata is invalid.' }, { status: 422, headers: noStore() });

    const samples = await sql`SELECT sample_index,split,label,feature_vector FROM training_dataset_samples WHERE dataset_id = ${datasetId} ORDER BY sample_index ASC`;
    if (!samples.length) return NextResponse.json({ error: 'Dataset contains no persisted samples.' }, { status: 422, headers: noStore() });
    const schema = await import('@/lib/ml-runtime-schema').then((m) => m.getMlRuntimeSchemaContract());
    const featureCount = Number(schema.featureCount); const sequenceLength = Number(schema.sequenceLength);
    const partitions: Record<string, any> = {};
    for (const split of ['train','validation','test']) {
      const splitRows = samples.filter((row: any) => row.split === split);
      const vectors = splitRows.map((row: any) => Array.isArray(row.feature_vector) ? row.feature_vector.map(Number) : null);
      if (vectors.some((vector: number[] | null) => !vector || vector.length !== featureCount || vector.some((value) => !Number.isFinite(value)))) return NextResponse.json({ error: `Invalid persisted feature vector in ${split} partition.` }, { status: 422, headers: noStore() });
      partitions[split] = { featureVectors: vectors, labels: splitRows.map((row: any) => String(row.label).toUpperCase() === 'RISE' ? 1 : 0), sampleCount: splitRows.length, featureCount, schemaVersion: schema.featureSchemaVersion, schemaFingerprint: schema.schemaFingerprint };
    }
    if (partitions.train.sampleCount < 2 || new Set(partitions.train.labels).size < 2 || partitions.validation.sampleCount < 2 || new Set(partitions.validation.labels).size < 2) return NextResponse.json({ error: 'Insufficient two-class train/validation samples.' }, { status: 422, headers: noStore() });

    const sequence = sequencePartitions(samples, sequenceLength, schema);
    if (sequence.train.featureSequences.length < 2 || new Set(sequence.train.labels).size < 2 || sequence.validation.featureSequences.length < 2 || new Set(sequence.validation.labels).size < 2) return NextResponse.json({ error: 'Insufficient two-class sequence samples for deep models.' }, { status: 422, headers: noStore() });

    const requested = Array.isArray(body?.modelTypes) ? body.modelTypes.filter((v: unknown) => typeof v === 'string') : [];
    const definitions = getMlModelDefinitions().filter((definition) => requested.length === 0 || requested.includes(definition.key));
    if (!definitions.length) return NextResponse.json({ error: 'No registered model types were requested.' }, { status: 400, headers: noStore() });
    const runId = crypto.randomUUID(); const assetRows = await sql`SELECT asset_class FROM market_assets WHERE symbol = ${String(dataset.asset_symbol)} LIMIT 1`; const assetClass = String(assetRows[0]?.asset_class || 'unknown');
    const results: any[] = [];

    for (const definition of definitions) {
      const sequenceModel = definition.family === 'sequential';
      const result = await xgboostDaemon.sendCommand('train_partitioned', {
        symbol: String(dataset.asset_symbol), modelType: definition.key, durationValue, durationUnit, durationSeconds, effectiveHorizonTicks,
        trainTabularDataset: sequenceModel ? undefined : partitions.train, validationTabularDataset: sequenceModel ? undefined : partitions.validation,
        trainSequenceDataset: sequenceModel ? sequence.train : undefined, validationSequenceDataset: sequenceModel ? sequence.validation : undefined,
        datasetId, hyperparams: definition.defaultHyperparameters,
      });
      if (!result?.success) { results.push({ modelType: definition.key, success: false, error: result?.error || 'Native training failed' }); continue; }
      const modelId = String(result.modelId);
      await registerDurationModel({
        modelId, modelFamily: definition.family, version: `${String(schema.featureSchemaVersion)}-${Date.now()}`,
        symbol: String(dataset.asset_symbol), assetClass, durationValue, durationUnit, durationSeconds, effectiveHorizonTicks, datasetId,
        format: sequenceModel ? 'PT_STATE' : 'PKL', status: 'candidate', featureSchemaVersion: String(schema.featureSchemaVersion), framework: sequenceModel ? 'pytorch' : definition.key,
        trainingRunId: runId, metrics: { ...(result.metrics || {}), engine: result.engine, samplesCount: result.samplesCount, validationSamples: result.validationSamples }, hyperparameters: definition.defaultHyperparameters,
      });
      results.push({ modelType: definition.key, success: true, modelId, metrics: result.metrics, engine: result.engine });
    }
    return NextResponse.json({ success: results.some((r) => r.success), trainingRunId: runId, dataset: { id: datasetId, symbol: dataset.asset_symbol, durationValue, durationUnit, durationSeconds, effectiveHorizonTicks }, modelTypes: definitions.map((d) => d.key), results }, { status: 201, headers: noStore() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Duration model training failed.' }, { status: 500, headers: noStore() });
  }
}
