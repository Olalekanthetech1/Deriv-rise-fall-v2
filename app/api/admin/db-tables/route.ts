import { NextResponse } from 'next/server';
import { getDb, initDbSchema } from '@/lib/db';

export async function GET() {
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
