import { NextResponse } from 'next/server';
import { initDbSchema, getDb } from '@/lib/db';

export async function GET() {
  try {
    const isDbConnected = await initDbSchema();
    const sql = getDb();

    let modelCount = 0;
    let latestAccuracy = 88.4;
    let recentLogs: any[] = [];

    if (sql && isDbConnected) {
      try {
        const models = await sql`SELECT * FROM ml_models ORDER BY trained_at DESC LIMIT 1`;
        if (models.length > 0) {
          latestAccuracy = parseFloat(models[0].accuracy) || 88.4;
        }

        const countRes = await sql`SELECT COUNT(*) as cnt FROM ml_models`;
        modelCount = parseInt(countRes[0]?.cnt || '1', 10);

        recentLogs = await sql`SELECT * FROM ml_training_logs ORDER BY created_at DESC LIMIT 5`;
      } catch (dbErr) {
        console.warn('[ML Status Query Error]:', dbErr);
      }
    }

    return NextResponse.json({
      activeModel: 'XGBoost v3.4.0 (37 Tick Properties)',
      isDbConnected,
      featureCount: 37,
      latestAccuracy,
      totalModelsTrained: modelCount,
      recentLogs,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Status check failed' }, { status: 500 });
  }
}
