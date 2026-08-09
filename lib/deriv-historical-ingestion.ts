import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { getDbConnectionString, initDbSchema } from '@/lib/db';
import { fetchDerivTickHistory, type TickPoint } from '@/lib/ticks-helper';

export type HistoricalTick = TickPoint & {
  epochMs: number;
  sourceTickId: string;
};

export type HistoricalIngestionRun = {
  runId: string;
  symbol: string;
  requestedCount: number;
  requestedFrom: string | null;
  requestedTo: string | null;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'partial' | 'failed';
  recordsReceived: number;
  recordsInserted: number;
  recordsRejected: number;
  firstTickTime: string | null;
  lastTickTime: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
};

export type HistoricalCheckpoint = {
  source: string;
  symbol: string;
  lastTickEpoch: number | null;
  lastTickTime: string | null;
  updatedAt: string;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isValidSymbol(symbol: string): boolean {
  return /^[A-Z0-9_./:-]{2,64}$/.test(symbol);
}

function makeSourceTickId(symbol: string, epochMs: number, price: number, index: number): string {
  return crypto.createHash('sha1').update(`${symbol}:${epochMs}:${price}:${index}`).digest('hex');
}

function normalizeTicks(symbol: string, ticks: TickPoint[]): HistoricalTick[] {
  const cleaned = ticks
    .map((tick, index) => {
      const epochMs = Number(tick.timestamp);
      const price = Number(tick.price);
      if (!Number.isFinite(epochMs) || epochMs <= 0 || !Number.isFinite(price) || price <= 0) return null;
      return {
        price,
        timestamp: epochMs,
        epochMs,
        sourceTickId: makeSourceTickId(symbol, epochMs, price, index),
      } satisfies HistoricalTick;
    })
    .filter((tick): tick is HistoricalTick => tick !== null)
    .sort((a, b) => a.epochMs - b.epochMs);

  const deduped = new Map<string, HistoricalTick>();
  for (const tick of cleaned) deduped.set(tick.sourceTickId, tick);
  return [...deduped.values()].sort((a, b) => a.epochMs - b.epochMs);
}

async function getAssetId<TSql extends ReturnType<typeof neon>>(sql: TSql, symbol: string): Promise<number> {
  const rows = (await sql`
    INSERT INTO market_assets (symbol, display_name, asset_class, market_type, source, is_active)
    VALUES (${symbol}, ${symbol}, 'unknown', 'unknown', 'deriv', TRUE)
    ON CONFLICT (symbol) DO UPDATE SET updated_at = NOW()
    RETURNING id
  `) as unknown as Array<{ id?: number | string | null }>;

  const id = Number(rows[0]?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Unable to resolve market asset id for ${symbol}.`);
  }
  return id;
}

async function createRunRecord<TSql extends ReturnType<typeof neon>>(sql: TSql, run: HistoricalIngestionRun): Promise<void> {
  await sql`
    INSERT INTO data_ingestion_runs (
      id, source, asset_symbol, requested_from, requested_to, started_at, completed_at, status,
      records_received, records_inserted, records_rejected, first_tick_time, last_tick_time, error_message, metadata
    ) VALUES (
      ${run.runId}, 'deriv', ${run.symbol}, ${run.requestedFrom}, ${run.requestedTo}, ${run.startedAt}, ${run.completedAt}, ${run.status},
      ${run.recordsReceived}, ${run.recordsInserted}, ${run.recordsRejected}, ${run.firstTickTime}, ${run.lastTickTime}, ${run.errorMessage},
      ${JSON.stringify(run.metadata)}::jsonb
    )
  `;
}

async function updateRunRecord<TSql extends ReturnType<typeof neon>>(sql: TSql, run: HistoricalIngestionRun): Promise<void> {
  await sql`
    UPDATE data_ingestion_runs
    SET completed_at = ${run.completedAt},
        status = ${run.status},
        records_received = ${run.recordsReceived},
        records_inserted = ${run.recordsInserted},
        records_rejected = ${run.recordsRejected},
        first_tick_time = ${run.firstTickTime},
        last_tick_time = ${run.lastTickTime},
        error_message = ${run.errorMessage},
        metadata = ${JSON.stringify(run.metadata)}::jsonb
    WHERE id = ${run.runId}
  `;
}

async function upsertCheckpoint<TSql extends ReturnType<typeof neon>>(sql: TSql, symbol: string, lastTickEpoch: number, lastTickTime: string): Promise<void> {
  await sql`
    INSERT INTO data_ingestion_checkpoints (source, asset_symbol, last_tick_epoch, last_tick_time, updated_at)
    VALUES ('deriv', ${symbol}, ${lastTickEpoch}, ${lastTickTime}, NOW())
    ON CONFLICT (source, asset_symbol) DO UPDATE SET
      last_tick_epoch = EXCLUDED.last_tick_epoch,
      last_tick_time = EXCLUDED.last_tick_time,
      updated_at = NOW()
  `;
}

async function insertTickBatch<TSql extends ReturnType<typeof neon>>(
  sql: TSql,
  symbol: string,
  assetId: number,
  runId: string,
  ticks: HistoricalTick[],
): Promise<number> {
  if (!ticks.length) return 0;

  const symbols = ticks.map(() => symbol);
  const assetIds = ticks.map(() => assetId);
  const prices = ticks.map((tick) => tick.price);
  const epochs = ticks.map((tick) => Math.floor(tick.epochMs / 1000));
  const times = ticks.map((tick) => new Date(tick.epochMs).toISOString());
  const sourceIds = ticks.map((tick) => tick.sourceTickId);
  const runIds = ticks.map(() => runId);

  const insertedRows = await sql`
    INSERT INTO market_ticks (
      asset_id, symbol, price, tick_epoch, tick_time, source, source_tick_id, ingest_run_id
    )
    SELECT * FROM UNNEST(
      ${assetIds}::bigint[],
      ${symbols}::text[],
      ${prices}::numeric[],
      ${epochs}::bigint[],
      ${times}::timestamptz[],
      ARRAY_FILL('deriv'::text, ARRAY[${ticks.length}]),
      ${sourceIds}::text[],
      ${runIds}::uuid[]
    )
    ON CONFLICT (source, source_tick_id) DO NOTHING
    RETURNING id
  `;

  return Array.isArray(insertedRows) ? insertedRows.length : 0;
}

export async function ingestDerivHistoricalTicks(input: {
  symbol: string;
  count: number;
  resumeFromCheckpoint?: boolean;
  endEpoch?: number | 'latest';
}) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) throw new Error('DATABASE_URL is required for ingestion.');

  const normalizedSymbol = normalizeSymbol(input.symbol);
  if (!isValidSymbol(normalizedSymbol)) {
    throw new Error(`Invalid Deriv symbol: ${input.symbol}`);
  }

  const requestedCount = Math.min(50_000, Math.max(50, Math.floor(input.count)));
  await initDbSchema();
  const sql = neon(dbUrl);
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const metadata: Record<string, unknown> = {
    requestedCount,
    resumeFromCheckpoint: Boolean(input.resumeFromCheckpoint),
  };

  let run: HistoricalIngestionRun = {
    runId,
    symbol: normalizedSymbol,
    requestedCount,
    requestedFrom: null,
    requestedTo: null,
    startedAt,
    completedAt: null,
    status: 'running',
    recordsReceived: 0,
    recordsInserted: 0,
    recordsRejected: 0,
    firstTickTime: null,
    lastTickTime: null,
    errorMessage: null,
    metadata,
  };

  await createRunRecord(sql, run);

  try {
    let cursor: number | 'latest' = typeof input.endEpoch === 'number' && Number.isFinite(input.endEpoch) ? input.endEpoch : 'latest';
    if (input.resumeFromCheckpoint) {
      const checkpointRows = (await sql`
        SELECT last_tick_epoch
        FROM data_ingestion_checkpoints
        WHERE source = 'deriv' AND asset_symbol = ${normalizedSymbol}
        LIMIT 1
      `) as unknown as Array<{ last_tick_epoch?: number | string | null }>;
      const checkpointEpoch = Number(checkpointRows[0]?.last_tick_epoch);
      if (Number.isFinite(checkpointEpoch) && checkpointEpoch > 0) {
        cursor = Math.max(1, Math.floor(checkpointEpoch) - 1);
        run.metadata = { ...run.metadata, resumedFromCheckpointEpoch: checkpointEpoch };
      }
    }

    let remaining = requestedCount;
    let chunks = 0;
    let earliestEpoch = Number.POSITIVE_INFINITY;
    let latestEpoch = 0;

    while (remaining > 0) {
      const batchSize = Math.min(5000, remaining);
      const rawTicks = await fetchDerivTickHistory(normalizedSymbol, batchSize, cursor);
      if (!rawTicks.length) break;

      chunks += 1;
      run.recordsReceived += rawTicks.length;

      const cleanedTicks = normalizeTicks(normalizedSymbol, rawTicks);
      run.recordsRejected += rawTicks.length - cleanedTicks.length;

      if (!cleanedTicks.length) break;

      const inserted = await insertTickBatch(sql, normalizedSymbol, await getAssetId(sql, normalizedSymbol), runId, cleanedTicks);
      run.recordsInserted += inserted;

      const oldest = cleanedTicks[0];
      const newest = cleanedTicks[cleanedTicks.length - 1];
      earliestEpoch = Math.min(earliestEpoch, oldest.epochMs);
      latestEpoch = Math.max(latestEpoch, newest.epochMs);

      await upsertCheckpoint(
        sql,
        normalizedSymbol,
        Math.floor(oldest.epochMs / 1000),
        new Date(oldest.epochMs).toISOString(),
      );

      cursor = Math.max(1, Math.floor(oldest.epochMs / 1000) - 1);
      remaining = requestedCount - run.recordsReceived;
      if (rawTicks.length < batchSize) break;
      if (typeof cursor !== 'number' || cursor <= 0) break;
    }

    const hasData = run.recordsInserted > 0;
    run = {
      ...run,
      completedAt: new Date().toISOString(),
      status: hasData ? (run.recordsReceived >= requestedCount ? 'completed' : 'partial') : 'failed',
      firstTickTime: Number.isFinite(earliestEpoch) ? new Date(earliestEpoch).toISOString() : null,
      lastTickTime: latestEpoch > 0 ? new Date(latestEpoch).toISOString() : null,
      metadata: { ...run.metadata, chunks },
    };

    await updateRunRecord(sql, run);

    return {
      success: true,
      ...run,
      dataSource: 'deriv-historical',
      liveDatabase: true,
    };
  } catch (error: any) {
    run = {
      ...run,
      completedAt: new Date().toISOString(),
      status: 'failed',
      errorMessage: error?.message || 'Historical ingestion failed.',
    };
    await updateRunRecord(sql, run).catch(() => {});
    throw error;
  }
}

export async function listHistoricalIngestionRuns(limit = 10): Promise<HistoricalIngestionRun[]> {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return [];
  await initDbSchema();
  const sql = neon(dbUrl);
  const rows = await sql`
    SELECT
      id AS "runId",
      asset_symbol AS "symbol",
      COALESCE((metadata->>'requestedCount')::int, 0) AS "requestedCount",
      requested_from AS "requestedFrom",
      requested_to AS "requestedTo",
      started_at AS "startedAt",
      completed_at AS "completedAt",
      status,
      records_received AS "recordsReceived",
      records_inserted AS "recordsInserted",
      records_rejected AS "recordsRejected",
      first_tick_time AS "firstTickTime",
      last_tick_time AS "lastTickTime",
      error_message AS "errorMessage",
      COALESCE(metadata, '{}'::jsonb) AS metadata
    FROM data_ingestion_runs
    WHERE source = 'deriv'
    ORDER BY started_at DESC
    LIMIT ${Math.max(1, Math.min(50, limit))}
  `;

  return rows.map((row: any) => ({
    runId: String(row.runId),
    symbol: String(row.symbol),
    requestedCount: Number(row.requestedCount || 0),
    requestedFrom: row.requestedFrom ? new Date(row.requestedFrom).toISOString() : null,
    requestedTo: row.requestedTo ? new Date(row.requestedTo).toISOString() : null,
    startedAt: new Date(row.startedAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    status: row.status,
    recordsReceived: Number(row.recordsReceived || 0),
    recordsInserted: Number(row.recordsInserted || 0),
    recordsRejected: Number(row.recordsRejected || 0),
    firstTickTime: row.firstTickTime ? new Date(row.firstTickTime).toISOString() : null,
    lastTickTime: row.lastTickTime ? new Date(row.lastTickTime).toISOString() : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  }));
}

export async function getHistoricalIngestionCheckpoint(symbol?: string): Promise<HistoricalCheckpoint | null> {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return null;
  await initDbSchema();
  const sql = neon(dbUrl);

  const rows = symbol
    ? await sql`
        SELECT source, asset_symbol, last_tick_epoch, last_tick_time, updated_at
        FROM data_ingestion_checkpoints
        WHERE source = 'deriv' AND asset_symbol = ${normalizeSymbol(symbol)}
        LIMIT 1
      `
    : await sql`
        SELECT source, asset_symbol, last_tick_epoch, last_tick_time, updated_at
        FROM data_ingestion_checkpoints
        WHERE source = 'deriv'
        ORDER BY updated_at DESC
        LIMIT 1
      `;

  if (!rows.length) return null;
  const row: any = rows[0];
  return {
    source: String(row.source),
    symbol: String(row.asset_symbol),
    lastTickEpoch: row.last_tick_epoch != null ? Number(row.last_tick_epoch) : null,
    lastTickTime: row.last_tick_time ? new Date(row.last_tick_time).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
