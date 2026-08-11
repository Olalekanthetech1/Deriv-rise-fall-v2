import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { mlRuntimeClient } from '@/lib/ml-runtime-client';

export async function GET() {
  const health: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      dbLatencyMs: null,
      pythonRuntime: 'unknown',
      runtimeLatencyMs: null,
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
    const runtimeStart = Date.now();
    const pingRes = await mlRuntimeClient.sendCommand('ping');
    health.services.runtimeLatencyMs = Date.now() - runtimeStart;
    if (pingRes && pingRes.success) {
      health.services.pythonRuntime = 'connected';
    } else {
      health.services.pythonRuntime = 'error';
      health.status = 'degraded';
    }
  } catch (err) {
    health.services.pythonRuntime = 'error';
    health.status = 'degraded';
  }

  return NextResponse.json(health, { status: health.status === 'healthy' ? 200 : 503 });
}
