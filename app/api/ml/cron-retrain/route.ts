import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { verifySessionToken } from '../../admin/auth/route';

function getRetrainIntervalMs(): number | null {
  const value = Number(process.env.ML_RETRAIN_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

async function resolveLiveSymbols(req: NextRequest, requestedSymbol: string): Promise<string[]> {
  if (requestedSymbol !== 'ALL_ASSETS') return [requestedSymbol];
  const response = await fetch(new URL('/api/symbols', req.url), { cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.symbols)) throw new Error(data?.error || 'Live Deriv symbol discovery is unavailable.');
  const symbols = data.symbols
    .filter((item: any) => item?.isOpen && typeof item?.symbol === 'string' && item.symbol.trim())
    .map((item: any) => item.symbol.trim());
  if (!symbols.length) throw new Error('No open Deriv symbols are currently available for fleet retraining.');
  return symbols;
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    const intervalMs = getRetrainIntervalMs();
    const isConnected = await initDbSchema();
    const sql = getDb();
    let lastTrainedAt: string | null = null;
    let timeSinceLastTrainMs: number | null = null;

    if (sql && isConnected) {
      const lastLog = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
      if (lastLog.length > 0) {
        lastTrainedAt = new Date(lastLog[0].trained_at).toISOString();
        timeSinceLastTrainMs = Math.max(0, Date.now() - new Date(lastLog[0].trained_at).getTime());
      } else {
        const lastModel = await sql`SELECT trained_at FROM ml_models ORDER BY trained_at DESC LIMIT 1`;
        if (lastModel.length > 0) {
          lastTrainedAt = new Date(lastModel[0].trained_at).toISOString();
          timeSinceLastTrainMs = Math.max(0, Date.now() - new Date(lastModel[0].trained_at).getTime());
        }
      }
    }

    const scheduleConfigured = intervalMs !== null;
    const isDue = scheduleConfigured && timeSinceLastTrainMs !== null ? timeSinceLastTrainMs >= intervalMs : null;
    const nextDueInMs = scheduleConfigured && timeSinceLastTrainMs !== null ? Math.max(0, intervalMs - timeSinceLastTrainMs) : null;

    return NextResponse.json({
      status: isConnected ? (scheduleConfigured ? 'active' : 'schedule_not_configured') : 'database_unavailable',
      scheduleConfigured,
      scheduleIntervalMs: intervalMs,
      scheduleIntervalHours: intervalMs !== null ? intervalMs / 3_600_000 : null,
      lastTrainedAt,
      timeSinceLastTrainMinutes: timeSinceLastTrainMs !== null ? Math.floor(timeSinceLastTrainMs / 60000) : null,
      isDue,
      nextScheduledRunInMinutes: nextDueInMs !== null ? Math.ceil(nextDueInMs / 60000) : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron status check failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });

  try {
    const isConnected = await initDbSchema();
    if (!isConnected) return NextResponse.json({ success: false, error: 'Database unavailable; retraining requires persisted real tick data.' }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const symbol = typeof body?.symbol === 'string' ? body.symbol.trim() : '';
    const force = body.force === true;
    if (!symbol) return NextResponse.json({ success: false, error: 'A live symbol or ALL_ASSETS is required.' }, { status: 400 });

    const intervalMs = getRetrainIntervalMs();
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

    let shouldRetrain = force;
    let lastTrainedAt: Date | null = null;
    if (!force) {
      if (intervalMs === null) return NextResponse.json({ success: false, error: 'ML_RETRAIN_INTERVAL_MS is not configured.' }, { status: 503 });
      const lastLog = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
      if (lastLog.length > 0) {
        lastTrainedAt = new Date(lastLog[0].trained_at);
        shouldRetrain = Date.now() - lastTrainedAt.getTime() >= intervalMs;
      } else {
        shouldRetrain = true;
      }
    }

    if (!shouldRetrain) {
      return NextResponse.json({ success: true, retrained: false, reason: 'The configured retraining interval has not elapsed since the last training cycle.', lastTrainedAt: lastTrainedAt?.toISOString() || null });
    }

    const { ensureMinTicks } = await import('@/lib/ticks-helper');
    const { xgboostDaemon } = await import('@/lib/xgboost-daemon');
    const symbols = await resolveLiveSymbols(req, symbol);
    const cronResults: any[] = [];

    for (const sym of symbols) {
      const dbTicks = await ensureMinTicks(sym, 500);
      if (!dbTicks || dbTicks.length < 20) {
        cronResults.push({ symbol: sym, success: false, error: 'INSUFFICIENT_REAL_TICKS', samplesCount: dbTicks?.length || 0 });
        continue;
      }

      const assetCategory = sym.startsWith('FRX') ? 1 : sym.startsWith('CWM') ? 2 : 0;
      const daemonRes = await xgboostDaemon.sendCommand('train', { symbol: sym, ticks: dbTicks, assetCategory });
      if (!daemonRes?.success) {
        cronResults.push({ symbol: sym, success: false, error: daemonRes?.error || 'NATIVE_TRAINING_FAILED' });
        continue;
      }

      const validationAccuracy = Number(daemonRes.accuracy);
      const featureCount = Number(daemonRes.featureCount);
      if (!Number.isFinite(validationAccuracy) || !Number.isFinite(featureCount)) {
        cronResults.push({ symbol: sym, success: false, error: 'MISSING_RUNTIME_VALIDATION_METADATA' });
        continue;
      }

      const modelVersion = daemonRes.modelId;
      const modelName = daemonRes.engine || daemonRes.modelType;
      if (!modelVersion || !modelName) {
        cronResults.push({ symbol: sym, success: false, error: 'MISSING_RUNTIME_MODEL_IDENTITY' });
        continue;
      }

      await sql`
        INSERT INTO ml_models (model_name, version, symbol, accuracy, feature_count, hyperparameters)
        VALUES (${modelName}, ${modelVersion}, ${sym}, ${validationAccuracy}, ${featureCount}, ${JSON.stringify(daemonRes.hyperparameters || {})}::jsonb)
      `;

      await sql`
        INSERT INTO ml_training_logs (symbol, samples_count, train_accuracy, val_accuracy, log_message)
        VALUES (${sym}, ${Number(daemonRes.samplesCount) || 0}, ${null}, ${validationAccuracy}, ${`Automated retrain [${sym}]: validation accuracy=${validationAccuracy}%`})
      `;

      cronResults.push({ symbol: sym, success: true, samplesCount: Number(daemonRes.samplesCount) || 0, validationAccuracy, modelId: modelVersion, featureCount });
    }

    const successful = cronResults.filter((item) => item.success);
    const leadResult = successful[0];
    const nextScheduledRun = intervalMs !== null ? new Date(Date.now() + intervalMs).toISOString() : null;

    return NextResponse.json({
      success: successful.length > 0,
      retrained: successful.length > 0,
      mode: symbols.length > 1 ? 'ALL_ASSETS_FLEET' : 'SINGLE_ASSET',
      fleetTrainedCount: successful.length,
      symbol: symbols.length > 1 ? 'ALL_ASSETS' : symbol,
      samplesCount: leadResult?.samplesCount ?? null,
      accuracy: leadResult?.validationAccuracy ?? null,
      fleetResults: cronResults,
      trainedAt: new Date().toISOString(),
      nextScheduledRun,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron retraining failed' }, { status: 500 });
  }
}
