import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { xgboostDaemon } from '@/lib/xgboost-daemon';

export async function GET() {
  const startDb = Date.now();
  const health: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      dbLatencyMs: null,
      pythonDaemon: 'unknown',
      daemonLatencyMs: null,
    },
    env: {
      databaseUrlSet: !!process.env.DATABASE_URL,
      derivAppIdSet: !!process.env.NEXT_PUBLIC_DERIV_APP_ID,
    }
  };

  try {
    const db = getDb();
    if (db) {
      const dbQueryStart = Date.now();
      await db`SELECT 1`;
      health.services.dbLatencyMs = Date.now() - dbQueryStart;
      health.services.database = 'connected';
    } else {
      health.services.database = 'disconnected';
      health.status = 'degraded';
    }
  } catch (err) {
    health.services.database = 'error';
    health.status = 'degraded';
  }

  try {
    const daemonStart = Date.now();
    const pingRes = await xgboostDaemon.sendCommand('ping');
    health.services.daemonLatencyMs = Date.now() - daemonStart;
    if (pingRes && pingRes.success) {
      health.services.pythonDaemon = 'connected';
    } else {
      health.services.pythonDaemon = 'error';
      health.status = 'degraded';
    }
  } catch (err) {
    health.services.pythonDaemon = 'error';
    health.status = 'degraded';
  }

  return NextResponse.json(health, { status: health.status === 'healthy' ? 200 : 503 });
}

