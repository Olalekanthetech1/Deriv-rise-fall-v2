import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { verifySessionToken } from '../auth/route';

function authorized(req: NextRequest) {
  const cookie = req.cookies.get('admin_session_token')?.value;
  const header = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookie) || verifySessionToken(header);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return NextResponse.json({ success: true, dataSource: 'runtime', status: 'UNAVAILABLE', configured: false, error: 'DATABASE_URL is not configured.' }, { status: 503 });

  const started = performance.now();
  try {
    const sql = neon(url);
    const [health, tables] = await Promise.all([
      sql`SELECT NOW() AS server_time, current_database() AS database_name, current_schema() AS schema_name, version() AS version`,
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    ]);
    const latencyMs = Number((performance.now() - started).toFixed(2));
    return NextResponse.json({
      success: true,
      dataSource: 'live-database',
      status: 'HEALTHY',
      configured: true,
      latencyMs,
      serverTime: health[0]?.server_time ?? null,
      databaseName: health[0]?.database_name ?? null,
      schemaName: health[0]?.schema_name ?? null,
      version: health[0]?.version ?? null,
      tables: tables.map((row: any) => row.table_name),
      tableCount: tables.length,
      integrity: { configurationVerifiedByQuery: true, connectionVerifiedByQuery: true, valuesDerivedFromLiveDatabase: true },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      dataSource: 'live-database',
      status: 'UNHEALTHY',
      configured: true,
      latencyMs: Number((performance.now() - started).toFixed(2)),
      error: error?.message || 'Database connection/query failed.',
      integrity: { configurationVerifiedByQuery: false, connectionVerifiedByQuery: false, valuesDerivedFromLiveDatabase: false },
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
