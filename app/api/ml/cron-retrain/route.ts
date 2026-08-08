import { NextRequest, NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';
import { verifySessionToken } from '../../admin/auth/route';

const RETRAIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    const isConnected = await initDbSchema();
    const sql = getDb();
    let lastTrainedAt: string | null = null;
    let timeSinceLastTrainMs = Infinity;

    if (sql && isConnected) {
      try {
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
      } catch (e) {
        console.warn('[Cron Check Log Error]:', e);
      }
    }

    const isDue = timeSinceLastTrainMs >= RETRAIN_INTERVAL_MS;
    const nextDueInMs = Math.max(0, RETRAIN_INTERVAL_MS - (timeSinceLastTrainMs === Infinity ? 0 : timeSinceLastTrainMs));

    return NextResponse.json({
      status: isConnected ? 'active' : 'database_unavailable',
      scheduleIntervalHours: RETRAIN_INTERVAL_MS / 3_600_000,
      lastTrainedAt,
      timeSinceLastTrainMinutes: lastTrainedAt ? Math.floor(timeSinceLastTrainMs / 60000) : null,
      isDue,
      nextScheduledRunInMinutes: Math.ceil(nextDueInMs / 60000),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron status check failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    const isConnected = await initDbSchema();
    if (!isConnected) {
      return NextResponse.json({ success: false, error: 'Database unavailable; retraining requires persisted real tick data.' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const symbol = typeof body.symbol === 'string' && body.symbol.trim() ? body.symbol.trim() : 'R_100';
    const force = body.force === true;
    const sql = getDb();
    if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

    let shouldRetrain = force;
    let lastTrainedAt: Date | null = null;

    if (!force) {
      const lastLog = await sql`SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1`;
      if (lastLog.length > 0) {
        lastTrainedAt = new Date(lastLog[0].trained_at);
        shouldRetrain = Date.now() - lastTrainedAt.getTime() >= RETRAIN_INTERVAL_MS;
      } else {
        shouldRetrain = true;
      }
    }

    if (!shouldRetrain) {
      return NextResponse.json({
        success: true,
        retrained: false,
        reason: 'The configured retraining interval has not elapsed since the last training cycle.',
        lastTrainedAt: lastTrainedAt?.toISOString() || null,
      });
    }

    const { ensureMinTicks } = await import('@/lib/ticks-helper');
    const { xgboostDaemon } = await import('@/lib/xgboost-daemon');
    const primarySymbols = ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', '1HZ50V', 'R_25', '1HZ25V', 'R_10', '1HZ10V', 'FRXEURUSD', 'FRXGBPUSD', 'FRXUSDJPY', 'CWMXAUUSD'];
    const symbols = symbol === 'ALL_ASSETS' ? primarySymbols : [symbol];
    const cronResults: any[] = [];

    for (const sym of symbols) {
      const dbTicks = await ensureMinTicks(sym, 500);
      if (!dbTicks || dbTicks.length < 20) {
        cronResults.push({ symbol: sym, success: false, error: 'INSUFFICIENT_REAL_TICKS', samplesCount: dbTicks?.length || 0 });
        continue;
      }

      const daemonRes = await xgboostDaemon.sendCommand('train', {
        symbol: sym,
        ticks: dbTicks,
      });

      if (!daemonRes?.success) {
        cronResults.push({ symbol: sym, success: false, error: daemonRes?.error || 'NATIVE_TRAINING_FAILED' });
        continue;
      }

      const validationAccuracy = Number(daemonRes.accuracy);
      if (!Number.isFinite(validationAccuracy)) {
        cronResults.push({ symbol: sym, success: false, error: 'MISSING_VALIDATION_ACCURACY' });
        continue;
      }

      const modelVersion = daemonRes.modelId || `${sym}_xgboost`;
      await sql`
        INSERT INTO ml_models (model_name, version, symbol, accuracy, feature_count, hyperparameters)
        VALUES (${`Native Python XGBoost Engine`}, ${modelVersion}, ${sym}, ${validationAccuracy}, 37, ${JSON.stringify(daemonRes.hyperparameters || {})}::jsonb)
      `;

      await sql`
        INSERT INTO ml_training_logs (symbol, samples_count, train_accuracy, val_accuracy, log_message)
        VALUES (
          ${sym},
          ${Number(daemonRes.samplesCount) || 0},
          ${null},
          ${validationAccuracy},
          ${`Automated retrain [${sym}]: validation accuracy=${validationAccuracy}%`}
        )
      `;

      cronResults.push({
        symbol: sym,
        success: true,
        samplesCount: Number(daemonRes.samplesCount) || 0,
        validationAccuracy,
        modelId: daemonRes.modelId || null,
      });
    }

    const successful = cronResults.filter((item) => item.success);
    const leadResult = successful[0];

    return NextResponse.json({
      success: successful.length > 0,
      retrained: successful.length > 0,
      mode: symbols.length > 1 ? 'ALL_ASSETS_FLEET' : 'SINGLE_ASSET',
      fleetTrainedCount: successful.length,
      symbol: symbols.length > 1 ? 'ALL_ASSETS' : symbol,
      samplesCount: leadResult?.samplesCount || 0,
      accuracy: leadResult?.validationAccuracy ?? null,
      fleetResults: cronResults,
      trainedAt: new Date().toISOString(),
      nextScheduledRun: new Date(Date.now() + RETRAIN_INTERVAL_MS).toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron retraining failed' }, { status: 500 });
  }
}
