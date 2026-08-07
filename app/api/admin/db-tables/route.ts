import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDbSchema } from '@/lib/db';
import { verifySessionToken } from '../auth/route';

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace('Bearer ', '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    const isDbConnected = await initDbSchema();
    const sql = getDb();
    
    if (!sql || !isDbConnected) {
      return NextResponse.json({ success: false, error: 'DB not connected' });
    }

    const registry = await sql`SELECT * FROM ml_model_registry ORDER BY id DESC LIMIT 50`;
    const backtests = await sql`SELECT * FROM ml_backtest_results ORDER BY tested_at DESC LIMIT 50`;
    const audits = await sql`SELECT * FROM ml_performance_audit ORDER BY created_at DESC LIMIT 50`;
    const trades = await sql`SELECT * FROM trades ORDER BY executed_at DESC LIMIT 50`;

    return NextResponse.json({ success: true, registry, backtests, audits, trades });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
