import { NextRequest, NextResponse } from 'next/server';
import { getRegisteredModels, promoteModelInRegistry, initDbSchema, getDb } from '@/lib/db';
import { getMlModelDefinition } from '@/lib/ml-model-registry';
import { verifySessionToken } from '../../admin/auth/route';

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

function readableAssetName(symbol: string, storedDisplayName?: unknown): string {
  const stored = String(storedDisplayName || '').trim();
  if (stored) return stored;
  const oneSecondVolatility = /^1HZ(\d+)V$/i.exec(symbol);
  if (oneSecondVolatility) return `Volatility ${oneSecondVolatility[1]} (1s) Index`;
  const volatility = /^R_(\d+)$/i.exec(symbol);
  if (volatility) return `Volatility ${volatility[1]} Index`;
  return symbol.replace(/_/g, ' ');
}

function normalizeRegistryModel(model: Record<string, any>) {
  const rawSymbol = String(model.asset_symbol || model.symbol || '').trim();
  const rawModelFamily = String(model.model_family || '').trim();
  const definition = getMlModelDefinition(rawModelFamily.toLowerCase());
  const horizonTicks = Number(model.horizon_ticks ?? model.horizon_secs);

  return {
    ...model,
    symbol: rawSymbol || undefined,
    horizon_secs: Number.isFinite(horizonTicks) ? horizonTicks : undefined,
    model_name: definition?.displayName || rawModelFamily || model.model_name || 'Unknown model',
    raw_symbol: rawSymbol || undefined,
    raw_model_family: rawModelFamily || undefined,
    raw_horizon_ticks: Number.isFinite(horizonTicks) ? horizonTicks : undefined,
    asset_display_name: readableAssetName(rawSymbol, model.asset_display_name),
  };
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
      models: (models || []).map((model: Record<string, any>) => normalizeRegistryModel(model)),
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

      const sql = getDb();
      if (!sql) return NextResponse.json({ success: false, error: 'Model registry database is unavailable.' }, { status: 503 });

      const rows = await sql`
        SELECT model_id, asset_symbol, horizon_ticks, model_family, framework, metrics, status
        FROM ml_model_registry_v2
        WHERE model_id = ${modelId}
        LIMIT 1
      `;
      const registered = rows[0] as any;
      if (!registered) {
        return NextResponse.json({ success: false, error: 'Model promotion failed: model is not registered.' }, { status: 409 });
      }

      if (String(registered.asset_symbol) !== symbol) {
        return NextResponse.json({ success: false, error: 'Model promotion rejected: symbol does not match the persisted model lineage.' }, { status: 409 });
      }

      if (Number(registered.horizon_ticks) !== horizon) {
        return NextResponse.json({ success: false, error: 'Model promotion rejected: horizon does not match the persisted model lineage.' }, { status: 409 });
      }

      const definition = getMlModelDefinition(String(registered.model_family).toLowerCase());
      const lifecycleTier = String((registered.metrics as Record<string, unknown> | null)?.lifecycleTier || definition?.lifecycleTier || '').toLowerCase();
      if (lifecycleTier !== 'production_candidate') {
        return NextResponse.json({
          success: false,
          error: 'Model promotion rejected: experimental models must remain isolated from production.',
          lifecycleTier: lifecycleTier || 'unknown',
        }, { status: 409 });
      }

      if (String(registered.status).toLowerCase() !== 'candidate' && String(registered.status).toLowerCase() !== 'staging') {
        return NextResponse.json({ success: false, error: `Model promotion rejected: status ${registered.status || 'unknown'} is not promotable.` }, { status: 409 });
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
