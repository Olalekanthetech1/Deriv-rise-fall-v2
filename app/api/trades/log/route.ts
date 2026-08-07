import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDbSchema } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const { 
      symbol, 
      contract_type, 
      stake, 
      payout, 
      buy_price, 
      sell_price, 
      status, 
      prediction_confidence, 
      strategy 
    } = data;

    const isDbConnected = await initDbSchema();
    const sql = getDb();

    if (!sql || !isDbConnected) {
      return NextResponse.json({ success: false, error: 'Database not configured or connected' });
    }

    await sql`
      INSERT INTO trades (
        symbol, contract_type, stake, payout, buy_price, sell_price, status, prediction_confidence, strategy
      ) VALUES (
        ${symbol}, ${contract_type}, ${stake}, ${payout || null}, ${buy_price || null}, ${sell_price || null}, ${status}, ${prediction_confidence || null}, ${strategy || null}
      )
    `;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error logging trade:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
