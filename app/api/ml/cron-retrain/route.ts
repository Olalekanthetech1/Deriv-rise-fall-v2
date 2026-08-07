import { NextRequest, NextResponse } from 'next/server';
import { xgboostModel } from '@/lib/xgboost-engine';
import { initDbSchema, getTicksHistory, getDb } from '@/lib/db';

const RETRAIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 Hours

export async function GET(req: NextRequest) {
  try {
    const isConnected = await initDbSchema();
    const sql = getDb();
    
    let lastTrainedAt: string | null = null;
    let timeSinceLastTrainMs = Infinity;

    if (sql && isConnected) {
      try {
        const lastLog = await sql`
          SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1
        `;
        if (lastLog.length > 0) {
          lastTrainedAt = new Date(lastLog[0].trained_at).toISOString();
          timeSinceLastTrainMs = Math.max(0, Date.now() - new Date(lastLog[0].trained_at).getTime());
        } else {
          const lastModel = await sql`
            SELECT trained_at FROM ml_models ORDER BY trained_at DESC LIMIT 1
          `;
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
      status: 'active',
      scheduleIntervalHours: 6,
      lastTrainedAt: lastTrainedAt || null,
      timeSinceLastTrainMinutes: lastTrainedAt ? Math.floor(timeSinceLastTrainMs / 60000) : null,
      isDue,
      nextScheduledRunInMinutes: Math.ceil(nextDueInMs / 60000),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron status check failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await initDbSchema();
    const body = await req.json().catch(() => ({}));
    const { symbol = 'R_100', force = false } = body;

    const sql = getDb();
    let shouldRetrain = force;
    let lastTrainedAt: Date | null = null;

    if (sql && !force) {
      try {
        const lastLog = await sql`
          SELECT created_at AS trained_at FROM ml_training_logs ORDER BY created_at DESC LIMIT 1
        `;
        if (lastLog.length > 0) {
          lastTrainedAt = new Date(lastLog[0].trained_at);
          if (Date.now() - lastTrainedAt.getTime() >= RETRAIN_INTERVAL_MS) {
            shouldRetrain = true;
          }
        } else {
          shouldRetrain = true;
        }
      } catch (e) {
        shouldRetrain = true;
      }
    }

    if (!shouldRetrain) {
      return NextResponse.json({
        success: true,
        retrained: false,
        reason: 'Interval (6 hours) has not elapsed since last model training cycle.',
        lastTrainedAt: lastTrainedAt ? lastTrainedAt.toISOString() : null,
      });
    }

    // Execute retrain across all primary active assets systematically using real Deriv ticks
    const { ensureMinTicks } = await import('@/lib/ticks-helper');
    const currentHyperparams = xgboostModel.getHyperparameters();
    const primarySymbols = ['R_100', '1HZ100V', 'R_75', '1HZ75V', 'R_50', '1HZ50V', 'R_25', '1HZ25V', 'R_10', '1HZ10V', 'FRXEURUSD', 'FRXGBPUSD', 'FRXUSDJPY', 'CWMXAUUSD'];
    const cronResults: any[] = [];

    for (const sym of primarySymbols) {
      // Cold-start real Deriv WebSocket ticks (up to 500 ticks)
      const dbTicks = await ensureMinTicks(sym, 500);

      if (!dbTicks || dbTicks.length < 20) {
        console.warn(`[Cron] Skipping ${sym}, insufficient ticks: ${dbTicks?.length || 0}`);
        continue;
      }

      // Execute retrain via Python Daemon
      const { xgboostDaemon } = await import('@/lib/xgboost-daemon');
      const daemonRes = await xgboostDaemon.sendCommand('train', {
        symbol: sym,
        ticks: dbTicks,
        hyperparams: currentHyperparams,
      });

      if (!daemonRes || !daemonRes.success) {
        console.warn(`[Cron] Python Daemon failed to train ${sym}: ${daemonRes?.error || 'Unknown'}`);
        continue;
      }

      const trainResult = {
        samplesCount: daemonRes.samplesCount,
        accuracy: parseFloat(String(daemonRes.accuracy).replace('%', '')),
        engine: 'Warm Python Daemon (XGBoost)',
      };

      if (sql) {
        try {
          await sql`
            INSERT INTO ml_models (model_name, version, symbol, accuracy, feature_count, hyperparameters)
            VALUES (${`Cron Python XGBoost Engine`}, 'v3.4.0-cron', ${sym}, ${trainResult.accuracy}, 37, ${JSON.stringify(currentHyperparams)}::jsonb)
          `;

          await sql`
            INSERT INTO ml_training_logs (symbol, samples_count, train_accuracy, val_accuracy, log_message)
            VALUES (
              ${sym},
              ${trainResult.samplesCount},
              ${trainResult.accuracy},
              ${trainResult.accuracy},
              ${`Automated 6-Hour Fleet Cron Retrain [${sym}]: samples=${trainResult.samplesCount}, acc=${trainResult.accuracy}%`}
            )
          `;
        } catch (dbErr) {
          console.warn('[Cron Retrain DB Log Error]:', dbErr);
        }
      }

      cronResults.push({
        symbol: sym,
        samplesCount: trainResult.samplesCount,
        accuracy: `${trainResult.accuracy}%`,
      });
    }

    const leadResult = cronResults[0];

    return NextResponse.json({
      success: true,
      retrained: true,
      mode: 'ALL_ASSETS_FLEET',
      fleetTrainedCount: cronResults.length,
      symbol: 'ALL_ASSETS',
      samplesCount: leadResult?.samplesCount || 0,
      accuracy: leadResult?.accuracy || '0.0%',
      fleetResults: cronResults,
      hyperparameters: currentHyperparams,
      trainedAt: new Date().toISOString(),
      nextScheduledRun: new Date(Date.now() + RETRAIN_INTERVAL_MS).toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Cron retraining failed' }, { status: 500 });
  }
}
