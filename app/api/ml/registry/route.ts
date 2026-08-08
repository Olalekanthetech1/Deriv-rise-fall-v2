import { NextRequest, NextResponse } from 'next/server';
import { getRegisteredModels, promoteModelInRegistry, initDbSchema, getDb } from '@/lib/db';
import { verifySessionToken } from '../admin/auth/route';

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    const dbReady = await initDbSchema();
    if (!dbReady) {
      return NextResponse.json({
        success: false,
        models: [],
        count: 0,
        dataSource: 'database-unavailable',
        error: 'Model registry database is unavailable; no synthetic registry entries are returned.',
      }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol') || undefined;
    const status = searchParams.get('status') || undefined;
    const models = await getRegisteredModels(symbol, status);

    return NextResponse.json({
      success: true,
      count: models?.length || 0,
      models: models || [],
      dataSource: 'live-database',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Failed to fetch model registry' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized admin access.' }, { status: 401 });
  }

  try {
    const dbReady = await initDbSchema();
    if (!dbReady) {
      return NextResponse.json({ success: false, error: 'Model registry database is unavailable.' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, modelId, symbol, horizonSecs } = body;

    if (action === 'initialize' || action === 'seed') {
      return NextResponse.json({
        success: false,
        error: 'Synthetic/default model registration is disabled. Register only models backed by real trained artifacts and measured validation metrics.',
      }, { status: 410 });
    }

    if (action === 'promote') {
      if (!modelId || typeof modelId !== 'string' || !symbol || typeof symbol !== 'string') {
        return NextResponse.json({ error: 'Missing or invalid modelId or symbol.' }, { status: 400 });
      }

      const horizon = Number(horizonSecs);
      if (!Number.isFinite(horizon) || horizon <= 0) {
        return NextResponse.json({ error: 'A positive numeric horizonSecs value is required.' }, { status: 400 });
      }

      const success = await promoteModelInRegistry(modelId, symbol, horizon);
      if (!success) {
        return NextResponse.json({ success: false, error: 'Model promotion failed or model is not registered.' }, { status: 409 });
      }

      return NextResponse.json({
        success: true,
        modelId,
        symbol,
        horizonSecs: horizon,
        status: 'production',
        promotedAt: new Date().toISOString(),
      });
    }

    if (action === 'delete') {
      if (!modelId || typeof modelId !== 'string') {
        return NextResponse.json({ error: 'Missing modelId.' }, { status: 400 });
      }
      const sql = getDb();
      if (!sql) return NextResponse.json({ success: false, error: 'Database unavailable.' }, { status: 503 });

      await sql`DELETE FROM ml_model_registry WHERE model_id = ${modelId}`;
      return NextResponse.json({ success: true, message: `Model ${modelId} deleted from registry.` });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Registry action failed' }, { status: 500 });
  }
}
