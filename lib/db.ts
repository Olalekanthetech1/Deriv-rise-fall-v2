import { neon } from '@neondatabase/serverless';

/**
 * Centralized helper to safely retrieve the database connection string.
 * Returns null and logs a warning if DATABASE_URL is not set.
 */
export function getDbConnectionString(): string | null {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn('[DB] DATABASE_URL environment variable is missing or empty.');
    return null;
  }
  return dbUrl;
}

export function getDb() {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) {
    return null;
  }
  return neon(dbUrl);
}

export function getDbOrThrow() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('[DB Configuration Error] DATABASE_URL environment variable is strictly required for this operation.');
  }
  return neon(dbUrl);
}

let isSchemaInitialized = false;

/**
 * Idempotent Auto-Schema setup for Neon PostgreSQL Database.
 * Runs IF NOT EXISTS statements on DB endpoints lazily with zero-ops overhead.
 */
export async function initDbSchema(): Promise<boolean> {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) {
    return false;
  }

  if (isSchemaInitialized) {
    return true;
  }

  try {
    const sql = neon(dbUrl);

    // 1. Ticks table
    await sql`
      CREATE TABLE IF NOT EXISTS ticks (
        id BIGSERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        price NUMERIC(18, 6) NOT NULL,
        tick_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_ticks_symbol_timestamp 
      ON ticks (symbol, tick_timestamp DESC);
    `;

    // 2. ML Models Table
    await sql`
      CREATE TABLE IF NOT EXISTS ml_models (
        id SERIAL PRIMARY KEY,
        model_name VARCHAR(100) NOT NULL,
        version VARCHAR(50) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        asset_class VARCHAR(50) DEFAULT 'synthetic',
        accuracy NUMERIC(5,2),
        feature_count INT DEFAULT 37,
        hyperparameters JSONB,
        weights_data JSONB,
        is_active BOOLEAN DEFAULT TRUE,
        trained_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 3. ML Training Logs
    await sql`
      CREATE TABLE IF NOT EXISTS ml_training_logs (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        samples_count INT NOT NULL,
        train_accuracy NUMERIC(5,2),
        val_accuracy NUMERIC(5,2),
        log_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 4. Trades Execution Log Table
    await sql`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        contract_type VARCHAR(20) NOT NULL,
        stake NUMERIC(12, 2) NOT NULL,
        payout NUMERIC(12, 2),
        buy_price NUMERIC(18, 6),
        sell_price NUMERIC(18, 6),
        status VARCHAR(20) NOT NULL,
        prediction_confidence NUMERIC(5, 2),
        strategy VARCHAR(50),
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 5. ML Model Registry Table (ONNX / XGBoost Production Deployment Registry)
    await sql`
      CREATE TABLE IF NOT EXISTS ml_model_registry (
        id SERIAL PRIMARY KEY,
        model_id VARCHAR(100) UNIQUE NOT NULL,
        model_name VARCHAR(150) NOT NULL,
        version VARCHAR(50) NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        horizon_secs INT DEFAULT 5,
        format VARCHAR(20) DEFAULT 'ONNX',
        status VARCHAR(20) DEFAULT 'staging',
        accuracy NUMERIC(5,2) DEFAULT 0.0,
        backtest_win_rate NUMERIC(5,2) DEFAULT 0.0,
        backtest_profit_factor NUMERIC(5,2) DEFAULT 1.0,
        feature_count INT DEFAULT 37,
        file_path TEXT,
        hyperparameters JSONB,
        metrics JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 6. ML Backtest Results
    await sql`
      CREATE TABLE IF NOT EXISTS ml_backtest_results (
        id SERIAL PRIMARY KEY,
        model_id VARCHAR(100) REFERENCES ml_model_registry(model_id) ON DELETE CASCADE,
        symbol VARCHAR(50) NOT NULL,
        duration_sec INT NOT NULL,
        total_trades INT NOT NULL,
        winning_trades INT NOT NULL,
        profit_factor NUMERIC(6, 2),
        max_drawdown NUMERIC(5, 2),
        sharpe_ratio NUMERIC(5, 2),
        tested_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 7. ML Performance Audit (Live Drift Tracker)
    await sql`
      CREATE TABLE IF NOT EXISTS ml_performance_audit (
        id BIGSERIAL PRIMARY KEY,
        symbol VARCHAR(50) NOT NULL,
        model_id VARCHAR(100),
        predicted_signal VARCHAR(10) NOT NULL,
        confidence NUMERIC(5, 2) NOT NULL,
        entry_price NUMERIC(18, 6) NOT NULL,
        exit_price NUMERIC(18, 6),
        outcome VARCHAR(10),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Schema column migrations/guards
    await sql`
      ALTER TABLE ml_models 
      ADD COLUMN IF NOT EXISTS asset_class VARCHAR(50) DEFAULT 'synthetic';
    `;

    await sql`
      ALTER TABLE trades 
      ADD COLUMN IF NOT EXISTS prediction_confidence NUMERIC(5, 2);
    `;

    isSchemaInitialized = true;
    return true;
  } catch (err) {
    console.error('[DB Schema Init Error]:', err);
    return false;
  }
}

export async function saveTicksBatch(symbol: string, ticks: Array<{ price: number; timestamp?: number }>) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl || !ticks.length) return false;

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    const CHUNK_SIZE = 200;
    for (let i = 0; i < ticks.length; i += CHUNK_SIZE) {
      const chunk = ticks.slice(i, i + CHUNK_SIZE);
      const symbols: string[] = [];
      const prices: number[] = [];
      const timestamps: string[] = [];

      for (const tick of chunk) {
        symbols.push(symbol);
        prices.push(tick.price);
        timestamps.push((tick.timestamp ? new Date(tick.timestamp) : new Date()).toISOString());
      }

      await sql`
        INSERT INTO ticks (symbol, price, tick_timestamp)
        SELECT * FROM UNNEST(
          ${symbols}::text[],
          ${prices}::numeric[],
          ${timestamps}::timestamptz[]
        )
      `;
    }
    return true;
  } catch (err) {
    console.error('[saveTicksBatch Error]:', err);
    return false;
  }
}

export async function getTicksHistory(symbol: string, limit: number = 300) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return [];

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    const rows = await sql`
      SELECT price, tick_timestamp 
      FROM ticks 
      WHERE symbol = ${symbol}
      ORDER BY tick_timestamp DESC 
      LIMIT ${limit}
    `;
    return rows.reverse().map((r: any) => ({
      price: parseFloat(r.price),
      timestamp: new Date(r.tick_timestamp).getTime(),
    }));
  } catch (err) {
    console.error('[getTicksHistory Error]:', err);
    return [];
  }
}

export async function getRegisteredModels(symbol?: string, status?: string) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return [];

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    let rows;
    if (symbol && status) {
      rows = await sql`
        SELECT * FROM ml_model_registry
        WHERE symbol = ${symbol} AND status = ${status}
        ORDER BY updated_at DESC
      `;
    } else if (symbol) {
      rows = await sql`
        SELECT * FROM ml_model_registry
        WHERE symbol = ${symbol}
        ORDER BY updated_at DESC
      `;
    } else if (status) {
      rows = await sql`
        SELECT * FROM ml_model_registry
        WHERE status = ${status}
        ORDER BY updated_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM ml_model_registry
        ORDER BY updated_at DESC
      `;
    }
    return rows;
  } catch (err) {
    console.error('[getRegisteredModels Error]:', err);
    return [];
  }
}

export async function registerModelInDb(data: {
  modelId: string;
  modelName: string;
  version: string;
  symbol: string;
  horizonSecs?: number;
  format?: string;
  status?: string;
  accuracy?: number;
  backtestWinRate?: number;
  backtestProfitFactor?: number;
  filePath?: string;
  hyperparameters?: any;
  metrics?: any;
}) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return false;

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    const horizon = data.horizonSecs || 5;
    const fmt = data.format || 'ONNX';
    const st = data.status || 'staging';
    const acc = data.accuracy || 0.0;
    const winRate = data.backtestWinRate || 0.0;
    const pf = data.backtestProfitFactor || 1.0;
    const hp = data.hyperparameters ? JSON.stringify(data.hyperparameters) : '{}';
    const met = data.metrics ? JSON.stringify(data.metrics) : '{}';

    await sql`
      INSERT INTO ml_model_registry (
        model_id, model_name, version, symbol, horizon_secs, format, status,
        accuracy, backtest_win_rate, backtest_profit_factor, file_path, hyperparameters, metrics, updated_at
      )
      VALUES (
        ${data.modelId}, ${data.modelName}, ${data.version}, ${data.symbol}, ${horizon}, ${fmt}, ${st},
        ${acc}, ${winRate}, ${pf}, ${data.filePath || ''}, ${hp}::jsonb, ${met}::jsonb, NOW()
      )
      ON CONFLICT (model_id) DO UPDATE SET
        model_name = EXCLUDED.model_name,
        version = EXCLUDED.version,
        horizon_secs = EXCLUDED.horizon_secs,
        format = EXCLUDED.format,
        status = EXCLUDED.status,
        accuracy = EXCLUDED.accuracy,
        backtest_win_rate = EXCLUDED.backtest_win_rate,
        backtest_profit_factor = EXCLUDED.backtest_profit_factor,
        file_path = EXCLUDED.file_path,
        hyperparameters = EXCLUDED.hyperparameters,
        metrics = EXCLUDED.metrics,
        updated_at = NOW()
    `;
    return true;
  } catch (err) {
    console.error('[registerModelInDb Error]:', err);
    return false;
  }
}

export async function promoteModelInRegistry(modelId: string, symbol: string, horizonSecs: number) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return false;

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    // Demote any current production model for same symbol & horizon to staging
    await sql`
      UPDATE ml_model_registry
      SET status = 'staging', updated_at = NOW()
      WHERE symbol = ${symbol} AND horizon_secs = ${horizonSecs} AND status = 'production'
    `;

    // Promote target model to production
    await sql`
      UPDATE ml_model_registry
      SET status = 'production', updated_at = NOW()
      WHERE model_id = ${modelId}
    `;
    return true;
  } catch (err) {
    console.error('[promoteModelInRegistry Error]:', err);
    return false;
  }
}

export async function saveBacktestResults(data: {
  modelId?: string;
  symbol: string;
  durationSec: number;
  totalTrades: number;
  winningTrades: number;
  profitFactor: number;
}) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return false;

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    await sql`
      INSERT INTO ml_backtest_results (
        model_id, symbol, duration_sec, total_trades, winning_trades, profit_factor
      ) VALUES (
        ${data.modelId || null}, ${data.symbol}, ${data.durationSec}, ${data.totalTrades}, ${data.winningTrades}, ${data.profitFactor}
      )
    `;
    return true;
  } catch (err) {
    console.error('[saveBacktestResults Error]:', err);
    return false;
  }
}

export async function savePerformanceAudit(data: {
  symbol: string;
  modelId?: string;
  predictedSignal: string;
  confidence: number;
  entryPrice: number;
  exitPrice?: number;
  outcome?: string;
}) {
  const dbUrl = getDbConnectionString();
  if (!dbUrl) return false;

  await initDbSchema();
  try {
    const sql = neon(dbUrl);
    await sql`
      INSERT INTO ml_performance_audit (
        symbol, model_id, predicted_signal, confidence, entry_price, exit_price, outcome
      ) VALUES (
        ${data.symbol}, ${data.modelId || null}, ${data.predictedSignal}, ${data.confidence}, ${data.entryPrice}, ${data.exitPrice || null}, ${data.outcome || null}
      )
    `;
    return true;
  } catch (err) {
    console.error('[savePerformanceAudit Error]:', err);
    return false;
  }
}
